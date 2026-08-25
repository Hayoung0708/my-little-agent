import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Agent, chain, parallel, refine, router, step } from '../src/index'
import type { LanguageModelSession } from '../src/types'

/**
 * stateless를 켜지 않은 Agent를 워크플로에 넣으면 경고가 나와야 한다.
 *
 * 이 실수는 에러도 안 나고 첫 실행도 멀쩡해서, 경고가 없으면 사실상 못 찾는다.
 * 그래서 "경고가 나온다"는 것 자체가 검증 대상이다.
 */

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  globalThis.LanguageModel = {
    async availability() {
      return 'available'
    },
    async create(): Promise<LanguageModelSession> {
      return {
        async prompt() {
          return '{}'
        },
        // eslint-disable-next-line require-yield
        async *promptStreaming() {
          return
        },
        async append() {},
        async clone() {
          return this
        },
        destroy() {},
        contextUsage: 0,
        contextWindow: 4096,
        addEventListener() {},
      } as unknown as LanguageModelSession
    },
  }
})

afterEach(() => {
  warn.mockRestore()
  globalThis.LanguageModel = undefined
})

/** 경고 메시지 전부를 하나로 이어붙인다. */
const warnings = () => warn.mock.calls.map((call) => String(call[0])).join('\n')

describe('stateless 경고', () => {
  it('stateless를 지정하지 않은 Agent를 chain에 넣으면 경고한다', () => {
    chain(new Agent({ name: '작가' }), new Agent({ name: '편집자' }))

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warnings()).toContain('작가')
    expect(warnings()).toContain('편집자')
    expect(warnings()).toContain('chain')
  })

  it('stateless: true면 경고하지 않는다', () => {
    chain(new Agent({ name: '작가', stateless: true }))
    expect(warn).not.toHaveBeenCalled()
  })

  it('stateless: false를 명시하면 의도한 것으로 보고 경고하지 않는다', () => {
    // 대화를 이어가는 챗봇을 일부러 단계로 쓰는 경우다. 끄는 방법이 있어야 한다.
    chain(new Agent({ name: '상담원', stateless: false }))
    expect(warn).not.toHaveBeenCalled()
  })

  it('Agent가 아닌 단계는 검사하지 않는다', () => {
    chain(
      step((input) => input.toUpperCase()),
      { name: '내가 만든 것', run: async (input) => input },
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('parallel도 검사한다', () => {
    parallel([new Agent({ name: '장점' }), new Agent({ name: '단점', stateless: true })])

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warnings()).toContain('장점')
    expect(warnings()).toContain('parallel')
  })

  it('router는 분류기와 경로를 모두 검사한다', () => {
    router({
      classifier: new Agent({ name: '분류기' }),
      routes: { 환불: new Agent({ name: '환불담당' }) },
    })

    expect(warnings()).toContain('분류기')
    expect(warnings()).toContain('환불담당')
    expect(warnings()).toContain('router')
  })

  it('refine은 worker와 evaluator를 모두 검사한다', () => {
    refine({
      worker: new Agent({ name: '작가' }),
      evaluator: new Agent({ name: '심사' }),
    })

    expect(warn).toHaveBeenCalledTimes(2)
    expect(warnings()).toContain('refine')
  })

  it('조합기를 만들 때 한 번만 검사한다 — 실행마다 반복하지 않는다', async () => {
    const flow = chain(new Agent({ name: '작가' }))
    expect(warn).toHaveBeenCalledTimes(1)

    await flow.run('한 번')
    await flow.run('두 번')
    // 실행할 때마다 콘솔을 도배하면 아무도 안 읽는다.
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
