import { afterEach, describe, expect, it } from 'vitest'
import {
  Agent,
  availability,
  chain,
  isSupported,
  localMemory,
  memoryTools,
  parallel,
  refine,
  router,
  step,
  tool,
} from '../src/index'
import type {
  AgentInput,
  Availability,
  LanguageModelSession,
  PromptOptions,
} from '../src/types'

/** 프롬프트가 세션에 도달한 기록 */
interface Call {
  input: AgentInput
  options?: PromptOptions
}

/**
 * 가짜 LanguageModel 전역을 심는다.
 * responses는 순서대로 소비되며, 함수를 주면 그 호출의 입력을 보고 응답을 정할 수 있다.
 */
function installMock(responses: Array<string | ((call: Call) => string)>) {
  const calls: Array<Call> = []
  const systemPrompts: Array<string> = []
  const created: { count: number; destroyed: number } = { count: 0, destroyed: 0 }
  let cursor = 0

  const makeSession = (): LanguageModelSession => ({
    async prompt(input, options) {
      calls.push({ input, options })
      const next = responses[cursor++]
      if (next === undefined) throw new Error('가짜 응답이 모자란다')
      return typeof next === 'function' ? next({ input, options }) : next
    },
    async *promptStreaming(input, options) {
      const text = await this.prompt(input, options)
      // 실제 API처럼 델타 조각으로 쪼개 흘린다.
      for (const chunk of text.match(/.{1,4}/gs) ?? []) yield chunk
    },
    async append() {},
    async clone() {
      return makeSession()
    },
    destroy() {
      created.destroyed++
    },
    contextUsage: 10,
    contextWindow: 4096,
    addEventListener() {},
  })

  globalThis.LanguageModel = {
    async availability() {
      return 'available'
    },
    async create(options) {
      created.count++
      const system = options?.initialPrompts?.find((m) => m.role === 'system')
      if (typeof system?.content === 'string') systemPrompts.push(system.content)
      return makeSession()
    },
  }

  return { calls, systemPrompts, created }
}

afterEach(() => {
  globalThis.LanguageModel = undefined
})

describe('환경 감지', () => {
  it('전역이 없으면 unavailable을 돌려주고 던지지 않는다', async () => {
    expect(isSupported()).toBe(false)
    await expect(availability()).resolves.toBe('unavailable')
  })
})

describe('Agent', () => {
  it('도구가 없으면 프롬프트를 그대로 넘기고 응답을 돌려준다', async () => {
    const mock = installMock(['안녕하세요'])
    const a = new Agent({ name: 'greeter', instruction: '너는 인사 담당이다.' })

    await expect(a.send('안녕')).resolves.toBe('안녕하세요')
    expect(mock.systemPrompts[0]).toBe('너는 인사 담당이다.')
    expect(mock.calls[0]?.options?.responseConstraint).toBeUndefined()
  })

  describe('오늘 날짜 주입', () => {
    // 온디바이스 모델은 시계가 없어 날짜를 확신에 차서 틀린다. 다만 대부분의
    // 에이전트는 날짜가 필요 없으므로 기본은 꺼 두고, 필요한 쪽만 켜게 한다.
    const today = () => {
      const now = new Date()
      const pad = (v: number) => String(v).padStart(2, '0')
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    }

    it('기본으로는 넣지 않는다', async () => {
      const mock = installMock(['ok'])
      await new Agent({ instruction: '너는 비서다.' }).send('안녕')

      expect(mock.systemPrompts[0]).toBe('너는 비서다.')
    })

    it('today: true면 시스템 프롬프트에 들어간다', async () => {
      const mock = installMock(['ok'])
      await new Agent({ instruction: '너는 비서다.', today: true }).send('오늘 며칠이야?')

      expect(mock.systemPrompts[0]).toContain(today())
      expect(mock.systemPrompts[0]).toContain('너는 비서다.')
    })

    it('요일까지 넣는다 — "다음 주 월요일" 같은 요청에 필요하다', async () => {
      const mock = installMock(['ok'])
      await new Agent({ today: true }).send('언제야?')

      expect(mock.systemPrompts[0]).toMatch(
        /\((Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\)/,
      )
    })

    it('지시문이 없어도 날짜만으로 시스템 프롬프트가 생긴다', async () => {
      const mock = installMock(['ok'])
      await new Agent({ today: true }).send('안녕')

      expect(mock.systemPrompts[0]).toContain(today())
    })

    it('도구 설명서보다 앞에 온다', async () => {
      const mock = installMock(['{"tool":"final","argsJson":"{}","answer":"끝"}'])
      const noop = tool({
        name: 'noop',
        description: '아무것도 안 한다',
        execute: () => 'ok',
      })
      await new Agent({ instruction: '지시문', tools: [noop], today: true }).send('안녕')

      const prompt = mock.systemPrompts[0] ?? ''
      expect(prompt.indexOf(today())).toBeLessThan(prompt.indexOf('지시문'))
      expect(prompt.indexOf('지시문')).toBeLessThan(prompt.indexOf('사용 가능한 도구'))
    })
  })

  it('스트리밍은 조각을 이어붙이면 전체 응답이 된다', async () => {
    installMock(['조각조각 흘러나온다'])
    const a = new Agent()

    let acc = ''
    for await (const chunk of a.stream('가자')) acc += chunk
    expect(acc).toBe('조각조각 흘러나온다')
  })

  it('generate는 스키마를 강제하고 파싱된 객체를 준다', async () => {
    const mock = installMock(['```json\n{"city":"서울","temp":21}\n```'])
    const a = new Agent()

    const out = await a.generate<{ city: string; temp: number }>('날씨', {
      type: 'object',
      properties: { city: { type: 'string' }, temp: { type: 'number' } },
    })
    expect(out).toEqual({ city: '서울', temp: 21 })
    expect(mock.calls[0]?.options?.responseConstraint).toBeDefined()
  })

  it('도구를 호출하고 결과를 받아 최종 답을 만든다', async () => {
    installMock([
      JSON.stringify({ tool: 'weather', argsJson: '{"city":"서울"}', answer: '' }),
      JSON.stringify({ tool: 'final', argsJson: '{}', answer: '서울은 21도다.' }),
    ])

    const seen: Array<string> = []
    const a = new Agent({
      name: 'weatherman',
      tools: [
        tool<{ city: string }>({
          name: 'weather',
          description: '도시 기온을 조회한다',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
          execute: ({ city }) => {
            seen.push(city)
            return { temp: 21 }
          },
        }),
      ],
      onEvent: (e) => {
        if (e.type === 'tool-call') seen.push(`call:${e.tool}`)
      },
    })

    await expect(a.send('서울 날씨')).resolves.toBe('서울은 21도다.')
    expect(seen).toEqual(['call:weather', '서울'])
  })

  it('도구가 던져도 루프는 계속되고 오류가 모델에게 전달된다', async () => {
    const mock = installMock([
      JSON.stringify({ tool: 'boom', argsJson: '{}', answer: '' }),
      JSON.stringify({ tool: 'final', argsJson: '{}', answer: '실패했다고 보고한다.' }),
    ])

    const a = new Agent({
      tools: [
        tool({
          name: 'boom',
          description: '항상 터진다',
          execute: () => {
            throw new Error('터짐')
          },
        }),
      ],
    })

    await expect(a.send('실행해')).resolves.toBe('실패했다고 보고한다.')
    expect(String(mock.calls[1]?.input)).toContain('오류: 터짐')
  })

  it('maxSteps를 넘기면 무한 루프 대신 에러를 던진다', async () => {
    const looping = JSON.stringify({ tool: 'noop', argsJson: '{}', answer: '' })
    installMock([looping, looping])

    const a = new Agent({
      name: 'looper',
      maxSteps: 2,
      tools: [
        tool({ name: 'noop', description: '아무것도 안 한다', execute: () => 'ok' }),
      ],
    })

    await expect(a.send('돌아라')).rejects.toThrow(/maxSteps\(2\)/)
  })
})

describe('컨텍스트 관리', () => {
  it('기본은 세션을 유지해 대화가 이어진다', async () => {
    const mock = installMock(['1', '2'])
    const a = new Agent()

    await a.send('첫 번째')
    await a.send('두 번째')
    expect(mock.created.count).toBe(1) // 세션 하나를 계속 쓴다
  })

  it('stateless면 호출마다 세션을 버려 컨텍스트가 누적되지 않는다', async () => {
    const mock = installMock(['1', '2'])
    const a = new Agent({ stateless: true })

    await a.send('첫 번째')
    await a.send('두 번째')
    expect(mock.created.count).toBe(2) // 매번 백지에서 시작
    expect(mock.created.destroyed).toBe(2)
  })

  it('stateless는 예외가 나도 세션을 반납한다', async () => {
    const mock = installMock([
      () => {
        throw new Error('모델 실패')
      },
    ])
    const a = new Agent({ stateless: true })

    await expect(a.send('실패해라')).rejects.toThrow('모델 실패')
    expect(mock.created.destroyed).toBe(1)
  })

  it('큰 도구 결과는 잘려서 컨텍스트 창을 지킨다', async () => {
    const mock = installMock([
      JSON.stringify({ tool: 'dump', argsJson: '{}', answer: '' }),
      JSON.stringify({ tool: 'final', argsJson: '{}', answer: '요약했다' }),
    ])

    const a = new Agent({
      maxToolResultChars: 100,
      tools: [
        tool({
          name: 'dump',
          description: '거대한 JSON을 뱉는다',
          execute: () => 'x'.repeat(5000),
        }),
      ],
    })

    await a.send('가져와')
    const fed = String(mock.calls[1]?.input)
    expect(fed.length).toBeLessThan(400)
    expect(fed).toContain('4900자 잘림')
  })
})

describe('영속화와 공유 메모리', () => {
  it('history를 저장했다가 새 에이전트에 넣으면 대화가 복원된다', async () => {
    const mock = installMock(['첫 답', '둘째 답'])
    const a = new Agent({ instruction: '너는 비서다.' })
    await a.send('안녕')

    // 새로고침을 흉내낸다: 직렬화 → 복원
    const saved = JSON.stringify(a.history)
    const restored = new Agent({
      instruction: '너는 비서다.',
      history: JSON.parse(saved),
    })
    await restored.send('아까 뭐라 했지?')

    // 복원된 세션의 initialPrompts에 이전 대화가 들어가 있어야 한다
    expect(a.history).toEqual([
      { role: 'user', content: '안녕' },
      { role: 'assistant', content: '첫 답' },
    ])
    expect(mock.created.count).toBe(2)
  })

  it('stateless 에이전트는 기록을 남기지 않는다', async () => {
    installMock(['답'])
    const a = new Agent({ stateless: true })
    await a.send('안녕')
    expect(a.history).toEqual([])
  })

  it('reset은 대화 기록까지 지운다', async () => {
    installMock(['답'])
    const a = new Agent()
    await a.send('안녕')
    a.reset()
    expect(a.history).toEqual([])
  })

  it('같은 store를 공유하면 에이전트끼리 정보를 주고받는다', async () => {
    const store = localMemory('test') // localStorage 없으면 메모리로 대체된다
    const [remember, recall] = memoryTools(store)

    // 첫 에이전트가 저장하고
    await remember!.execute({ key: '고객명', value: '김하영' })
    // 다른 에이전트가 꺼낸다
    await expect(recall!.execute({ key: '고객명' })).resolves.toBe('김하영')
    await expect(recall!.execute({ key: '없는키' })).resolves.toContain('없다')
  })
})

describe('워크플로', () => {
  it('chain은 앞 결과를 뒤 입력으로 넘긴다', async () => {
    const upper = step((s) => s.toUpperCase(), 'upper')
    const exclaim = step((s) => `${s}!`, 'exclaim')

    await expect(chain(upper, exclaim).run('hi')).resolves.toBe('HI!')
  })

  it('parallel은 같은 입력을 나눠 돌리고 합친다', async () => {
    const a = step((s) => `a:${s}`, 'A')
    const b = step((s) => `b:${s}`, 'B')

    await expect(parallel([a, b], { reduce: (r) => r.join('|') }).run('x')).resolves.toBe(
      'a:x|b:x',
    )
  })

  it('router는 분류 결과에 해당하는 경로만 실행한다', async () => {
    installMock([JSON.stringify({ route: 'refund', reason: '환불 문의다' })])

    const flow = router({
      classifier: new Agent({ name: 'clf' }),
      routes: {
        refund: step(() => '환불 처리', 'refund'),
        sales: step(() => '영업 연결', 'sales'),
      },
      descriptions: { refund: '환불/취소', sales: '구매 문의' },
    })

    await expect(flow.run('환불해주세요')).resolves.toBe('환불 처리')
  })

  it('refine은 점수가 기준에 닿으면 조기 종료한다', async () => {
    installMock([JSON.stringify({ score: 95, feedback: '충분하다' })])

    let rounds = 0
    const flow = refine({
      worker: step(() => {
        rounds++
        return '초안'
      }),
      evaluator: new Agent({ name: 'judge' }),
      maxRounds: 3,
      minScore: 80,
    })

    await expect(flow.run('글 써줘')).resolves.toBe('초안')
    expect(rounds).toBe(1)
  })

  it('refine은 점수가 낮으면 피드백을 넣어 다시 쓴다', async () => {
    installMock([
      JSON.stringify({ score: 40, feedback: '너무 짧다' }),
      JSON.stringify({ score: 90, feedback: '좋다' }),
    ])

    const inputs: Array<string> = []
    const flow = refine({
      worker: step((s) => {
        inputs.push(s)
        return `초안${inputs.length}`
      }),
      evaluator: new Agent({ name: 'judge' }),
      maxRounds: 3,
    })

    await expect(flow.run('글 써줘')).resolves.toBe('초안2')
    expect(inputs[1]).toContain('너무 짧다')
  })
})

describe('다운로드 진행률', () => {
  /** monitor가 배선되었는지만 본다. availability는 테스트마다 다르게 준다. */
  function installModel(availability: Availability) {
    let wired = false
    globalThis.LanguageModel = {
      async availability() {
        return availability
      },
      async create(options) {
        wired = options?.monitor !== undefined
        return {
          async prompt() {
            return '답'
          },
          // eslint-disable-next-line require-yield
          async *promptStreaming() {
            return
          },
          async append() {},
          async clone() {
            throw new Error('쓰지 않는다')
          },
          destroy() {},
          contextUsage: 0,
          contextWindow: 4096,
          addEventListener() {},
        }
      },
    }
    return () => wired
  }

  it('이미 받아 둔 모델이면 진행률을 배선하지 않는다', async () => {
    // Chrome은 캐시된 모델에도 downloadprogress를 쏜다(0 찍고 곧바로 1).
    // 그대로 흘리면 페이지를 열 때마다 "다운로드 중"이 번쩍인다.
    const wired = installModel('available')
    await new Agent({ onDownloadProgress: () => {} }).ready()
    expect(wired()).toBe(false)
  })

  it('아직 안 받은 모델이면 진행률을 배선한다', async () => {
    const wired = installModel('downloadable')
    await new Agent({ onDownloadProgress: () => {} }).ready()
    expect(wired()).toBe(true)
  })

  it('콜백을 안 주면 어느 상태든 배선하지 않는다', async () => {
    const wired = installModel('downloadable')
    await new Agent().ready()
    expect(wired()).toBe(false)
  })
})
