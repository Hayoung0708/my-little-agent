import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chain,
  languageDetector,
  proofreader,
  rewriter,
  summarizer,
  translator,
  writer,
} from '../src/index'
import type { Availability, DetectedLanguage } from '../src/types'

/** 가짜 Translator 전역. availability는 언어 조합마다 답을 다르게 줄 수 있다. */
function installTranslator(
  options: {
    availability?: (pair: {
      sourceLanguage: string
      targetLanguage: string
    }) => Availability
    translate?: (input: string) => string
    throwOnCreate?: boolean
  } = {},
) {
  const created: Array<string> = []
  let destroyed = 0

  globalThis.Translator = {
    async availability(pair) {
      return options.availability?.(pair) ?? 'available'
    },
    async create(pair) {
      created.push(`${pair.sourceLanguage}->${pair.targetLanguage}`)
      if (options.throwOnCreate) throw new Error('NotSupportedError')
      return {
        async translate(input) {
          return options.translate?.(input) ?? `[${pair.targetLanguage}]${input}`
        },
        destroy() {
          destroyed++
        },
      }
    },
  }
  return { created, destroyed: () => destroyed }
}

function installDetector(results: Array<DetectedLanguage> | 'unavailable') {
  globalThis.LanguageDetector = {
    async availability() {
      return results === 'unavailable' ? 'unavailable' : 'available'
    },
    async create() {
      return {
        async detect() {
          return results === 'unavailable' ? [] : results
        },
        destroy() {},
      }
    },
  }
}

function installSummarizer(summarize: (input: string) => string) {
  let created = 0
  globalThis.Summarizer = {
    async availability() {
      return 'available'
    },
    async create() {
      created++
      return {
        async summarize(input) {
          return summarize(input)
        },
        destroy() {},
      }
    },
  }
  return { created: () => created }
}

afterEach(() => {
  globalThis.Translator = undefined
  globalThis.Summarizer = undefined
  globalThis.LanguageDetector = undefined
  globalThis.LanguageModel = undefined
  globalThis.Writer = undefined
  globalThis.Rewriter = undefined
  globalThis.Proofreader = undefined
})

describe('translator', () => {
  it('from을 주면 그 조합으로 바로 번역한다', async () => {
    const api = installTranslator()
    const step = translator({ to: 'ko', from: 'en' })

    expect(await step.run('Hello')).toBe('[ko]Hello')
    expect(api.created).toEqual(['en->ko'])
  })

  it('from을 생략하면 LanguageDetector로 출발어를 감지한다', async () => {
    const api = installTranslator()
    installDetector([
      { detectedLanguage: 'fr', confidence: 0.2 },
      { detectedLanguage: 'en', confidence: 0.9 },
    ])

    // 확신도가 가장 높은 것을 고른다. 배열 순서가 아니라 confidence 기준이다.
    expect(await translator({ to: 'ko' }).run('Hello')).toBe('[ko]Hello')
    expect(api.created).toEqual(['en->ko'])
  })

  it('출발어와 도착어가 같으면 입력을 그대로 돌려주고 세션을 만들지 않는다', async () => {
    const api = installTranslator()
    installDetector([{ detectedLanguage: 'ko', confidence: 0.99 }])

    // Translator.create는 같은 언어 조합에 NotSupportedError를 던진다. 도달하면 안 된다.
    expect(await translator({ to: 'ko' }).run('안녕')).toBe('안녕')
    expect(api.created).toEqual([])
  })

  it('같은 언어 조합은 인스턴스를 재사용한다', async () => {
    const api = installTranslator()
    const step = translator({ to: 'ko', from: 'en' })

    await step.run('one')
    await step.run('two')
    expect(api.created).toEqual(['en->ko'])
  })

  it('지원하지 않는 조합이면 fallback으로 넘긴다', async () => {
    installTranslator({ availability: () => 'unavailable' })
    const fallback = { name: 'fb', run: vi.fn(async (input: string) => `모델:${input}`) }

    expect(await translator({ to: 'ko', from: 'en', fallback }).run('Hi')).toBe('모델:Hi')
    expect(fallback.run).toHaveBeenCalledWith('Hi')
  })

  it('Translator 전역이 없고 fallback도 없으면 이유를 밝히고 던진다', async () => {
    await expect(translator({ to: 'ko', from: 'en' }).run('Hi')).rejects.toThrow(
      /Translator API/,
    )
  })

  it('감지에 실패하면 원문을 흘리지 않고 fallback으로 넘긴다', async () => {
    installTranslator()
    installDetector('unavailable')
    const fallback = { name: 'fb', run: async (input: string) => `모델:${input}` }

    // 조용히 원문을 돌려주면 호출부가 번역 실패를 알 수 없다.
    expect(await translator({ to: 'ko', fallback }).run('Hello')).toBe('모델:Hello')
  })

  it('create가 던지면 캐시를 비워 다음 호출이 다시 시도한다', async () => {
    let fail = true
    globalThis.Translator = {
      async availability() {
        return 'available'
      },
      async create() {
        if (fail) throw new Error('NotSupportedError')
        return {
          async translate(input: string) {
            return `ok:${input}`
          },
          destroy() {},
        }
      },
    }
    const step = translator({ to: 'ko', from: 'en' })

    await expect(step.run('Hi')).rejects.toThrow('NotSupportedError')
    fail = false
    expect(await step.run('Hi')).toBe('ok:Hi')
  })
})

describe('summarizer', () => {
  it('요약하고 인스턴스를 재사용한다', async () => {
    const api = installSummarizer((input) => `요약(${input.length}자)`)
    const step = summarizer({ type: 'tldr', length: 'short' })

    expect(await step.run('12345')).toBe('요약(5자)')
    await step.run('678')
    expect(api.created()).toBe(1)
  })

  it('Summarizer가 없으면 fallback으로 넘긴다', async () => {
    const fallback = { name: 'fb', run: async (input: string) => `모델요약:${input}` }
    expect(await summarizer({ fallback }).run('긴 글')).toBe('모델요약:긴 글')
  })
})

describe('languageDetector', () => {
  it('확신도가 가장 높은 언어 코드를 돌려준다', async () => {
    installDetector([
      { detectedLanguage: 'es', confidence: 0.1 },
      { detectedLanguage: 'fr', confidence: 0.8 },
    ])
    expect(await languageDetector().run('Bonjour')).toBe('fr')
  })

  it('결과가 비면 빈 문자열 대신 fallback으로 넘긴다', async () => {
    installDetector('unavailable')
    const fallback = { name: 'fb', run: async () => 'unknown' }
    expect(await languageDetector({ fallback }).run('?')).toBe('unknown')
  })
})

describe('writer / rewriter — 오리진 트라이얼 단계', () => {
  it('writer는 create 옵션과 호출별 context를 함께 넘긴다', async () => {
    const seen: { create?: unknown; invoke?: unknown } = {}
    globalThis.Writer = {
      async availability() {
        return 'available'
      },
      async create(create) {
        seen.create = { tone: create?.tone, length: create?.length }
        return {
          async write(input, options) {
            seen.invoke = options?.context
            return `작성:${input}`
          },
          destroy() {},
        }
      },
    }

    const step = writer({ tone: 'formal', length: 'short', context: '은행 고객' })
    expect(await step.run('환불 요청 메일')).toBe('작성:환불 요청 메일')
    expect(seen.create).toEqual({ tone: 'formal', length: 'short' })
    // context는 create가 아니라 매 호출에 실린다.
    expect(seen.invoke).toBe('은행 고객')
  })

  it('rewriter는 전역이 없으면 fallback으로 넘어간다 — 지금 Chrome 안정 버전이 이 경우다', async () => {
    const fallback = { name: 'fb', run: async (input: string) => `모델재작성:${input}` }
    expect(await rewriter({ tone: 'more-casual', fallback }).run('격식체 글')).toBe(
      '모델재작성:격식체 글',
    )
  })

  it('실패한 인스턴스는 버려서 다음 호출이 다시 만든다', async () => {
    let created = 0
    let fail = true
    globalThis.Rewriter = {
      async availability() {
        return 'available'
      },
      async create() {
        created++
        return {
          async rewrite(input: string) {
            if (fail) throw new Error('일시 실패')
            return `ok:${input}`
          },
          destroy() {},
        }
      },
    }
    const step = rewriter({})

    await expect(step.run('x')).rejects.toThrow('일시 실패')
    fail = false
    expect(await step.run('x')).toBe('ok:x')
    expect(created).toBe(2)
  })
})

describe('proofreader', () => {
  function installProofreader() {
    globalThis.Proofreader = {
      async availability() {
        return 'available'
      },
      async create() {
        return {
          async proofread(input: string) {
            return {
              correctedInput: input.replace('seen', 'saw'),
              corrections: [{ startIndex: 2, endIndex: 6, correction: 'saw' }],
            }
          },
          destroy() {},
        }
      },
    }
  }

  it('run()은 고쳐진 글만 돌려준다', async () => {
    installProofreader()
    expect(await proofreader().run('I seen him')).toBe('I saw him')
  })

  it('proofread()는 어디를 고쳤는지까지 돌려준다', async () => {
    installProofreader()
    const result = await proofreader().proofread('I seen him')

    expect(result.correctedInput).toBe('I saw him')
    expect(result.corrections).toEqual([
      { startIndex: 2, endIndex: 6, correction: 'saw' },
    ])
  })

  it('proofread()는 fallback이 있어도 못 쓰면 던진다 — 교정 목록은 모델이 못 만든다', async () => {
    const fallback = { name: 'fb', run: async (input: string) => input }

    // run()은 fallback을 타지만
    expect(await proofreader({ fallback }).run('I seen him')).toBe('I seen him')
    // proofread()는 문자열이 아닌 결과라 대체할 수 없다.
    await expect(proofreader({ fallback }).proofread('I seen him')).rejects.toThrow(
      /Proofreader API/,
    )
  })
})

describe('워크플로에 꽂기', () => {
  it('Task 단계는 Runnable이라 chain에 그대로 들어간다', async () => {
    installTranslator()
    installSummarizer(() => 'short summary')

    const flow = chain(summarizer(), translator({ to: 'ko', from: 'en' }))

    expect(await flow.run('아주 긴 원문')).toBe('[ko]short summary')
    // Prompt API 세션을 하나도 만들지 않았다 = 컨텍스트 창 사용량 0
    expect(globalThis.LanguageModel).toBeUndefined()
  })
})

describe('다운로드 진행률', () => {
  /** Summarizer로 Task API 공통 경로를 대표해 본다. 여섯 종류가 같은 lazyTask를 쓴다. */
  function installSummarizerWith(availability: Availability) {
    let wired = false
    globalThis.Summarizer = {
      async availability() {
        return availability
      },
      async create(options) {
        wired = options?.monitor !== undefined
        return {
          async summarize(input: string) {
            return input
          },
          destroy() {},
        }
      },
    }
    return () => wired
  }

  it('이미 받아 둔 모델이면 진행률을 배선하지 않는다', async () => {
    const wired = installSummarizerWith('available')
    await summarizer({ onDownloadProgress: () => {} }).run('긴 글')
    expect(wired()).toBe(false)
  })

  it('아직 안 받은 모델이면 진행률을 배선한다', async () => {
    const wired = installSummarizerWith('downloadable')
    await summarizer({ onDownloadProgress: () => {} }).run('긴 글')
    expect(wired()).toBe(true)
  })
})
