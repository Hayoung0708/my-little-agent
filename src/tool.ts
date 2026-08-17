import type { JSONSchema } from './types'

/** 에이전트가 호출할 수 있는 도구 하나 */
export interface AgentTool<TArgs = any> {
  /** 모델이 지목할 이름. 공백 없는 짧은 식별자를 써라. */
  name: string
  /** 언제 쓰는 도구인지. 모델이 이 문장만 보고 고르므로 구체적으로 써라. */
  description: string
  /** 인자 JSON Schema. 없으면 인자 없는 도구로 취급한다. */
  parameters?: JSONSchema
  /** 실제 실행. 반환값은 문자열로 직렬화되어 모델에게 돌아간다. */
  execute: (args: TArgs) => unknown | Promise<unknown>
}

/** 타입 추론용 헬퍼. `tool<{ city: string }>({...})` 처럼 쓴다. */
export function tool<TArgs = any>(definition: AgentTool<TArgs>): AgentTool<TArgs> {
  return definition
}

/** 최종 답변을 의미하는 예약어. 실제 도구 이름과 겹치면 안 된다. */
export const FINAL = 'final'

/**
 * 툴 루프 한 스텝의 출력 스키마.
 * argsJson을 object가 아닌 문자열로 받는 이유: 온디바이스 모델의 제약 디코딩이
 * 자유 형태 object보다 문자열을 훨씬 안정적으로 뱉기 때문이다.
 */
export function stepSchema(toolNames: Array<string>): JSONSchema {
  return {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: [...toolNames, FINAL] },
      argsJson: { type: 'string' },
      answer: { type: 'string' },
    },
    required: ['tool', 'argsJson', 'answer'],
    additionalProperties: false,
  }
}

/** 도구 목록을 시스템 프롬프트에 붙일 설명서로 만든다. */
export function toolManual(tools: Array<AgentTool>): string {
  const list = tools
    .map((t) => {
      const schema = t.parameters ? JSON.stringify(t.parameters) : '{}'
      return `- ${t.name}: ${t.description}\n  인자 스키마: ${schema}`
    })
    .join('\n')

  return [
    '',
    '사용 가능한 도구:',
    list,
    '',
    '도구 사용 규칙:',
    `1. 도구가 필요하면 tool에 도구 이름, argsJson에 인자를 담은 JSON 문자열, answer는 빈 문자열로 응답해라.`,
    `2. 도구가 필요 없거나 답할 정보가 충분하면 tool을 "${FINAL}"로, argsJson을 "{}"로 두고 answer에 최종 답변을 써라.`,
    '3. 한 번에 도구 하나만 호출해라.',
  ].join('\n')
}

/** 모델이 코드펜스를 섞어 뱉는 경우까지 감안한 JSON 파서 */
export function parseJson<T>(raw: string): T {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    return JSON.parse(text) as T
  } catch {
    // 앞뒤에 잡소리가 붙은 경우 가장 바깥 중괄호만 잘라 한 번 더 시도
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as T
    }
    throw new Error(`모델 출력을 JSON으로 파싱하지 못했다: ${raw.slice(0, 200)}`)
  }
}

/** 잘린 사실을 모델이 알 수 있도록 표시를 남기고 자른다. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…(결과가 길어 ${text.length - limit}자 잘림)`
}

/** 도구 실행 결과를 모델에게 돌려줄 문자열로 만든다. */
export function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return '(반환값 없음)'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
