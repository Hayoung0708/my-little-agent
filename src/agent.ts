import { createSession } from './model'
import {
  FINAL,
  parseJson,
  stepSchema,
  stringifyResult,
  toolManual,
  truncate,
} from './tool'
import type { AgentTool } from './tool'
import type { SessionOptions } from './model'
import type {
  AgentInput,
  ExpectedIO,
  JSONSchema,
  LanguageModelSession,
  PromptMessage,
} from './types'

/** 실행 중 관찰할 수 있는 이벤트. 로깅/트레이싱 UI에 그대로 흘려주면 된다. */
export type AgentEvent =
  | { type: 'tool-call'; agent: string; tool: string; args: unknown }
  | { type: 'tool-result'; agent: string; tool: string; result: string }
  | { type: 'tool-error'; agent: string; tool: string; error: string }
  | { type: 'final'; agent: string; text: string }
  | { type: 'context-overflow'; agent: string }

export interface AgentOptions {
  /** 로그와 병렬 워크플로우 결과 라벨에 쓰인다. */
  name?: string
  /** 시스템 프롬프트. 이 에이전트의 역할을 여기 적는다. */
  instruction?: string
  /** 이 에이전트가 쓸 도구들. 하나라도 있으면 툴 루프 모드로 동작한다. */
  tools?: Array<AgentTool>
  /** 0에 가까울수록 결정적. temperature와 topK는 같이 주는 것을 권장한다. */
  temperature?: number
  topK?: number
  /** 툴 루프 최대 반복 횟수. 초과하면 에러를 던진다. */
  maxSteps?: number
  /**
   * true면 호출이 끝날 때마다 세션을 버린다. 즉 매 호출이 백지에서 시작한다.
   *
   * 워크플로우 단계로 쓰는 에이전트는 켜라. 안 켜면 flow.run()을 두 번째 호출할 때
   * 첫 번째 실행의 대화가 컨텍스트에 그대로 남아 창을 갉아먹는다.
   * 반대로 챗봇처럼 대화를 이어가야 하면 꺼둔다(기본값).
   */
  stateless?: boolean
  /**
   * 도구 결과를 모델에게 돌려줄 때 잘라낼 최대 글자 수. 기본 4000자.
   *
   * 컨텍스트 창이 수천 토큰뿐이라, 큰 JSON을 그대로 넣으면 대화가 통째로 밀려난다.
   * 자르지 않으려면 Infinity를 준다.
   */
  maxToolResultChars?: number
  /**
   * 이전 대화 기록. agent.history를 저장해 뒀다가 그대로 넣으면 대화가 복원된다.
   * 새로고침 후 이어가기, 탭 간 동기화에 쓴다.
   */
  history?: Array<PromptMessage>
  /**
   * 오늘 날짜를 시스템 프롬프트에 한 줄로 넣는다. **기본값 false.**
   *
   * 온디바이스 모델은 학습 시점이 고정되어 있고 시계도 없어서, 날짜를 물으면
   * 확신에 찬 오답을 낸다. 에러가 아니라 조용한 오답이라 가장 알아채기 어렵다.
   * 날짜나 기간을 다루는 에이전트라면 켜라.
   *
   * 도구로 만들지 않은 이유: 도구는 모델이 판단해 호출하고 결과를 되먹이는 왕복이 든다.
   * 날짜는 값이 정해져 있으므로 처음부터 넣는 편이 20토큰 남짓으로 훨씬 싸다.
   *
   * 사용자 기기의 로컬 날짜를 쓴다. 시각이 아니라 날짜만 넣는 이유는,
   * 세션이 몇십 분 살아 있으면 주입한 시각이 낡아버리기 때문이다.
   */
  today?: boolean
  /** 멀티모달을 쓸 때 선언한다. 예: [{ type: 'image' }] */
  expectedInputs?: Array<ExpectedIO>
  expectedOutputs?: Array<ExpectedIO>
  /** 모델 다운로드 진행률(0~1) */
  onDownloadProgress?: (loaded: number) => void
  /** 전체 실행 취소용 */
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
}

/**
 * 시스템 프롬프트에 넣을 오늘 날짜 한 줄.
 *
 * 영어로 쓴다. 지시문이 어느 언어든 모델이 가장 잘 다루는 형식이고, 토큰도 가장 적게 든다.
 * 요일까지 넣는 이유는 "다음 주 월요일" 같은 요청이 요일 없이는 계산되지 않기 때문이다.
 */
function todayLine(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const weekday = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ][now.getDay()]
  return `Today's date: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} (${weekday}).`
}

/** chain/parallel/router가 다루는 최소 단위. Agent도 워크플로우도 전부 이걸 만족한다. */
export interface Runnable {
  readonly name: string
  run: (input: string) => Promise<string>
}

/**
 * Chrome Built-in AI 세션 하나를 감싼 에이전트.
 *
 * - 도구가 없으면 세션에 그대로 프롬프트를 넘긴다(스트리밍 가능).
 * - 도구가 있으면 제약 디코딩(JSON Schema)으로 툴 루프를 돌린다.
 *
 * 세션은 첫 호출 때 lazy 생성되므로 인스턴스를 미리 만들어 둬도 모델을 붙잡지 않는다.
 */
export class Agent implements Runnable {
  readonly name: string
  #options: AgentOptions
  #session: LanguageModelSession | null = null
  #creating: Promise<LanguageModelSession> | null = null
  /** 세션과 별개로 우리가 들고 있는 대화 기록. 세션은 읽을 수 없어서 직접 기록한다. */
  #transcript: Array<PromptMessage>

  constructor(options: AgentOptions = {}) {
    this.name = options.name ?? 'agent'
    this.#options = options
    this.#transcript = options.history ? [...options.history] : []
  }

  /** 시스템 프롬프트 = 오늘 날짜 + 지시문 + (도구가 있으면) 도구 설명서 */
  #systemPrompt(): string {
    const parts: Array<string> = []
    if (this.#options.today) parts.push(todayLine())
    if (this.#options.instruction) parts.push(this.#options.instruction)
    const tools = this.#options.tools ?? []
    if (tools.length) parts.push(toolManual(tools))
    return parts.join('\n')
  }

  /** 세션을 만들고(이미 있으면 재사용) 반환한다. 동시 호출해도 한 번만 만든다. */
  async ready(): Promise<LanguageModelSession> {
    if (this.#session) return this.#session
    if (this.#creating) return this.#creating

    const system = this.#systemPrompt()
    const initialPrompts: Array<PromptMessage> = system
      ? [{ role: 'system', content: system }, ...this.#transcript]
      : [...this.#transcript]

    const options: SessionOptions = {
      initialPrompts,
      expectedInputs: this.#options.expectedInputs,
      expectedOutputs: this.#options.expectedOutputs,
      onDownloadProgress: this.#options.onDownloadProgress,
      signal: this.#options.signal,
    }
    // temperature/topK는 Chrome이 "둘 다 주거나 둘 다 안 주거나"만 허용한다.
    if (this.#options.temperature !== undefined)
      options.temperature = this.#options.temperature
    if (this.#options.topK !== undefined) options.topK = this.#options.topK

    this.#creating = createSession(options).then((session) => {
      session.addEventListener('contextoverflow', () => {
        this.#emit({ type: 'context-overflow', agent: this.name })
      })
      this.#session = session
      this.#creating = null
      return session
    })
    return this.#creating
  }

  #emit(event: AgentEvent): void {
    this.#options.onEvent?.(event)
  }

  /** Runnable 구현. send()의 별칭이라 워크플로우에 그대로 꽂을 수 있다. */
  run(input: string): Promise<string> {
    return this.send(input)
  }

  /** stateless 모드면 호출이 끝날 때마다 세션을 버려 컨텍스트 누적을 막는다. */
  #endTurn(): void {
    if (this.#options.stateless) this.destroy()
  }

  /**
   * 대화 기록에 한 턴을 남긴다. stateless 에이전트는 기억하지 않는 것이 정의이므로 건너뛴다.
   * 멀티모달 입력은 이미지/오디오를 직렬화할 수 없어 텍스트 조각만 남긴다.
   */
  #record(input: AgentInput, answer: string): void {
    if (this.#options.stateless) return
    const text =
      typeof input === 'string'
        ? input
        : input
            .flatMap((m) =>
              typeof m.content === 'string'
                ? [m.content]
                : m.content.filter((p) => p.type === 'text').map((p) => String(p.value)),
            )
            .join('\n')
    this.#transcript.push(
      { role: 'user', content: text },
      { role: 'assistant', content: answer },
    )
  }

  /**
   * 지금까지의 대화 기록. JSON으로 저장했다가 history 옵션으로 넣으면 복원된다.
   *
   * ```ts
   * localStorage.setItem('chat', JSON.stringify(agent.history))
   * const restored = new Agent({ instruction, history: JSON.parse(saved) })
   * ```
   */
  get history(): Array<PromptMessage> {
    return [...this.#transcript]
  }

  /** 한 번 질의하고 최종 텍스트를 받는다. 도구가 있으면 툴 루프를 끝까지 돌린다. */
  async send(input: AgentInput): Promise<string> {
    const session = await this.ready()
    const tools = this.#options.tools ?? []

    try {
      const text = tools.length
        ? await this.#runToolLoop(session, input, tools)
        : await session.prompt(input, { signal: this.#options.signal })
      if (!tools.length) this.#emit({ type: 'final', agent: this.name, text })
      this.#record(input, text)
      return text
    } finally {
      this.#endTurn()
    }
  }

  /**
   * 토큰 단위 스트리밍.
   * 도구가 있는 에이전트는 루프가 끝나야 답이 확정되므로 최종 답변 한 덩어리만 흘린다.
   */
  async *stream(input: AgentInput): AsyncGenerator<string, void, void> {
    const session = await this.ready()
    const tools = this.#options.tools ?? []

    try {
      if (tools.length) {
        const text = await this.#runToolLoop(session, input, tools)
        this.#record(input, text)
        yield text
        return
      }
      let acc = ''
      for await (const chunk of session.promptStreaming(input, {
        signal: this.#options.signal,
      })) {
        acc += chunk
        yield chunk
      }
      this.#record(input, acc)
    } finally {
      // 소비자가 중간에 break해도 세션 정리가 보장된다.
      this.#endTurn()
    }
  }

  /** JSON Schema로 출력 형태를 강제해 객체로 받는다. 라우팅/평가에 쓴다. */
  async generate<T>(input: AgentInput, schema: JSONSchema): Promise<T> {
    const session = await this.ready()
    try {
      const raw = await session.prompt(input, {
        responseConstraint: schema,
        signal: this.#options.signal,
      })
      return parseJson<T>(raw)
    } finally {
      this.#endTurn()
    }
  }

  /** 도구 호출 루프. 최종 답변이 나올 때까지 최대 maxSteps번 돈다. */
  async #runToolLoop(
    session: LanguageModelSession,
    input: AgentInput,
    tools: Array<AgentTool>,
  ): Promise<string> {
    const schema = stepSchema(tools.map((t) => t.name))
    const maxSteps = this.#options.maxSteps ?? 5
    let next: AgentInput = input

    for (let step = 0; step < maxSteps; step++) {
      const raw = await session.prompt(next, {
        responseConstraint: schema,
        signal: this.#options.signal,
      })
      const decision = parseJson<{ tool: string; argsJson: string; answer: string }>(raw)

      if (!decision.tool || decision.tool === FINAL) {
        this.#emit({ type: 'final', agent: this.name, text: decision.answer })
        return decision.answer
      }

      const target = tools.find((t) => t.name === decision.tool)
      if (!target) {
        // 없는 도구를 지목한 경우: 목록을 다시 알려주고 한 번 더 기회를 준다.
        next = `"${decision.tool}" 도구는 없다. 사용 가능한 도구: ${tools
          .map((t) => t.name)
          .join(', ')}. 다시 선택해라.`
        continue
      }

      let args: unknown = {}
      try {
        args = decision.argsJson ? parseJson<unknown>(decision.argsJson) : {}
      } catch {
        next = `${target.name}의 argsJson이 올바른 JSON이 아니다. JSON 문자열로 다시 보내라.`
        continue
      }

      this.#emit({ type: 'tool-call', agent: this.name, tool: target.name, args })

      let result: string
      try {
        // 큰 결과를 그대로 넣으면 좁은 컨텍스트 창이 한 번에 밀려나므로 잘라서 돌려준다.
        result = truncate(
          stringifyResult(await target.execute(args)),
          this.#options.maxToolResultChars ?? 4000,
        )
        this.#emit({ type: 'tool-result', agent: this.name, tool: target.name, result })
      } catch (error) {
        // 도구 실패는 루프를 죽이지 않는다. 모델이 복구하거나 다른 도구를 고르게 둔다.
        result = `오류: ${error instanceof Error ? error.message : String(error)}`
        this.#emit({
          type: 'tool-error',
          agent: this.name,
          tool: target.name,
          error: result,
        })
      }

      next = `${target.name} 실행 결과:\n${result}\n\n이 결과로 최종 답을 하거나 다른 도구를 호출해라.`
    }

    throw new Error(
      `${this.name}: maxSteps(${maxSteps})를 초과했다. 도구 설명을 더 구체적으로 쓰거나 maxSteps를 늘려라.`,
    )
  }

  /** 현재 대화를 복제한 새 에이전트. 같은 컨텍스트에서 갈라져 실험할 때 쓴다. */
  async fork(name = `${this.name}-fork`): Promise<Agent> {
    const session = await this.ready()
    const forked = new Agent({ ...this.#options, name })
    forked.#transcript = [...this.#transcript]
    forked.#session = await session.clone({ signal: this.#options.signal })
    return forked
  }

  /** 컨텍스트 사용량. 세션이 아직 없으면 null. */
  get usage(): { used: number; total: number } | null {
    if (!this.#session) return null
    return { used: this.#session.contextUsage, total: this.#session.contextWindow }
  }

  /** 대화 기록까지 전부 버린다. 다음 호출은 백지에서 시작한다. */
  reset(): void {
    this.destroy()
    this.#transcript = []
  }

  /** 세션을 해제한다. 다 쓴 에이전트는 반드시 호출해 메모리를 돌려줘라. */
  destroy(): void {
    this.#session?.destroy()
    this.#session = null
  }
}

/** `new Agent(...)` 대신 쓰는 짧은 생성자 */
export function agent(options: AgentOptions = {}): Agent {
  return new Agent(options)
}
