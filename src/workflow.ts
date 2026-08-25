import type { Agent, Runnable } from './agent'
import type { JSONSchema } from './types'

/**
 * 워크플로우에 들어온 Agent가 stateless가 아니면 한 번 알려준다.
 *
 * 이것이 가장 찾기 어려운 실수다. 에러가 나지 않고 첫 실행도 멀쩡한데,
 * 두 번째 실행부터 이전 대화가 컨텍스트에 남아 답이 조용히 달라진다.
 * 창이 수천 토큰뿐이라 몇 번만 돌려도 앞부분이 통째로 밀려난다.
 *
 * 조합기를 만들 때 한 번만 검사한다(실행마다가 아니다).
 * `stateless: false`를 명시했으면 의도한 것으로 보고 조용히 넘어간다.
 */
function warnIfStateful(steps: Array<Runnable>, where: string): void {
  for (const step of steps) {
    // instanceof 대신 send로 판별한다. Agent를 값으로 import하면
    // chain만 쓰는 사용자도 Agent 전체를 번들에 끌고 오게 된다.
    const agent = step as Partial<Agent>
    if (typeof agent.send !== 'function' || agent.stateless !== undefined) continue

    console.warn(
      `[my-little-agent] ${where}의 "${step.name}"에 stateless가 켜져 있지 않다.\n` +
        `  워크플로우를 두 번 이상 실행하면 이전 실행의 대화가 남아 결과가 달라진다.\n` +
        `  단계로 쓰는 에이전트라면 stateless: true를, 대화를 이어갈 의도라면 stateless: false를 명시해라.`,
    )
  }
}

/**
 * 순수 함수를 워크플로우 단계로 감싼다.
 * 전처리/후처리처럼 모델이 필요 없는 단계를 chain 사이에 끼울 때 쓴다.
 */
export function step(
  run: (input: string) => string | Promise<string>,
  name = 'step',
): Runnable {
  return { name, run: async (input) => run(input) }
}

/**
 * 순차 실행. 앞 단계의 출력이 다음 단계의 입력이 된다.
 *
 * ```ts
 * const pipeline = chain(writer, editor, translator)
 * ```
 */
export function chain(...steps: Array<Runnable>): Runnable {
  warnIfStateful(steps, 'chain')
  return {
    name: `chain(${steps.map((s) => s.name).join('→')})`,
    async run(input) {
      let current = input
      for (const s of steps) {
        current = await s.run(current)
      }
      return current
    },
  }
}

export interface ParallelOptions {
  /** 결과 합치기. 기본값은 에이전트 이름을 소제목으로 붙여 이어붙인다. */
  reduce?: (results: Array<string>, input: string) => string | Promise<string>
}

/**
 * 같은 입력을 여러 단계에 동시에 흘리고 결과를 합친다.
 *
 * 합칠 때 모델이 필요하면 reduce 대신 chain으로 이어라:
 * `chain(parallel([a, b, c]), summarizer)`
 */
export function parallel(
  steps: Array<Runnable>,
  options: ParallelOptions = {},
): Runnable {
  warnIfStateful(steps, 'parallel')
  return {
    name: `parallel(${steps.map((s) => s.name).join(',')})`,
    async run(input) {
      const results = await Promise.all(steps.map((s) => s.run(input)))
      if (options.reduce) return options.reduce(results, input)
      return steps.map((s, i) => `## ${s.name}\n${results[i] ?? ''}`).join('\n\n')
    },
  }
}

export interface RouterOptions {
  /** 분류를 담당할 에이전트. generate()를 쓰므로 Agent여야 한다. */
  classifier: Agent
  /** 라우트 이름 → 실행 단계 */
  routes: Record<string, Runnable>
  /** 분류 실패 시 대체 경로. 없으면 에러를 던진다. */
  fallback?: Runnable
  /** 각 라우트가 어떤 요청을 받아야 하는지 설명. 정확도를 크게 올린다. */
  descriptions?: Record<string, string>
}

/**
 * 입력을 분류해 알맞은 단계 하나에만 넘긴다.
 * 분류는 JSON Schema enum으로 강제하므로 라우트 이름 밖의 값이 나오지 않는다.
 */
export function router(options: RouterOptions): Runnable {
  const names = Object.keys(options.routes)
  // 분류기도 실행마다 대화가 쌓인다. 라우팅은 보통 매번 백지에서 판단해야 한다.
  warnIfStateful([options.classifier, ...Object.values(options.routes)], 'router')
  const schema: JSONSchema = {
    type: 'object',
    properties: {
      route: { type: 'string', enum: names },
      reason: { type: 'string' },
    },
    required: ['route', 'reason'],
    additionalProperties: false,
  }

  return {
    name: `router(${names.join('|')})`,
    async run(input) {
      const catalog = names
        .map((n) => `- ${n}: ${options.descriptions?.[n] ?? ''}`)
        .join('\n')
      const { route } = await options.classifier.generate<{ route: string }>(
        `요청:\n${input}\n\n아래 경로 중 이 요청을 가장 잘 처리할 하나를 골라라.\n${catalog}`,
        schema,
      )

      const picked = options.routes[route] ?? options.fallback
      if (!picked) throw new Error(`라우팅 실패: "${route}"에 해당하는 경로가 없다.`)
      return picked.run(input)
    },
  }
}

export interface RefineOptions {
  /** 결과물을 만드는 단계 */
  worker: Runnable
  /** 점수와 피드백을 매기는 에이전트 */
  evaluator: Agent
  /** 최대 시도 횟수(최초 작성 포함) */
  maxRounds?: number
  /** 이 점수 이상이면 조기 종료 (0~100) */
  minScore?: number
  /** 라운드마다 진행 상황 관찰용 */
  onRound?: (round: number, draft: string, score: number, feedback: string) => void
}

const EVAL_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    feedback: { type: 'string' },
  },
  required: ['score', 'feedback'],
  additionalProperties: false,
}

/**
 * evaluator-optimizer 루프.
 * worker가 초안을 쓰고 evaluator가 채점하며, 점수가 기준에 닿을 때까지 다시 쓴다.
 */
export function refine(options: RefineOptions): Runnable {
  const maxRounds = options.maxRounds ?? 3
  const minScore = options.minScore ?? 80
  // 여기가 가장 심하다. worker와 evaluator를 한 번의 run에서만 최대 maxRounds번 부른다.
  warnIfStateful([options.worker, options.evaluator], 'refine')

  return {
    name: `refine(${options.worker.name})`,
    async run(input) {
      let draft = await options.worker.run(input)

      for (let round = 1; round < maxRounds; round++) {
        const { score, feedback } = await options.evaluator.generate<{
          score: number
          feedback: string
        }>(
          `원래 요청:\n${input}\n\n현재 결과물:\n${draft}\n\n0~100점으로 채점하고 구체적인 개선 피드백을 써라.`,
          EVAL_SCHEMA,
        )
        options.onRound?.(round, draft, score, feedback)
        if (score >= minScore) break

        draft = await options.worker.run(
          `원래 요청:\n${input}\n\n이전 결과물:\n${draft}\n\n피드백:\n${feedback}\n\n피드백을 반영해 다시 작성해라.`,
        )
      }
      return draft
    },
  }
}
