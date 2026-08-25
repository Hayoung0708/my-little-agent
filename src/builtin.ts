import { tool } from './tool'
import type { AgentTool } from './tool'

/**
 * 미리 만들어 둔 도구들.
 *
 * 아무거나 넣지 않는다. 세 가지를 모두 만족할 때만 들어온다.
 *
 * 1. **브라우저 안에서 완결된다** — 서버도 API 키도 필요 없다. 하나라도 필요해지면
 *    "백엔드 없음 · 키 없음 · 공짜 · 기기 밖으로 안 나감"이 한꺼번에 무너진다.
 *    웹 검색이 여기서 걸러진다. 브라우저에 검색 기능이 없어 제3자 API를 써야 하고,
 *    그 순간 이 라이브러리의 전제가 전부 깨진다.
 * 2. **모델이 못 하는 일이다** — 모델이 이미 잘하는 일을 도구로 만들면 왕복만 낭비한다.
 * 3. **결과가 검증 가능하다** — 틀렸는지 알 수 있어야 한다.
 */

/* ── 계산기 ───────────────────────────────────────────────────────────────── */

type Token = { type: 'num'; value: number } | { type: 'op'; value: string }

/**
 * 수식을 토큰으로 쪼갠다.
 *
 * 여기서 허용하지 않은 문자는 전부 에러다. `eval`이나 `new Function`을 쓰지 않는 이유:
 * 모델 출력에는 사용자 입력이 섞여 들어오므로 그대로 실행하면 임의 코드 실행 구멍이 된다.
 * 게다가 CSP를 켠 사이트에서는 `eval`이 아예 막혀 라이브러리가 통째로 깨진다.
 */
function tokenize(input: string): Array<Token> {
  // 모델은 큰 수에 자릿수 쉼표를 자주 붙인다. 숫자 사이의 쉼표만 지운다.
  const text = input.replace(/(\d),(?=\d)/g, '$1').trim()
  const pattern = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([+\-*/%()]))/y
  const tokens: Array<Token> = []
  let position = 0

  while (position < text.length) {
    pattern.lastIndex = position
    const match = pattern.exec(text)
    if (!match)
      throw new Error(
        `계산할 수 없는 문자가 있다: "${text.slice(position, position + 12)}"`,
      )
    position = pattern.lastIndex
    if (match[1] !== undefined) tokens.push({ type: 'num', value: Number(match[1]) })
    else tokens.push({ type: 'op', value: match[2]! })
  }
  if (!tokens.length) throw new Error('계산할 수식이 비어 있다.')
  return tokens
}

/**
 * 재귀 하강 파서. 문법은 이게 전부다.
 *
 * ```
 * expr   := term (('+' | '-') term)*
 * term   := factor (('*' | '/' | '%') factor)*
 * factor := ('-' | '+') factor | '(' expr ')' | number
 * ```
 */
export function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression)
  let index = 0

  const eat = (value: string): boolean => {
    const token = tokens[index]
    if (token?.type === 'op' && token.value === value) {
      index++
      return true
    }
    return false
  }

  const parseFactor = (): number => {
    if (eat('-')) return -parseFactor()
    if (eat('+')) return parseFactor()
    if (eat('(')) {
      const value = parseExpr()
      if (!eat(')')) throw new Error('괄호가 닫히지 않았다.')
      return value
    }
    const token = tokens[index]
    if (token?.type === 'num') {
      index++
      return token.value
    }
    throw new Error('수식이 올바르지 않다.')
  }

  const parseTerm = (): number => {
    let left = parseFactor()
    for (;;) {
      if (eat('*')) left *= parseFactor()
      else if (eat('/')) {
        const right = parseFactor()
        if (right === 0) throw new Error('0으로 나눌 수 없다.')
        left /= right
      } else if (eat('%')) {
        const right = parseFactor()
        if (right === 0) throw new Error('0으로 나눌 수 없다.')
        left %= right
      } else return left
    }
  }

  function parseExpr(): number {
    let left = parseTerm()
    for (;;) {
      if (eat('+')) left += parseTerm()
      else if (eat('-')) left -= parseTerm()
      else return left
    }
  }

  const result = parseExpr()
  if (index < tokens.length) throw new Error('수식 뒤에 해석할 수 없는 부분이 남았다.')
  if (!Number.isFinite(result)) throw new Error('계산 결과가 유한한 수가 아니다.')
  return result
}

/**
 * 부동소수점 잡음을 걷어낸다. `0.1 + 0.2`가 `0.30000000000000004`로 나오면
 * 모델이 그 꼬리까지 답에 옮겨 적는다.
 */
function format(value: number): string {
  return String(Number(value.toPrecision(12)))
}

/**
 * 계산기 도구. 소형 모델이 확실히 못하는 일이라 도구로 메울 값어치가 있다.
 *
 * ```ts
 * new Agent({ instruction: '...', tools: [calculator()] })
 * ```
 *
 * `%`는 백분율이 아니라 **나머지**다. 설명에 명시해 두어 모델이 헷갈리지 않게 한다.
 * 도구 호출은 왕복 한 번이므로 `2+2` 같은 것에는 오히려 손해다. 설명을 좁게 써서
 * 모델이 남용하지 않도록 유도한다.
 */
export function calculator(): AgentTool<{ expression: string }> {
  return tool<{ expression: string }>({
    name: 'calculator',
    description:
      '여러 자리 수의 정확한 사칙연산이 필요할 때 쓴다. ' +
      '+ - * / 와 나머지(%), 괄호, 소수만 지원한다. ' +
      '백분율은 15%가 아니라 0.15처럼 소수로 써라. 변수나 함수는 쓸 수 없다.',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '예: (1200 + 340) * 0.15' },
      },
      required: ['expression'],
    },
    execute: ({ expression }) => format(evaluateExpression(expression)),
  })
}

/* ── 페이지 읽기 ──────────────────────────────────────────────────────────── */

export interface PageToolsOptions {
  /**
   * 읽을 범위. 기본은 `document.body`.
   *
   * 페이지 전체를 읽으면 내비게이션과 푸터까지 딸려와 좁은 창을 낭비한다.
   * 본문 컨테이너를 지정하는 편이 거의 항상 낫다. 예: `() => document.querySelector('main')`
   */
  root?: () => Element | null
  /** 한 번에 돌려줄 최대 글자 수. 기본 2000자. */
  maxChars?: number
  /**
   * 주소에 쿼리 문자열을 포함할지. 기본 false.
   *
   * 쿼리에 세션 토큰이나 개인정보가 실리는 경우가 흔해서 기본으로는 뺀다.
   * 모델이 로컬에서 돌더라도 대화 기록은 저장될 수 있다.
   */
  includeQuery?: boolean
}

/** 페이지 텍스트. innerText는 화면에 실제로 보이는 것만 준다(숨긴 요소·입력값 제외). */
function textOf(element: Element | null, limit: number): string {
  const text = (element as HTMLElement | null)?.innerText?.trim() ?? ''
  if (!text) return '(읽을 수 있는 텍스트가 없다)'
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n…(${text.length - limit}자 잘림)`
}

/**
 * 지금 열려 있는 페이지를 읽는 도구들.
 *
 * **서버 LLM이 구조적으로 못 하는 일이다.** 사용자 화면 안에 있는 것은 브라우저 안에서
 * 도는 모델만 볼 수 있다. 웹 검색이 "밖에서 정보를 가져오는" 것이라면 이쪽은
 * "이미 눈앞에 있는 것을 읽는" 것이고, 키도 서버도 필요 없다.
 *
 * ```ts
 * new Agent({
 *   instruction: '이 페이지에 대해 답하는 도우미. 모르면 도구로 읽어라.',
 *   tools: pageTools({ root: () => document.querySelector('article') }),
 * })
 * ```
 *
 * 두 도구 모두 **인자가 없다.** 인자를 받으면 모델이 JSON 문자열을 만들어야 하고
 * 거기서 실패율이 오른다. 인자 없는 도구는 이름만 고르면 되므로 가장 안정적이다.
 */
export function pageTools(options: PageToolsOptions = {}): Array<AgentTool> {
  const limit = options.maxChars ?? 2000
  const root = () => options.root?.() ?? globalThis.document?.body ?? null

  return [
    tool({
      name: 'pageInfo',
      description:
        '지금 보고 있는 페이지의 제목, 주소, 사용자가 선택한 텍스트를 확인한다',
      execute: () => {
        const doc = globalThis.document
        if (!doc) return '브라우저가 아니라 페이지를 읽을 수 없다'
        const location = globalThis.location
        const url = location
          ? options.includeQuery
            ? location.href
            : location.origin + location.pathname
          : '(주소 없음)'
        const selected = globalThis.getSelection?.()?.toString().trim()
        return [
          `제목: ${doc.title || '(없음)'}`,
          `주소: ${url}`,
          selected
            ? `선택한 텍스트: ${truncateTo(selected, limit)}`
            : '선택한 텍스트: (없음)',
        ].join('\n')
      },
    }),

    tool({
      name: 'readPage',
      description: '지금 보고 있는 페이지의 본문 텍스트를 읽는다',
      execute: () => {
        if (!globalThis.document) return '브라우저가 아니라 페이지를 읽을 수 없다'
        return textOf(root(), limit)
      },
    }),
  ]
}

function truncateTo(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}
