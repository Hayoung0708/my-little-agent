/**
 * Chrome Built-in AI(Prompt API) 타입 정의.
 *
 * lib.dom.d.ts 에 아직 들어있지 않아서 우리가 실제로 쓰는 부분만 직접 선언한다.
 * 스펙 문서: https://developer.chrome.com/docs/ai/prompt-api
 */

/** 모델 사용 가능 상태. 'available' 만 즉시 사용 가능하고, 'downloadable'은 첫 create()에서 다운로드가 시작된다. */
export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

/** 멀티모달 입력 조각. 이미지는 Blob/Canvas/ImageBitmap, 오디오는 Blob/AudioBuffer 등이 들어간다. */
export interface PromptPart {
  type: 'text' | 'image' | 'audio'
  value: unknown
}

/** 대화 메시지 한 턴 */
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<PromptPart>
  /** true면 모델이 이 메시지를 "이어서" 완성한다(응답 앞부분 고정용). */
  prefix?: boolean
}

/** 에이전트 입력: 단순 문자열이거나 멀티모달 메시지 배열 */
export type AgentInput = string | Array<PromptMessage>

/** JSON Schema. 엄밀한 타입 대신 느슨하게 둔다(스키마 종류가 너무 많음). */
export type JSONSchema = Record<string, unknown>

export interface PromptOptions {
  signal?: AbortSignal
  /** JSON Schema를 주면 모델 출력이 해당 스키마로 강제된다. */
  responseConstraint?: JSONSchema
  /** true면 스키마 자체를 프롬프트에 포함하지 않는다(토큰 절약). */
  omitResponseConstraintInput?: boolean
}

/** LanguageModel.create()가 돌려주는 세션. 대화 히스토리는 세션이 들고 있다. */
export interface LanguageModelSession {
  prompt: (input: AgentInput, options?: PromptOptions) => Promise<string>
  promptStreaming: (input: AgentInput, options?: PromptOptions) => AsyncIterable<string>
  append: (messages: Array<PromptMessage>) => Promise<void>
  clone: (options?: { signal?: AbortSignal }) => Promise<LanguageModelSession>
  destroy: () => void
  /** 현재 사용 중인 컨텍스트 토큰 수 */
  readonly contextUsage: number
  /** 컨텍스트 창 최대 토큰 수 */
  readonly contextWindow: number
  addEventListener: (type: 'contextoverflow', listener: () => void) => void
}

/** 기대하는 입출력 modality 선언(모델 다운로드 대상을 결정한다) */
export interface ExpectedIO {
  type: 'text' | 'image' | 'audio'
  languages?: Array<string>
}

export interface DownloadMonitor {
  addEventListener: (
    type: 'downloadprogress',
    listener: (event: { loaded: number }) => void,
  ) => void
}

export interface CreateOptions {
  initialPrompts?: Array<PromptMessage>
  temperature?: number
  topK?: number
  signal?: AbortSignal
  expectedInputs?: Array<ExpectedIO>
  expectedOutputs?: Array<ExpectedIO>
  monitor?: (monitor: DownloadMonitor) => void
}

/** LanguageModel.params()가 돌려주는 모델 기본값/한계값 */
export interface ModelParams {
  defaultTopK: number
  maxTopK: number
  defaultTemperature: number
  maxTemperature: number
}

export interface LanguageModelStatic {
  availability: (options?: {
    expectedInputs?: Array<ExpectedIO>
    expectedOutputs?: Array<ExpectedIO>
  }) => Promise<Availability>
  create: (options?: CreateOptions) => Promise<LanguageModelSession>
  params?: () => Promise<ModelParams | null>
}

declare global {
  /** Chrome 138+ 에서 노출되는 전역. 미지원 브라우저에서는 undefined. */

  var LanguageModel: LanguageModelStatic | undefined
}
