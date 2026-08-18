import { describe, expect, it } from 'vitest'
import { parseJson, stringifyResult, truncate } from '../src/tool'

/**
 * 파서는 모델 출력을 받는 유일한 지점이다.
 * 온디바이스 모델이 무엇을 뱉을지 통제할 수 없으므로, 여기만은 실제로 겪는
 * 이상 출력들을 모아 두고 견디는지 확인한다.
 */
describe('parseJson', () => {
  it('평범한 JSON을 파싱한다', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it.each([
    ['코드펜스 + 언어', '```json\n{"a":1}\n```'],
    ['코드펜스만', '```\n{"a":1}\n```'],
    ['앞뒤 공백', '   \n {"a":1} \n  '],
    ['앞에 잡소리', '네, 결과입니다:\n{"a":1}'],
    ['뒤에 잡소리', '{"a":1}\n도움이 되셨길 바랍니다.'],
    ['앞뒤 모두 잡소리', '자, 보시죠 {"a":1} 이상입니다'],
    ['대문자 펜스', '```JSON\n{"a":1}\n```'],
  ])('%s 형태를 견딘다', (_label, raw) => {
    expect(parseJson(raw)).toEqual({ a: 1 })
  })

  it('문자열 안에 중괄호가 있어도 깨지지 않는다', () => {
    expect(parseJson('{"a":"}{"}')).toEqual({ a: '}{' })
  })

  it('객체가 아닌 JSON도 그대로 돌려준다', () => {
    expect(parseJson('[1,2]')).toEqual([1, 2])
    expect(parseJson('"문자열"')).toBe('문자열')
  })

  it.each([
    ['빈 문자열', ''],
    ['공백만', '   '],
    ['잘린 JSON', '{"a":1'],
    ['JSON이 아닌 산문', '죄송하지만 답변할 수 없습니다.'],
    ['닫는 괄호만', '}'],
  ])('%s 는 우리 에러 메시지로 실패한다', (_label, raw) => {
    // SyntaxError가 그대로 새어 나가면 호출부가 원인을 알 수 없다.
    expect(() => parseJson(raw)).toThrow(/모델 출력을 JSON으로 파싱하지 못했다/)
  })

  it('임의의 쓰레기 입력에도 예측 가능하게 동작한다', () => {
    // 시드 고정 PRNG. 실패하면 항상 같은 입력으로 재현된다.
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const pool = '{}[]",:\\ \nabc123`가나다'

    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rand() * 40)
      let input = ''
      for (let j = 0; j < len; j++) {
        input += pool[Math.floor(rand() * pool.length)]
      }

      try {
        parseJson(input)
      } catch (error) {
        // 던지더라도 반드시 우리 Error여야 한다. 원시 SyntaxError는 실패로 본다.
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/모델 출력을 JSON으로 파싱하지 못했다/)
      }
    }
  })
})

describe('truncate', () => {
  it('한도 이하는 건드리지 않는다', () => {
    expect(truncate('abc', 10)).toBe('abc')
    expect(truncate('abc', 3)).toBe('abc')
  })

  it('넘치면 자르고 잘린 사실을 남긴다', () => {
    const out = truncate('x'.repeat(100), 10)
    expect(out.startsWith('x'.repeat(10))).toBe(true)
    expect(out).toContain('90자 잘림')
  })

  it('Infinity를 주면 자르지 않는다', () => {
    const long = 'x'.repeat(10_000)
    expect(truncate(long, Infinity)).toBe(long)
  })

  it('0을 주면 전부 잘린다', () => {
    expect(truncate('abcd', 0)).toContain('4자 잘림')
  })
})

describe('stringifyResult', () => {
  it('문자열은 그대로 둔다', () => {
    expect(stringifyResult('그대로')).toBe('그대로')
  })

  it('객체는 JSON으로 만든다', () => {
    expect(stringifyResult({ a: 1 })).toBe('{"a":1}')
  })

  it('undefined는 빈 값임을 알린다', () => {
    expect(stringifyResult(undefined)).toBe('(반환값 없음)')
  })

  it('순환 참조가 있어도 던지지 않는다', () => {
    // 도구가 DOM 노드나 순환 구조를 돌려주는 일은 실제로 흔하다.
    const circular: Record<string, unknown> = { name: 'node' }
    circular.self = circular
    expect(() => stringifyResult(circular)).not.toThrow()
  })
})
