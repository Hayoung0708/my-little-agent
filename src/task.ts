import type { Runnable } from './agent'
import type {
  Availability,
  DetectedLanguage,
  DownloadMonitor,
  LanguageDetectorInstance,
  ProofreadResult,
  ProofreaderInstance,
  ProofreaderOptions,
  RewriterInstance,
  RewriterOptions,
  SummarizerInstance,
  SummarizerOptions,
  TranslatorInstance,
  WriterInstance,
  WriterOptions,
} from './types'

/**
 * Task API 단계 — 번역·요약·언어감지·작성·재작성·교정을 Runnable로 감싼 것.
 *
 * 이 단계들은 Prompt API 세션을 **전혀 만들지 않는다**. 그래서 chain 중간에 몇 개를 끼워도
 * 에이전트의 컨텍스트 창을 1토큰도 먹지 않는다. 창이 좁은 온디바이스 환경에서
 * "모델에게 시키지 않고 끝낼 수 있는 일"을 골라내는 것이 가장 큰 절약이다.
 *
 * ```ts
 * chain(analyst, summarizer(), translator({ to: 'ko' }))
 * //    ↑ 모델    ↑ 요약 전용    ↑ 번역 전용 (뒤 둘은 창 사용량 0)
 * ```
 *
 * **출시 상태가 제각각이다.** translator·summarizer·languageDetector는 Chrome 138부터
 * 안정 버전에 있고, writer·rewriter·proofreader는 아직 오리진 트라이얼이다.
 * 어느 쪽이든 못 쓰면 fallback으로 넘어가므로, 지금 코드를 그대로 두면
 * Chrome이 정식 출시하는 시점에 자동으로 빠른 경로를 타게 된다.
 */

/** 모든 Task 단계가 공통으로 받는 옵션 */
export interface TaskOptions {
  signal?: AbortSignal
  /**
   * 이 기능을 쓸 수 없을 때 대신 실행할 단계. 보통 같은 일을 하도록 지시한 Agent를 준다.
   *
   * 언어 조합을 지원하지 않거나, 구형 Chrome이거나, 모델이 아직 없을 때로 넘어간다.
   * 주지 않으면 그 상황에서 에러를 던진다.
   *
   * ```ts
   * translator({
   *   to: 'ko',
   *   fallback: new Agent({ instruction: '입력을 한국어로만 번역해 출력해라.' }),
   * })
   * ```
   */
  fallback?: Runnable
  /** 모델 다운로드 진행률(0~1). Task 모델도 첫 사용 시 내려받는다. */
  onDownloadProgress?: (loaded: number) => void
}

/** Runnable에 정리(destroy)를 얹은 형태. Task 모델도 다 쓰면 놓아줘야 한다. */
export interface TaskRunnable extends Runnable {
  destroy: () => void
}

/** monitor 배선. model.ts의 createSession과 같은 방식이다. */
function monitorOf(
  onDownloadProgress?: (loaded: number) => void,
): ((monitor: DownloadMonitor) => void) | undefined {
  if (!onDownloadProgress) return undefined
  return (monitor) => {
    monitor.addEventListener('downloadprogress', (event) =>
      onDownloadProgress(event.loaded),
    )
  }
}

/**
 * 쓸 수 있는지 확인한다.
 * 전역이 없어 undefined가 나오는 경우와 호출 자체가 실패하는 경우까지 전부 '못 씀'으로 본다.
 */
async function usable(check: () => Promise<Availability> | undefined): Promise<boolean> {
  try {
    const availability = await check()
    return availability !== undefined && availability !== 'unavailable'
  } catch {
    return false
  }
}

/** 이 단계를 쓸 수 없을 때의 공통 처리. fallback이 있으면 넘기고, 없으면 이유를 밝히고 던진다. */
function unavailable(
  what: string,
  fallback: Runnable | undefined,
  input: string,
): Promise<string> {
  if (fallback) return fallback.run(input)
  throw new Error(
    `${what}을(를) 사용할 수 없다. Chrome에서 해당 API가 켜져 있는지 확인하고, ` +
      `쓸 수 없는 환경도 감당하려면 fallback 옵션에 대체 Agent를 넣어라.`,
  )
}

interface Destroyable {
  destroy: () => void
}

/**
 * Task API 단계의 공통 뼈대.
 *
 * 여섯 종류가 전부 같은 순서를 밟는다: 전역 확인 → availability 확인 → 인스턴스 lazy 생성 →
 * 호출 → 실패하면 인스턴스 버리고 fallback. 여기 한 번만 쓰고 각자는 다른 부분만 준다.
 */
interface LazyTask<TInstance> extends TaskRunnable {
  /**
   * 인스턴스를 직접 다룬다. 문자열이 아닌 결과가 필요할 때 쓴다(예: proofread의 교정 목록).
   * fallback은 문자열 단계라서 여기에는 적용되지 않는다. 못 쓰는 환경이면 던진다.
   */
  use: <T>(fn: (instance: TInstance) => Promise<T>) => Promise<T>
}

function lazyTask<TApi, TInstance extends Destroyable>(config: {
  name: string
  label: string
  getApi: () => TApi | undefined
  availability: (api: TApi) => Promise<Availability>
  create: (api: TApi) => Promise<TInstance>
  invoke: (instance: TInstance, input: string) => Promise<string>
  fallback?: Runnable
}): LazyTask<TInstance> {
  let instance: Promise<TInstance> | null = null

  const resolve = async (): Promise<TInstance> => {
    const api = config.getApi()
    if (!api || !(await usable(() => config.availability(api))))
      throw new Error(`${config.label}을(를) 사용할 수 없다.`)
    instance ??= config.create(api)
    return instance
  }

  return {
    name: config.name,

    async run(input) {
      const api = config.getApi()
      if (!api) return unavailable(config.label, config.fallback, input)
      if (!(await usable(() => config.availability(api))))
        return unavailable(config.label, config.fallback, input)

      try {
        instance ??= config.create(api)
        return await config.invoke(await instance, input)
      } catch (error) {
        // 실패한 인스턴스를 남기면 이후 호출이 전부 같은 실패를 재사용한다.
        instance = null
        if (config.fallback) return config.fallback.run(input)
        throw error
      }
    },

    async use(fn) {
      try {
        return await fn(await resolve())
      } catch (error) {
        instance = null
        throw error
      }
    },

    destroy() {
      instance?.then((value) => value.destroy()).catch(() => {})
      instance = null
    },
  }
}

/** confidence가 가장 높은 언어 코드. 결과가 비었으면 null. */
function best(results: Array<DetectedLanguage>): string | null {
  let top: DetectedLanguage | undefined
  for (const result of results)
    if (!top || result.confidence > top.confidence) top = result
  return top?.detectedLanguage ?? null
}

/* ── 번역 ─────────────────────────────────────────────────────────────────── */

export interface TranslatorStepOptions extends TaskOptions {
  /** 도착어. BCP 47 태그. 예: 'ko' */
  to: string
  /**
   * 출발어. 생략하면 LanguageDetector로 입력을 보고 감지한다.
   *
   * 도착어는 감지할 수 없다(입력만 봐서는 무엇으로 바꾸길 원하는지 알 수 없다).
   * 그래서 to는 필수, from은 선택이다.
   */
  from?: string
}

/**
 * 번역 단계. 언어 조합마다 인스턴스가 따로 필요해서 다른 단계들과 모양이 조금 다르다.
 *
 * ```ts
 * const toKo = translator({ to: 'ko' })
 * await toKo.run('Hello')           // → '안녕하세요'
 * ```
 *
 * 출발어와 도착어가 같으면 입력을 그대로 돌려준다(Translator.create가 던지는 조합이다).
 */
export function translator(options: TranslatorStepOptions): TaskRunnable {
  const cache = new Map<string, Promise<TranslatorInstance>>()

  return {
    name: `translate(${options.from ?? 'auto'}→${options.to})`,

    async run(input) {
      const api = globalThis.Translator
      if (!api) return unavailable('Translator API', options.fallback, input)

      // 출발어를 먼저 정해야 한다. availability는 언어 조합마다 답이 다르므로
      // 조합이 정해지기 전에는 확인할 수 없다.
      let from = options.from
      if (!from) {
        const detected = await detectTop(input, options)
        // 감지 실패 시 원문을 조용히 흘리면 호출부가 번역이 안 된 사실을 알 수 없다.
        if (!detected) return unavailable('LanguageDetector API', options.fallback, input)
        from = detected
      }

      // 같은 언어 조합은 create()가 NotSupportedError를 던진다. 번역할 것이 없으므로 그대로 돌려준다.
      if (from === options.to) return input

      const pair = { sourceLanguage: from, targetLanguage: options.to }
      if (!(await usable(() => api.availability(pair))))
        return unavailable(
          `Translator API(${from}→${options.to})`,
          options.fallback,
          input,
        )

      const key = `${from}->${options.to}`
      try {
        let instance = cache.get(key)
        if (!instance) {
          instance = api.create({
            ...pair,
            signal: options.signal,
            monitor: monitorOf(options.onDownloadProgress),
          })
          cache.set(key, instance)
        }
        return await (await instance).translate(input, { signal: options.signal })
      } catch (error) {
        cache.delete(key)
        if (options.fallback) return options.fallback.run(input)
        throw error
      }
    },

    destroy() {
      for (const pending of cache.values())
        pending.then((instance) => instance.destroy()).catch(() => {})
      cache.clear()
    },
  }
}

/** 입력의 언어를 감지해 가장 확신도가 높은 코드를 돌려준다. 못 하면 null. */
async function detectTop(input: string, options: TaskOptions): Promise<string | null> {
  const api = globalThis.LanguageDetector
  if (!api) return null
  if (!(await usable(() => api.availability()))) return null
  try {
    const detector = await api.create({
      signal: options.signal,
      monitor: monitorOf(options.onDownloadProgress),
    })
    try {
      return best(await detector.detect(input, { signal: options.signal }))
    } finally {
      detector.destroy()
    }
  } catch {
    return null
  }
}

/* ── 언어 감지 ────────────────────────────────────────────────────────────── */

/**
 * 언어 감지 단계. 언어 코드 문자열('en', 'ko' …)을 돌려준다.
 *
 * router의 분류기 대신 쓰면 모델을 한 번 덜 부른다.
 *
 * ```ts
 * await languageDetector().run('Bonjour')   // → 'fr'
 * ```
 */
export function languageDetector(
  options: TaskOptions & { expectedInputLanguages?: Array<string> } = {},
): TaskRunnable {
  const { fallback, onDownloadProgress, signal, ...create } = options

  const task = lazyTask<
    NonNullable<typeof globalThis.LanguageDetector>,
    LanguageDetectorInstance
  >({
    name: 'detectLanguage',
    label: 'LanguageDetector API',
    fallback,
    getApi: () => globalThis.LanguageDetector,
    availability: (api) => api.availability(create),
    create: (api) =>
      api.create({ ...create, signal, monitor: monitorOf(onDownloadProgress) }),
    invoke: async (instance, input) => {
      const top = best(await instance.detect(input, { signal }))
      // 결과가 비는 경우가 실제로 있다(너무 짧은 입력 등). 빈 문자열을 흘리면
      // 뒤에 오는 router가 조용히 오분류되므로 에러로 끊어 fallback을 태운다.
      if (!top) throw new Error('언어를 감지하지 못했다.')
      return top
    },
  })

  return task
}

/* ── 요약 ─────────────────────────────────────────────────────────────────── */

export interface SummarizerStepOptions
  extends TaskOptions, Omit<SummarizerOptions, 'signal' | 'monitor'> {}

/**
 * 요약 단계.
 *
 * ```ts
 * const brief = summarizer({ type: 'tldr', length: 'short' })
 * await brief.run(longText)
 * ```
 *
 * 컨텍스트 창이 찼을 때 지난 대화를 접는 용도로도 쓴다. 요약에 모델 창을 쓰지 않으므로
 * "창을 아끼려고 창을 쓰는" 문제가 생기지 않는다.
 */
export function summarizer(options: SummarizerStepOptions = {}): TaskRunnable {
  const { fallback, onDownloadProgress, signal, ...create } = options

  return lazyTask<NonNullable<typeof globalThis.Summarizer>, SummarizerInstance>({
    name: 'summarize',
    label: 'Summarizer API',
    fallback,
    getApi: () => globalThis.Summarizer,
    availability: (api) => api.availability(create),
    create: (api) =>
      api.create({ ...create, signal, monitor: monitorOf(onDownloadProgress) }),
    invoke: (instance, input) => instance.summarize(input, { signal }),
  })
}

/* ── 작성 ─────────────────────────────────────────────────────────────────── */

export interface WriterStepOptions
  extends TaskOptions, Omit<WriterOptions, 'signal' | 'monitor'> {
  /** 매 호출에 함께 넘길 배경 설명 */
  context?: string
}

/**
 * 작성 단계. 입력을 "무엇을 써 달라"는 지시로 보고 새 글을 만든다.
 *
 * ```ts
 * await writer({ tone: 'formal', length: 'short' }).run('환불 요청 메일')
 * ```
 *
 * Chrome 137~148 오리진 트라이얼이라 안정 버전에는 아직 없다. fallback을 같이 주는 것을 권한다.
 */
export function writer(options: WriterStepOptions = {}): TaskRunnable {
  const { fallback, onDownloadProgress, signal, context, ...create } = options

  return lazyTask<NonNullable<typeof globalThis.Writer>, WriterInstance>({
    name: 'write',
    label: 'Writer API',
    fallback,
    getApi: () => globalThis.Writer,
    availability: (api) => api.availability(create),
    create: (api) =>
      api.create({ ...create, signal, monitor: monitorOf(onDownloadProgress) }),
    invoke: (instance, input) => instance.write(input, { context, signal }),
  })
}

/* ── 재작성 ───────────────────────────────────────────────────────────────── */

export interface RewriterStepOptions
  extends TaskOptions, Omit<RewriterOptions, 'signal' | 'monitor'> {
  /** 매 호출에 함께 넘길 배경 설명 */
  context?: string
}

/**
 * 재작성 단계. 기존 글의 어조를 바꾸거나 길이를 늘리고 줄인다.
 *
 * ```ts
 * chain(draft, rewriter({ tone: 'more-casual', length: 'shorter' }))
 * ```
 *
 * Chrome 137~148 오리진 트라이얼이라 안정 버전에는 아직 없다.
 */
export function rewriter(options: RewriterStepOptions = {}): TaskRunnable {
  const { fallback, onDownloadProgress, signal, context, ...create } = options

  return lazyTask<NonNullable<typeof globalThis.Rewriter>, RewriterInstance>({
    name: 'rewrite',
    label: 'Rewriter API',
    fallback,
    getApi: () => globalThis.Rewriter,
    availability: (api) => api.availability(create),
    create: (api) =>
      api.create({ ...create, signal, monitor: monitorOf(onDownloadProgress) }),
    invoke: (instance, input) => instance.rewrite(input, { context, signal }),
  })
}

/* ── 교정 ─────────────────────────────────────────────────────────────────── */

export interface ProofreaderStepOptions
  extends TaskOptions, Omit<ProofreaderOptions, 'signal' | 'monitor'> {}

export interface ProofreaderRunnable extends TaskRunnable {
  /**
   * 고친 전문뿐 아니라 어디를 왜 고쳤는지까지 받는다.
   *
   * run()은 Runnable 규약상 문자열만 돌려주므로 교정 목록이 사라진다.
   * 편집기에서 밑줄을 그으려면 이쪽을 써라. fallback은 적용되지 않는다.
   */
  proofread: (input: string) => Promise<ProofreadResult>
}

/**
 * 교정 단계. 문법과 가독성을 고친다. run()은 고쳐진 글만 돌려준다.
 *
 * ```ts
 * const fix = proofreader({ expectedInputLanguages: ['en'] })
 * await fix.run('I seen him yesterday')          // → 'I saw him yesterday'
 * const detail = await fix.proofread('...')      // 어디를 고쳤는지까지
 * ```
 *
 * Chrome 141~145 오리진 트라이얼이었고 안정 버전에는 아직 없다.
 */
export function proofreader(options: ProofreaderStepOptions = {}): ProofreaderRunnable {
  const { fallback, onDownloadProgress, signal, ...create } = options

  const task = lazyTask<NonNullable<typeof globalThis.Proofreader>, ProofreaderInstance>({
    name: 'proofread',
    label: 'Proofreader API',
    fallback,
    getApi: () => globalThis.Proofreader,
    availability: (api) => api.availability(create),
    create: (api) =>
      api.create({ ...create, signal, monitor: monitorOf(onDownloadProgress) }),
    invoke: async (instance, input) =>
      (await instance.proofread(input, { signal })).correctedInput,
  })

  return {
    ...task,
    proofread: (input) => task.use((instance) => instance.proofread(input, { signal })),
  }
}
