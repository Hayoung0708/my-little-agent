import { describe, expectTypeOf, it } from 'vitest'
import {
  Agent,
  chain,
  localMemory,
  memoryTools,
  parallel,
  refine,
  router,
  step,
  tool,
} from '../src/index'
import type { AgentTool, MemoryStore, PromptMessage, Runnable } from '../src/index'

/**
 * 런타임은 멀쩡한데 타입만 깨지는 회귀는 일반 테스트가 잡지 못한다.
 * 소비자가 실제로 기대는 추론만 골라서 고정한다.
 */
describe('tool', () => {
  it('제네릭 인자 타입이 execute까지 흐른다', () => {
    tool<{ city: string; days: number }>({
      name: 'weather',
      description: '기온 조회',
      execute: (args) => {
        expectTypeOf(args).toEqualTypeOf<{ city: string; days: number }>()
        return args.city
      },
    })
  })

  it('정의를 그대로 AgentTool로 돌려준다', () => {
    const t = tool<{ id: string }>({
      name: 'x',
      description: 'x',
      execute: () => null,
    })
    expectTypeOf(t).toEqualTypeOf<AgentTool<{ id: string }>>()
  })
})

describe('Agent', () => {
  const agent = new Agent({ instruction: 'x' })

  it('send는 문자열을 준다', () => {
    expectTypeOf(agent.send('hi')).toEqualTypeOf<Promise<string>>()
  })

  it('stream은 문자열 조각을 흘린다', () => {
    expectTypeOf(agent.stream('hi')).toEqualTypeOf<AsyncGenerator<string, void, void>>()
  })

  it('generate는 지정한 타입 그대로 준다', () => {
    const out = agent.generate<{ score: number; reason: string }>('hi', {})
    expectTypeOf(out).toEqualTypeOf<Promise<{ score: number; reason: string }>>()
  })

  it('history는 저장 가능한 메시지 배열이다', () => {
    expectTypeOf(agent.history).toEqualTypeOf<Array<PromptMessage>>()
  })

  it('usage는 세션이 없을 수 있으므로 null이 섞인다', () => {
    expectTypeOf(agent.usage).toEqualTypeOf<{ used: number; total: number } | null>()
  })

  it('Runnable을 만족해서 워크플로에 그대로 꽂힌다', () => {
    expectTypeOf(agent).toMatchTypeOf<Runnable>()
  })

  it('fork는 같은 타입의 에이전트를 준다', () => {
    expectTypeOf(agent.fork()).toEqualTypeOf<Promise<Agent>>()
  })
})

describe('워크플로', () => {
  const a = new Agent()
  const b = step((s) => s.trim())

  it('모든 조합기가 Runnable을 돌려준다', () => {
    expectTypeOf(chain(a, b)).toEqualTypeOf<Runnable>()
    expectTypeOf(parallel([a, b])).toEqualTypeOf<Runnable>()
    expectTypeOf(step((s) => s)).toEqualTypeOf<Runnable>()
    expectTypeOf(router({ classifier: a, routes: { x: b } })).toEqualTypeOf<Runnable>()
    expectTypeOf(refine({ worker: b, evaluator: a })).toEqualTypeOf<Runnable>()
  })

  it('조합기 결과를 다시 조합기에 넣을 수 있다', () => {
    expectTypeOf(
      chain(parallel([a, b]), refine({ worker: a, evaluator: a })),
    ).toEqualTypeOf<Runnable>()
  })

  it('step은 동기 함수와 비동기 함수를 모두 받는다', () => {
    expectTypeOf(step((s: string) => s)).toEqualTypeOf<Runnable>()
    expectTypeOf(step(async (s: string) => s)).toEqualTypeOf<Runnable>()
  })

  it('router는 분류에 Agent를 요구한다 (Runnable로는 부족하다)', () => {
    // generate()가 필요해서 Agent여야 한다. 이 제약이 풀리면 알아채야 한다.
    expectTypeOf(router).parameter(0).toHaveProperty('classifier').toEqualTypeOf<Agent>()
  })
})

describe('메모리', () => {
  it('localMemory는 MemoryStore를 준다', () => {
    expectTypeOf(localMemory()).toEqualTypeOf<MemoryStore>()
  })

  it('memoryTools는 도구 배열을 준다', () => {
    expectTypeOf(memoryTools(localMemory())).toEqualTypeOf<Array<AgentTool>>()
  })

  it('MemoryStore는 전부 비동기다', () => {
    expectTypeOf<MemoryStore['get']>().returns.toEqualTypeOf<
      Promise<string | undefined>
    >()
    expectTypeOf<MemoryStore['keys']>().returns.toEqualTypeOf<Promise<Array<string>>>()
  })
})
