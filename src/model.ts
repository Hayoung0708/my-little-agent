import type {
  Availability,
  CreateOptions,
  ExpectedIO,
  LanguageModelSession,
  LanguageModelStatic,
  ModelParams,
} from './types'

/** Prompt API를 못 쓰는 환경에서 던지는 에러. instanceof로 폴백 분기할 때 쓴다. */
export class UnavailableError extends Error {
  constructor(
    message = 'Prompt API를 사용할 수 없다. Chrome 138+ 데스크톱에서 실행하고 chrome://on-device-internals 에서 모델 상태를 확인해라.',
  ) {
    super(message)
    this.name = 'UnavailableError'
  }
}

/** 전역 LanguageModel을 꺼낸다. 없으면 null. */
function getLanguageModel(): LanguageModelStatic | null {
  return globalThis.LanguageModel ?? null
}

/** Prompt API 전역 존재 여부. 다운로드 여부까지는 보지 않는다. */
export function isSupported(): boolean {
  return getLanguageModel() !== null
}

/**
 * 모델 사용 가능 상태 조회.
 * 전역 자체가 없으면 'unavailable'을 돌려주므로 호출부에서 try/catch가 필요 없다.
 */
export async function availability(options?: {
  expectedInputs?: Array<ExpectedIO>
  expectedOutputs?: Array<ExpectedIO>
}): Promise<Availability> {
  const model = getLanguageModel()
  if (!model) return 'unavailable'
  return model.availability(options)
}

/** 모델 기본 파라미터(topK/temperature 범위). 미지원이면 null. */
export async function modelParams(): Promise<ModelParams | null> {
  const model = getLanguageModel()
  if (!model?.params) return null
  return model.params()
}

export interface SessionOptions extends Omit<CreateOptions, 'monitor'> {
  /** 모델 다운로드 진행률 콜백. 0~1 사이 값이 들어온다. */
  onDownloadProgress?: (loaded: number) => void
}

/**
 * 세션 생성. monitor 콜백 배선을 대신 해준다.
 * 'downloadable' 상태면 이 호출에서 모델 다운로드가 시작되고, 끝날 때까지 resolve되지 않는다.
 */
export async function createSession(
  options: SessionOptions = {},
): Promise<LanguageModelSession> {
  const model = getLanguageModel()
  if (!model) throw new UnavailableError()

  const { onDownloadProgress, ...rest } = options
  return model.create({
    ...rest,
    monitor: onDownloadProgress
      ? (monitor) => {
          monitor.addEventListener('downloadprogress', (event) => {
            onDownloadProgress(event.loaded)
          })
        }
      : undefined,
  })
}
