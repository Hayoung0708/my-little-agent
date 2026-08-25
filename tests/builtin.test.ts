import { afterEach, describe, expect, it } from 'vitest'
import { calculator, evaluateExpression, pageTools } from '../src/index'

/** 도구 실행 헬퍼. execute의 반환은 문자열이거나 Promise다. */
const run = async (t: { execute: (args: never) => unknown }, args?: unknown) =>
  String(await t.execute(args as never))

describe('evaluateExpression', () => {
  it('사칙연산과 우선순위', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14)
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20)
    expect(evaluateExpression('10 / 4')).toBe(2.5)
    expect(evaluateExpression('10 % 3')).toBe(1)
  })

  it('단항 부호와 중첩 괄호', () => {
    expect(evaluateExpression('-5 + 3')).toBe(-2)
    expect(evaluateExpression('-(2 + 3)')).toBe(-5)
    expect(evaluateExpression('--4')).toBe(4)
    expect(evaluateExpression('((1 + 2) * (3 + 4))')).toBe(21)
  })

  it('소수와 지수 표기', () => {
    expect(evaluateExpression('0.1 + 0.2')).toBeCloseTo(0.3, 10)
    expect(evaluateExpression('1e3 + 1')).toBe(1001)
  })

  it('모델이 붙이는 자릿수 쉼표를 받아준다', () => {
    // 소형 모델은 큰 수에 쉼표를 자주 붙인다. 여기서 막히면 도구가 쓸모없어진다.
    expect(evaluateExpression('1,200 + 340')).toBe(1540)
  })

  describe('안전 — eval을 쓰지 않으므로 코드가 실행되지 않는다', () => {
    // 모델 출력에는 사용자 입력이 섞여 들어온다. 이것들이 통과하면 임의 코드 실행이다.
    const attacks = [
      'globalThis',
      'process.exit(1)',
      'fetch("/steal")',
      '(()=>1)()',
      'constructor.constructor("return 1")()',
      '1;alert(1)',
      '__proto__',
      'a + 1',
    ]

    for (const attack of attacks) {
      it(`거부: ${attack}`, () => {
        expect(() => evaluateExpression(attack)).toThrow()
      })
    }
  })

  it('잘못된 수식은 이유를 밝히고 던진다', () => {
    expect(() => evaluateExpression('(1 + 2')).toThrow('괄호가 닫히지 않았다')
    expect(() => evaluateExpression('1 +')).toThrow('수식이 올바르지 않다')
    expect(() => evaluateExpression('1 2')).toThrow('해석할 수 없는 부분')
    expect(() => evaluateExpression('')).toThrow('비어 있다')
    expect(() => evaluateExpression('1 / 0')).toThrow('0으로 나눌 수 없다')
  })
})

describe('calculator 도구', () => {
  it('부동소수점 꼬리를 걷어낸 문자열을 돌려준다', async () => {
    // 0.30000000000000004를 그대로 주면 모델이 그 꼬리까지 답에 옮겨 적는다.
    expect(await run(calculator(), { expression: '0.1 + 0.2' })).toBe('0.3')
    expect(await run(calculator(), { expression: '(1200 + 340) * 0.15' })).toBe('231')
  })

  it('실패는 던져서 툴 루프가 모델에게 이유를 돌려주게 한다', async () => {
    await expect(run(calculator(), { expression: 'rm -rf /' })).rejects.toThrow()
  })
})

describe('pageTools', () => {
  const originalDocument = globalThis.document
  const originalLocation = globalThis.location

  function installPage(options: {
    title?: string
    body?: string
    href?: string
    selection?: string
  }) {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        title: options.title ?? '',
        body: { innerText: options.body ?? '' },
        querySelector: () => null,
      },
    })
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: {
        href: options.href ?? 'https://shop.example/items?token=secret123',
        origin: 'https://shop.example',
        pathname: '/items',
      },
    })
    Object.defineProperty(globalThis, 'getSelection', {
      configurable: true,
      value: () => ({ toString: () => options.selection ?? '' }),
    })
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('두 도구 모두 인자가 없다 — 모델이 JSON을 만들 필요가 없어 실패율이 낮다', () => {
    const tools = pageTools()
    expect(tools.map((t) => t.name)).toEqual(['pageInfo', 'readPage'])
    expect(tools.every((t) => t.parameters === undefined)).toBe(true)
  })

  it('pageInfo는 기본적으로 쿼리 문자열을 뺀다', async () => {
    installPage({ title: '상품 목록' })
    const [pageInfo] = pageTools()

    const out = await run(pageInfo!)
    expect(out).toContain('상품 목록')
    expect(out).toContain('https://shop.example/items')
    // 쿼리에 토큰이 실리는 경우가 흔하다. 대화 기록에 남으면 곤란하다.
    expect(out).not.toContain('secret123')
  })

  it('includeQuery: true면 전체 주소를 준다', async () => {
    installPage({ title: 't' })
    const [pageInfo] = pageTools({ includeQuery: true })
    expect(await run(pageInfo!)).toContain('secret123')
  })

  it('선택한 텍스트를 알려준다', async () => {
    installPage({ title: 't', selection: '이 문장을 번역해줘' })
    const [pageInfo] = pageTools()
    expect(await run(pageInfo!)).toContain('이 문장을 번역해줘')
  })

  it('readPage는 본문을 읽고 길면 자른다', async () => {
    installPage({ body: 'A'.repeat(50) })
    const [, readPage] = pageTools({ maxChars: 20 })

    const out = await run(readPage!)
    expect(out).toContain('30자 잘림')
    expect(out.startsWith('A'.repeat(20))).toBe(true)
  })

  it('root로 범위를 좁힐 수 있다', async () => {
    installPage({ body: '네비게이션 푸터까지 전부' })
    const [, readPage] = pageTools({
      root: () => ({ innerText: '본문만' }) as unknown as Element,
    })
    expect(await run(readPage!)).toBe('본문만')
  })

  it('브라우저가 아니면 조용히 빈 값을 주지 않고 이유를 말한다', async () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: undefined,
    })
    const [pageInfo, readPage] = pageTools()

    expect(await run(pageInfo!)).toContain('브라우저가 아니라')
    expect(await run(readPage!)).toContain('브라우저가 아니라')
  })
})
