import { tool } from './tool'
import type { AgentTool } from './tool'

/**
 * 브라우저에 남는 외부 기억.
 *
 * Prompt API 세션은 메모리에만 있고 새로고침하면 사라진다. 그리고 컨텍스트 창이 좁아서
 * 알아야 할 것을 전부 대화 안에 쌓아둘 수도 없다. 그래서 "기억"은 모델 밖에 두고,
 * 필요할 때만 도구로 꺼내 창에 넣는 방식이 온디바이스 모델에서 유일하게 확장 가능한 구조다.
 *
 * 기본 구현은 localStorage(약 5MB)다. 더 큰 저장이 필요하면 이 인터페이스만 맞춰
 * IndexedDB나 서버 저장소로 갈아끼우면 된다.
 */
export interface MemoryStore {
  get: (key: string) => Promise<string | undefined>
  set: (key: string, value: string) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<Array<string>>
}

/**
 * localStorage 기반 저장소.
 * localStorage가 없는 환경(SSR, 테스트, Node)에서는 자동으로 메모리 Map으로 떨어진다.
 */
export function localMemory(namespace = 'my-little-agent'): MemoryStore {
  const prefix = `${namespace}:`
  const storage: Storage | undefined = globalThis.localStorage
  const fallback = new Map<string, string>()

  return {
    async get(key) {
      return storage ? (storage.getItem(prefix + key) ?? undefined) : fallback.get(key)
    },
    async set(key, value) {
      if (storage) storage.setItem(prefix + key, value)
      else fallback.set(key, value)
    },
    async delete(key) {
      if (storage) storage.removeItem(prefix + key)
      else fallback.delete(key)
    },
    async keys() {
      if (!storage) return [...fallback.keys()]
      return Object.keys(storage)
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
    },
  }
}

/**
 * 저장소를 에이전트가 쓸 수 있는 도구 3종으로 바꾼다.
 *
 * 같은 store를 여러 에이전트에 넘기면 그대로 공유 메모(공유 작업판)가 된다.
 * 에이전트들이 서로의 컨텍스트를 볼 수는 없지만, 이 저장소를 통해 정보를 주고받을 수 있다.
 */
export function memoryTools(store: MemoryStore): Array<AgentTool> {
  return [
    tool<{ key: string; value: string }>({
      name: 'remember',
      description: '나중에 다시 쓸 정보를 이름표를 붙여 저장한다',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '짧은 이름표' },
          value: { type: 'string', description: '저장할 내용' },
        },
        required: ['key', 'value'],
      },
      execute: async ({ key, value }) => {
        await store.set(key, value)
        return `저장 완료: ${key}`
      },
    }),
    tool<{ key: string }>({
      name: 'recall',
      description: '저장해 둔 정보를 이름표로 꺼낸다',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
      execute: async ({ key }) => (await store.get(key)) ?? `${key}에 저장된 내용이 없다`,
    }),
    tool({
      name: 'listMemories',
      description: '저장된 이름표 목록을 본다',
      execute: async () => {
        const keys = await store.keys()
        return keys.length ? keys.join(', ') : '저장된 것이 없다'
      },
    }),
  ]
}
