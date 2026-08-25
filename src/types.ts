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
  /**
   * 이 입력을 보내면 창을 얼마나 쓸지 미리 계산한다. 보내기 전에 넘칠지 알 수 있다.
   * 구형 Chrome에는 없을 수 있으므로 optional이다.
   */
  measureContextUsage?: (input: AgentInput) => Promise<number>
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

/* ────────────────────────────────────────────────────────────────────────────
 * Task API — 번역/요약/언어감지 전용 기능.
 *
 * Prompt API와 달리 한 가지 일만 하도록 만들어진 별개 모델이다. 그래서
 * (1) 같은 일에 더 정확하고 (2) 더 빠르며 (3) **LanguageModel의 컨텍스트 창을
 * 전혀 쓰지 않는다**. 창이 수천 토큰뿐인 온디바이스 환경에서 세 번째가 가장 크다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** create()가 공통으로 받는 옵션. 이 모델들도 첫 사용 시 다운로드된다. */
export interface TaskCreateOptions {
  signal?: AbortSignal
  monitor?: (monitor: DownloadMonitor) => void
}

export interface TranslatorOptions extends TaskCreateOptions {
  /** BCP 47 태그. 예: 'en' */
  sourceLanguage: string
  /** BCP 47 태그. 예: 'ko'. sourceLanguage와 같으면 create()가 던진다. */
  targetLanguage: string
}

export interface TranslatorInstance {
  translate: (input: string, options?: { signal?: AbortSignal }) => Promise<string>
  destroy: () => void
}

export interface TranslatorStatic {
  availability: (options: {
    sourceLanguage: string
    targetLanguage: string
  }) => Promise<Availability>
  create: (options: TranslatorOptions) => Promise<TranslatorInstance>
}

export interface SummarizerOptions extends TaskCreateOptions {
  /** 'tldr' | 'key-points' | 'teaser' | 'headline' */
  type?: string
  /** 'markdown' | 'plain-text' */
  format?: string
  /** 'short' | 'medium' | 'long' */
  length?: string
  /** 모든 요약에 공통으로 깔리는 배경 설명 */
  sharedContext?: string
  expectedInputLanguages?: Array<string>
  outputLanguage?: string
}

export interface SummarizerInstance {
  summarize: (
    input: string,
    options?: { context?: string; signal?: AbortSignal },
  ) => Promise<string>
  destroy: () => void
}

export interface SummarizerStatic {
  availability: (options?: SummarizerOptions) => Promise<Availability>
  create: (options?: SummarizerOptions) => Promise<SummarizerInstance>
}

/** detect() 결과 한 건. confidence 내림차순으로 온다. */
export interface DetectedLanguage {
  detectedLanguage: string
  confidence: number
}

export interface LanguageDetectorInstance {
  detect: (
    input: string,
    options?: { signal?: AbortSignal },
  ) => Promise<Array<DetectedLanguage>>
  destroy: () => void
}

export interface LanguageDetectorStatic {
  availability: (options?: {
    expectedInputLanguages?: Array<string>
  }) => Promise<Availability>
  create: (
    options?: TaskCreateOptions & { expectedInputLanguages?: Array<string> },
  ) => Promise<LanguageDetectorInstance>
}

/** write/rewrite 호출마다 줄 수 있는 배경 설명 */
export interface TaskInvokeOptions {
  context?: string
  signal?: AbortSignal
}

export interface WriterOptions extends TaskCreateOptions {
  /** 'formal' | 'neutral' | 'casual' */
  tone?: string
  /** 'markdown' | 'plain-text' */
  format?: string
  /** 'short' | 'medium' | 'long' */
  length?: string
  sharedContext?: string
  expectedInputLanguages?: Array<string>
  outputLanguage?: string
}

export interface WriterInstance {
  write: (input: string, options?: TaskInvokeOptions) => Promise<string>
  destroy: () => void
}

export interface WriterStatic {
  availability: (options?: WriterOptions) => Promise<Availability>
  create: (options?: WriterOptions) => Promise<WriterInstance>
}

export interface RewriterOptions extends TaskCreateOptions {
  /** 'more-formal' | 'as-is' | 'more-casual' */
  tone?: string
  /** 'as-is' | 'markdown' | 'plain-text' */
  format?: string
  /** 'shorter' | 'as-is' | 'longer' */
  length?: string
  sharedContext?: string
  expectedInputLanguages?: Array<string>
  outputLanguage?: string
}

export interface RewriterInstance {
  rewrite: (input: string, options?: TaskInvokeOptions) => Promise<string>
  destroy: () => void
}

export interface RewriterStatic {
  availability: (options?: RewriterOptions) => Promise<Availability>
  create: (options?: RewriterOptions) => Promise<RewriterInstance>
}

/** 교정 한 건. 원문에서 몇 번째 글자부터 몇 번째까지가 잘못됐는지 알려준다. */
export interface ProofreadCorrection {
  startIndex: number
  endIndex: number
  correction?: string
  type?: string
  explanation?: string
}

/** proofread() 결과. 고친 전문과 어디를 왜 고쳤는지가 같이 온다. */
export interface ProofreadResult {
  correctedInput: string
  corrections: Array<ProofreadCorrection>
}

export interface ProofreaderOptions extends TaskCreateOptions {
  expectedInputLanguages?: Array<string>
  includeCorrectionTypes?: boolean
  includeCorrectionExplanations?: boolean
}

export interface ProofreaderInstance {
  proofread: (
    input: string,
    options?: { signal?: AbortSignal },
  ) => Promise<ProofreadResult>
  destroy: () => void
}

export interface ProofreaderStatic {
  availability: (options?: ProofreaderOptions) => Promise<Availability>
  create: (options?: ProofreaderOptions) => Promise<ProofreaderInstance>
}

declare global {
  /** Chrome 138+ 에서 노출되는 전역. 미지원 브라우저에서는 undefined. */

  var LanguageModel: LanguageModelStatic | undefined

  var Translator: TranslatorStatic | undefined

  var Summarizer: SummarizerStatic | undefined

  var LanguageDetector: LanguageDetectorStatic | undefined

  /** Chrome 137~148 오리진 트라이얼. 안정 버전에는 아직 없다. */

  var Writer: WriterStatic | undefined

  var Rewriter: RewriterStatic | undefined

  /** Chrome 141~145 오리진 트라이얼. 안정 버전에는 아직 없다. */

  var Proofreader: ProofreaderStatic | undefined
}
