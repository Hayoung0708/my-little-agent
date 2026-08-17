<h1 align="center">My Little Agent</h1>

<p align="center">
브라우저 안에서 전부 돌아가는 아주 작은 멀티 에이전트 프레임워크입니다.<br/>
<a href="https://developer.chrome.com/docs/ai/built-in?hl=ko">Chrome Built-in AI</a> 기반이라 서버도, API 키도, 토큰 비용도 필요하지 않습니다.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/gzip-3.63%20kB-brightgreen" alt="gzip 3.63 kB" height="18">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="의존성 0개" height="18">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6" alt="TypeScript strict" height="18">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT license" height="18">
</p>

<p align="center">
  <a href="./README.md">English</a> | <b>한국어</b>
</p>

```ts
import { Agent, chain, parallel } from 'my-little-agent'

const lens = (role: string) =>
  new Agent({ instruction: `너는 ${role} 관점에서만 분석한다.`, stateless: true })

const summarizer = new Agent({ instruction: '분석들을 한 문단으로 합쳐라.' })

// 세 에이전트가 동시에 분석하고, 하나가 결과를 합칩니다.
// 사용자 기기에서 실행되므로 데이터가 밖으로 나가지 않습니다.
const report = await chain(
  parallel([lens('장점'), lens('단점'), lens('위험')]),
  summarizer,
).run(reviews)
```

**My** — 사용자 기기에서 실행 · **Little** — gzip 3.63 kB, 의존성 0개 · **Agent** — 도구를 쓰며 협업하는 에이전트들.

## 특징

- **백엔드가 없습니다.** 모델이 Chrome에 들어 있어 프록시도, 키 관리도, 과금 대시보드도 필요 없습니다.
- **호출 비용이 0원입니다.** 그래서 호출 횟수를 아끼지 않아도 되는 기능을 처음으로 만들 수 있습니다.
- **기본이 비공개입니다.** 입력이 기기를 벗어나지 않고, 오프라인에서도 동작합니다.
- **조합됩니다.** `Agent`와 `tool`, 모든 워크플로가 `Runnable` 하나를 공유해 자유롭게 중첩됩니다.
- **좁은 컨텍스트 창을 전제로 설계했습니다.** 창 분리, stateless 단계, 도구 결과 절단, 외부 기억.
- **작습니다.** gzip 3.63 kB, 런타임 의존성 0개, 한 시간이면 다 읽는 617줄.

## 문서

- [시작하기](#시작하기)
- [핵심 개념](#핵심-개념)
  - [`Agent`](#agent--역할-하나-세션-하나)
  - [`tool`](#tool--모델이-부를-수-있는-평범한-함수)
  - [`Runnable`](#runnable--모든-것이-같은-모양)
- [워크플로](#워크플로)
- [컨텍스트와 기억](#컨텍스트와-기억)
- [솔직한 한계](#솔직한-한계)
- [프론트엔드 활용 예시](#프론트엔드-활용-예시)
- [얼마나 Little한가](#얼마나-little한가)
- [API 레퍼런스](#api-레퍼런스)
- [로드맵](#로드맵)

## 시작하기

### 요구사항

|           |                                                        |
| :-------- | :----------------------------------------------------- |
| 브라우저  | Chrome 138+ 데스크톱 (Windows 10/11, macOS 13+, Linux) |
| 저장 공간 | 22 GB 이상 여유                                        |
| GPU       | VRAM 4 GB 이상                                         |

모델 상태는 `chrome://on-device-internals` 에서 확인하실 수 있습니다.

### 설치

```bash
pnpm add my-little-agent
```

### 세 줄이면 됩니다

```ts
import { Agent } from 'my-little-agent'

const agent = new Agent({ instruction: '너는 간결한 한국어 비서다.' })
console.log(await agent.send('재귀를 한 문장으로 설명해줘'))
```

### 실제 서비스에서는 가용성부터 확인하세요

모든 방문자가 Built-in AI를 쓸 수 있는 것은 아닙니다. 미지원 환경에서도 예외를 던지지 않고 `'unavailable'`을 돌려주므로, 기능을 숨기거나 서버 방식으로 대체하시면 됩니다.

```ts
import { availability } from 'my-little-agent'

const state = await availability()
// 'unavailable' | 'downloadable' | 'downloading' | 'available'

if (state === 'unavailable') {
  hideAIFeature()
} else if (state === 'downloadable') {
  // 첫 호출에서 모델을 내려받습니다. 진행률을 보여 주세요.
  new Agent({ onDownloadProgress: (p) => setProgress(Math.round(p * 100)) })
}
```

## 핵심 개념

세 개뿐입니다. 이게 전부입니다.

### `Agent` — 역할 하나, 세션 하나

```ts
const agent = new Agent({
  name: 'writer', // 로그와 병렬 결과 라벨에 쓰입니다
  instruction: '너는 카피라이터다.', // 시스템 프롬프트
  tools: [/* ... */], // 있으면 도구 호출 루프로 동작합니다
  maxSteps: 5, // 도구 루프 상한
  stateless: true, // 호출마다 백지에서 시작 (워크플로 단계용)
  maxToolResultChars: 4000, // 도구 결과 절단 기준 (컨텍스트 보호)
  history: saved, // 이전 대화 복원
  onEvent: (e) => console.log(e), // 도구 호출·결과 추적
})

await agent.send('...') // 최종 텍스트
agent.stream('...') // 델타 조각 비동기 이터레이터
await agent.generate<T>('...', schema) // 스키마를 강제한 객체
agent.usage // { used, total } 컨텍스트 토큰
agent.destroy() // 세션 반납
```

세션은 첫 호출 때 만들어지므로, 인스턴스를 미리 생성해 두어도 비용이 들지 않습니다.

### `tool` — 모델이 부를 수 있는 평범한 함수

```ts
const weather = tool<{ city: string }>({
  name: 'weather',
  description: '도시의 현재 기온을 조회한다', // 모델은 이 한 줄만 보고 고릅니다
  parameters: { type: 'object', properties: { city: { type: 'string' } } },
  execute: async ({ city }) => fetch(`/api/weather?city=${city}`).then((r) => r.json()),
})
```

도구가 예외를 던져도 루프는 죽지 않습니다. 오류가 모델에게 전달되어 다른 방법을 시도하게 됩니다.

> Built-in AI에는 아직 안정적인 네이티브 함수 호출이 없어서 JSON Schema 제약 디코딩으로 루프를 돌립니다. 네이티브가 나와도 사용하시는 코드는 그대로입니다.

### `Runnable` — 모든 것이 같은 모양

`Agent`도, `chain`도, `parallel`도, `router`도, `refine`도 전부 `{ name, run(input) }`을 만족합니다. 그래서 어댑터 없이 서로 중첩됩니다.

```ts
chain(parallel([a, b, c]), router({ ... }), refine({ ... }))
```

## 워크플로

| 조합기                           | 하는 일                          | 언제 쓰나요            |
| :------------------------------- | :------------------------------- | :--------------------- |
| `chain(...steps)`                | 순차 실행, 앞 결과가 뒤 입력     | 초안 → 교정 → 번역     |
| `parallel(steps, opts?)`         | 같은 입력을 동시에 실행 후 합침  | 여러 관점 동시 분석    |
| `router({ classifier, routes })` | 분류 후 한 경로만 실행           | 문의 유형별 분기       |
| `refine({ worker, evaluator })`  | 점수가 기준에 닿을 때까지 재작성 | 품질이 중요한 결과물   |
| `step(fn)`                       | 모델이 필요 없는 순수 함수 단계  | 전처리, 후처리, 마스킹 |

```ts
// 개인정보를 지우고, 세 관점으로 나눠 분석한 뒤, 하나로 합칩니다.
const flow = chain(
  step((s) => s.replace(/\d{3}-\d{4}-\d{4}/g, '[전화번호]')),
  parallel([장점분석, 단점분석, 위험분석]),
  요약가,
)
```

모델로 합치고 싶으시면 별도 옵션 대신 `chain`으로 이으시면 됩니다. 직접 합치시려면 `reduce`를 주세요.

```ts
parallel([a, b], { reduce: (results) => results.join('\n---\n') })
```

## 컨텍스트와 기억

창이 수천 토큰뿐이라, 이 문제를 나중에 덧대지 않고 처음부터 설계에 넣었습니다.

### 에이전트끼리는 컨텍스트를 공유하지 않습니다

각 에이전트는 자기만의 세션과 자기만의 창을 가집니다. 서로에게 넘어가는 것은 `run()`이 돌려준 문자열 하나뿐입니다.

```
   [분류기]         [분석가]         [요약가]
    자기 창          자기 창          자기 창
       └── 문자열 ──→   └── 문자열 ──→
```

제약처럼 보이지만 의도한 설계입니다. 창이 좁을수록 공유는 재앙이 됩니다. 한 에이전트가 만든 잡음이 모두의 창을 함께 갉아먹기 때문입니다. 분리해 두면 에이전트 N개가 **독립된 창 N개**가 되어, 시스템 전체가 다루는 정보량은 오히려 늘어납니다.

작업을 쪼개는 것이 품질에도 좋고 컨텍스트에도 좋습니다. 같은 이유입니다.

### 창이 넘치는 지점은 세 곳입니다

| 상황                                 | 무슨 일이 생기나요                      | 대응                               |
| :----------------------------------- | :-------------------------------------- | :--------------------------------- |
| 같은 에이전트로 워크플로를 반복 실행 | 이전 실행의 대화가 창에 그대로 남습니다 | `stateless: true`                  |
| 도구가 큰 JSON을 돌려줌              | 결과 하나가 대화를 통째로 밀어냅니다    | `maxToolResultChars` (기본 4000자) |
| 입력 문서 자체가 김                  | 오래된 부분이 조용히 잘립니다           | `step()`으로 쪼개 `parallel` 처리  |

```ts
// 워크플로 단계로 쓰는 에이전트는 stateless로 두세요.
// 매 호출이 백지에서 시작하므로 몇 번을 돌려도 창이 자라지 않습니다.
const summarizer = new Agent({ instruction: '너는 요약가다.', stateless: true })

const flow = chain(분류기, summarizer)
await flow.run(문서1)
await flow.run(문서2) // 문서1의 대화가 남아 있지 않습니다
```

챗봇처럼 대화를 이어가야 하는 에이전트는 기본값(`stateless: false`)을 그대로 쓰시면 됩니다.

```ts
agent.usage // { used: 812, total: 4096 }
new Agent({ onEvent: (e) => e.type === 'context-overflow' && warn() })
```

### 세션은 새로고침하면 사라집니다

Chrome이 디스크에 보관하는 것은 **모델 가중치뿐**입니다. 처음에 몇 GB를 내려받는 그것입니다. 대화 기록은 메모리에만 있어서 탭을 닫으면 사라지고, 브라우저가 대신 저장해 주지 않습니다. 그래서 저장은 우리 몫이고, `agent.history`로 하시면 됩니다.

```ts
localStorage.setItem('chat', JSON.stringify(agent.history))

// 복원은 최근 몇 턴만. 전부 넣으면 창이 다시 꽉 찹니다.
const saved = JSON.parse(localStorage.getItem('chat') ?? '[]')
const agent = new Agent({ instruction: '...', history: saved.slice(-10) })
```

> 복원은 **지속성** 문제를 풀지, **용량** 문제를 풀지 않습니다. 저장소가 아무리 커도 창에 넣을 수 있는 양은 그대로입니다.

### 그래서 기억은 모델 밖에 둡니다

> **컨텍스트 창은 작업대, 브라우저 저장소는 창고입니다.**
> 창고의 물건을 전부 작업대에 올리지 않습니다. 필요한 것만 그때그때 꺼내 옵니다.

`localMemory()`로 저장소를 만들고 `memoryTools()`로 도구화합니다. **같은 저장소를 여러 에이전트에게 주면 그대로 공유 작업판이 됩니다.**

```ts
import { Agent, chain, localMemory, memoryTools } from 'my-little-agent'

const shared = localMemory('support-desk')
const tools = memoryTools(shared) // remember / recall / listMemories

const researcher = new Agent({
  instruction: '조사한 사실은 remember로 저장해라.',
  tools: [...tools, 검색도구],
  stateless: true,
})

const writer = new Agent({
  instruction: '필요한 사실은 recall로 꺼내 쓴 뒤 답변을 작성해라.',
  tools,
  stateless: true,
})

await chain(researcher, writer).run('경쟁사 가격 정책 정리해줘')
```

두 에이전트의 창은 끝까지 독립적입니다. 오가는 것은 저장소에 남은 짧은 항목들뿐이라, 협업이 길어져도 창이 터지지 않습니다. 새로고침해도 저장소는 남아 있습니다.

저장소는 메서드 네 개만 구현하면 갈아끼울 수 있습니다.

```ts
interface MemoryStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}
```

`localMemory()`는 localStorage(약 5 MB)를 씁니다. 더 큰 저장이 필요하시면 IndexedDB나 자체 API로 같은 인터페이스를 구현하시면 됩니다.

## 솔직한 한계

### GPT-5나 Claude보다 훨씬 못합니다

노트북 GPU 안에 통째로 올라가는 모델과 데이터센터에서 도는 모델은 체급이 다릅니다.

|               | 온디바이스 (Gemini Nano) | 서버 LLM          |
| :------------ | :----------------------- | :---------------- |
| 모델 크기     | 수십억 파라미터급        | 수천억 파라미터급 |
| 컨텍스트      | 수천 토큰                | 수십만 토큰       |
| 복잡한 추론   | 약함                     | 강함              |
| 지식의 정확도 | 낮고 환각이 잦음         | 상대적으로 높음   |
| 긴 문서 처리  | 사실상 불가              | 가능              |

**유료 API의 싼 대체재가 아닙니다.** 다른 계층입니다. CDN 엣지 캐시는 원본 서버보다 똑똑하지 않지만, 가깝고 싸고 항상 켜져 있어서 다른 일을 맡습니다.

| 축           | 온디바이스             | 서버 LLM           |
| :----------- | :--------------------- | :----------------- |
| 답변 품질    | ❌ 짐                  | ✅ 이김            |
| 첫 응답 지연 | ✅ 왕복 없음           | ❌ 왕복 필요       |
| 호출당 비용  | ✅ 0원                 | ❌ 과금            |
| 호출 빈도    | ✅ 제한 없음           | ❌ 비용·레이트리밋 |
| 프라이버시   | ✅ 기기 밖으로 안 나감 | ❌ 외부 전송       |
| 오프라인     | ✅ 동작                | ❌ 불가            |
| 운영 부담    | ✅ 없음                | ❌ 키·프록시·과금  |

품질이 결정적인 기능은 서버로 보내시고, 품질보다 빈도·지연·프라이버시가 중요한 기능을 여기로 가져오세요.

### 소형 모델이 실제로 잘하는 일

| 잘합니다 (있는 텍스트를 가공) | 못합니다 (없는 지식을 만듦) |
| :---------------------------- | :-------------------------- |
| 분류, 라우팅, 태깅            | 사실 질의응답               |
| 구조화 추출 (텍스트 → JSON)   | 최신 정보, 희귀 지식        |
| 형식 변환, 톤 조정, 맞춤법    | 긴 문서 종합                |
| 짧은 요약                     | 복잡한 다단계 추론          |
| 의도 파악, 자연어 → 쿼리      | 정확한 계산                 |

[아래 활용 예시](#프론트엔드-활용-예시)가 전부 왼쪽 칸에 있는 것은 우연이 아닙니다.

### 프레임워크가 격차의 일부를 구조로 메웁니다

| 약점                      | 대응                        | 도구                 |
| :------------------------ | :-------------------------- | :------------------- |
| 복잡한 작업에서 품질 급락 | 단순한 단계로 분해          | `chain` · `parallel` |
| 출력 형식을 자주 어김     | 디코딩 자체를 스키마로 제약 | `generate()`         |
| 모르는 것을 지어냄        | 지식은 도구가 공급          | `tool()`             |
| 첫 결과물이 부실함        | 채점 후 기준까지 재작성     | `refine()`           |

특히 세 번째가 중요합니다. **소형 모델을 지식 저장소로 쓰지 마시고, 언어 처리기로만 쓰세요.** 사실은 도구가 가져오고, 모델은 그것을 읽고 정리하는 역할만 맡습니다.

```ts
// ❌ 모델의 기억에 의존
await agent.send('우리 회사 환불 정책이 뭐야?')

// ✅ 사실은 도구가, 문장은 모델이
const agent = new Agent({
  instruction: '너는 상담원이다. 도구가 준 내용만 근거로 답해라.',
  tools: [정책조회도구],
})
```

### 어려운 건 서버로 넘기시면 됩니다

`Runnable`이 `{ name, run(input) }`일 뿐이라, 서버 LLM도 세 줄이면 같은 파이프라인에 들어옵니다.

```ts
const cloud = step(
  (input) => fetch('/api/llm', { method: 'POST', body: input }).then((r) => r.text()),
  'cloud',
)

const hybrid = router({
  classifier: new Agent({ name: 'triage' }),
  routes: { local: new Agent({ instruction: '간단한 문의를 처리한다.' }), cloud },
  descriptions: {
    local: '인사, 분류, 형식 변환, 짧은 요약처럼 간단한 요청',
    cloud: '긴 문서 분석, 복잡한 추론, 정확한 지식이 필요한 요청',
  },
})
```

대부분의 요청이 로컬에서 즉시·무료로 끝나고, 서버 호출은 정말 필요한 것만 남습니다.

> 단, cloud 경로가 생기는 순간 프라이버시 이점은 **그 경로에 한해** 사라집니다. 민감한 데이터를 다루신다면 경로를 아예 두지 않거나 마스킹 `step()`을 앞에 끼워 주세요.

### 이럴 땐 쓰지 마세요

- **모든 사용자에게 동작해야 하는 핵심 기능** — Chrome 데스크톱 일부 환경만 지원합니다. 부가 기능으로 쓰시거나 서버 폴백을 두세요.
- **긴 문서 처리** — `agent.usage`로 확인하시고 입력을 쪼개 주세요.
- **정확한 지식이 필요한 질의** — 사실은 도구로 넣어 주세요.
- **첫인상이 중요한 경우** — 첫 실행에 수 GB 다운로드가 발생할 수 있습니다. 진행률을 꼭 보여 주세요.

## 프론트엔드 활용 예시

### 붙여넣기 → 폼 자동 완성

```ts
const form = await parser.generate<{ name: string; phone: string; address: string }>(
  clipboardText,
  {
    type: 'object',
    properties: {
      name: { type: 'string' },
      phone: { type: 'string' },
      address: { type: 'string' },
    },
    required: ['name', 'phone', 'address'],
  },
)
```

`generate()`는 디코딩 자체를 제약하므로 모델이 설명을 덧붙이거나 형식을 어길 수 없습니다. 바로 `setState`에 넣으시면 됩니다.

### 자연어 → 클라이언트 필터

```ts
const query = await parser.generate<{ category: string; maxPrice: number }>(
  '3만원 아래 러닝화 보여줘',
  {
    type: 'object',
    properties: {
      category: { type: 'string', enum: ['shoes', 'clothes', 'bags'] },
      maxPrice: { type: 'integer' },
    },
    required: ['category', 'maxPrice'],
  },
)

setItems(all.filter((i) => i.category === query.category && i.price <= query.maxPrice))
```

### 페이지 기능을 도구로 노출

```ts
const assistant = new Agent({
  instruction: '너는 이 쇼핑몰의 비서다. 필요하면 도구를 써라.',
  tools: [
    tool<{ keyword: string }>({
      name: 'searchProducts',
      description: '상품을 키워드로 검색한다',
      parameters: { type: 'object', properties: { keyword: { type: 'string' } } },
      execute: ({ keyword }) => fetch(`/api/products?q=${keyword}`).then((r) => r.json()),
    }),
    tool<{ id: string }>({
      name: 'addToCart',
      description: '상품을 장바구니에 담는다',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
      execute: ({ id }) => cartStore.add(id),
    }),
  ],
})

await assistant.send('아까 본 러닝화 중에 제일 싼 거 장바구니에 넣어줘')
```

### 문의 위젯 라우팅

```ts
const desk = router({
  classifier: new Agent({ name: 'classifier' }),
  routes: { refund: 환불에이전트, tech: 기술지원에이전트, sales: 영업에이전트 },
  descriptions: {
    refund: '환불, 취소, 반품 문의',
    tech: '오류, 사용법 문의',
    sales: '가격, 구매 상담',
  },
})
```

### 내보내기 전에 스스로 검토시키기

```ts
const polished = refine({
  worker: new Agent({ instruction: '너는 카피라이터다.' }),
  evaluator: new Agent({ instruction: '너는 엄격한 편집장이다.' }),
  minScore: 85,
  maxRounds: 3,
})
```

### React

별도 어댑터가 필요 없습니다.

```tsx
function useAgent(instruction: string) {
  const ref = useRef<Agent>()
  if (!ref.current) ref.current = new Agent({ instruction }) // 세션은 lazy라 생성 비용이 없습니다
  useEffect(() => () => ref.current?.destroy(), [])
  return ref.current
}

export function Summarizer({ text }: { text: string }) {
  const agent = useAgent('너는 요약가다. 세 문장으로 줄인다.')
  const [out, setOut] = useState('')

  useEffect(() => {
    let alive = true
    setOut('')
    ;(async () => {
      for await (const chunk of agent.stream(text)) {
        if (!alive) return
        setOut((prev) => prev + chunk)
      }
    })()
    return () => {
      alive = false
    }
  }, [text])

  return <p>{out}</p>
}
```

### 멀티모달 입력

```ts
const vision = new Agent({
  instruction: '너는 이미지 설명가다.',
  expectedInputs: [{ type: 'image' }],
})

await vision.send([
  {
    role: 'user',
    content: [
      { type: 'text', value: '이 사진에 뭐가 있어?' },
      { type: 'image', value: imageBlob },
    ],
  },
])
```

## 얼마나 Little한가

주장하지 않고 측정했습니다. `npm run size`로 재현하실 수 있습니다.

| 시나리오                   | minified |        gzip |  brotli |
| :------------------------- | -------: | ----------: | ------: |
| `Agent` 하나만             |  5.61 kB | **2.38 kB** | 2.09 kB |
| 에이전트 + 도구 + 워크플로 |  7.44 kB | **3.03 kB** | 2.67 kB |
| 공개 API 전부              |  9.18 kB | **3.63 kB** | 3.19 kB |

`Agent`만 쓸 때가 전부 쓸 때보다 작습니다. 트리 셰이킹이 실제로 동작한다는 뜻입니다. 모델 자체는 Chrome이 관리하므로 번들에 들어가지 않습니다.

|                           |                             |
| :------------------------ | :-------------------------- |
| 런타임 의존성             | **0개**                     |
| 소스                      | **889줄** (주석 제외 617줄) |
| 공개 API                  | **15개**                    |
| 동작하는 최소 코드        | **3줄**                     |
| 외워야 할 개념            | **3개**                     |
| 설정 파일 · API 키 · 서버 | **0**                       |

## API 레퍼런스

|                                             |                                                                   |
| :------------------------------------------ | :---------------------------------------------------------------- |
| `isSupported()`                             | 전역 `LanguageModel` 존재 여부                                    |
| `availability(opts?)`                       | `'unavailable' \| 'downloadable' \| 'downloading' \| 'available'` |
| `modelParams()`                             | topK / temperature 기본값·최대값 (미지원 시 `null`)               |
| `createSession(opts)`                       | 저수준 세션 직접 생성                                             |
| `new Agent(opts)` / `agent(opts)`           | 에이전트 생성 (세션은 lazy)                                       |
| `.send(input)`                              | 최종 텍스트, 도구 루프를 끝까지 실행                              |
| `.stream(input)`                            | 델타 조각 비동기 이터레이터                                       |
| `.generate<T>(input, schema)`               | 스키마를 강제한 파싱된 객체                                       |
| `.fork(name?)`                              | 현재 대화를 복제한 새 에이전트                                    |
| `.history`                                  | 대화 기록 (저장·복원용)                                           |
| `.usage`                                    | `{ used, total }` 컨텍스트 토큰                                   |
| `.reset()` / `.destroy()`                   | 기록까지 폐기 / 세션만 반납                                       |
| `tool(def)`                                 | 도구 정의 헬퍼                                                    |
| `localMemory(namespace?)`                   | localStorage 기반 `MemoryStore`                                   |
| `memoryTools(store)`                        | 저장소를 `remember` / `recall` / `listMemories` 도구로 변환       |
| `chain` `parallel` `router` `refine` `step` | 워크플로 조합기                                                   |
| `UnavailableError`                          | Prompt API 미지원 환경에서 던져지는 에러                          |

## 로드맵

- [x] 대화 기록 영속화 (`agent.history`)와 공유 메모리 (`localMemory`)
- [x] 컨텍스트 가드 (`stateless`, 도구 결과 절단)
- [ ] 도구 실행 전 사용자 승인 — DOM을 바꾸는 도구에는 사실상 필수
- [ ] IndexedDB `MemoryStore` 기본 제공
- [ ] 원격 모델 폴백 어댑터
- [ ] Web Worker 오프로드
- [ ] 서브태스크를 동적으로 쪼개는 orchestrator
- [ ] 컨텍스트 초과 전 자동 요약 압축

## 개발

**이 저장소는 pnpm 전용입니다.** `npm install`과 `yarn install`은 `only-allow` preinstall 훅에서 중단되고, `packageManager` 필드가 pnpm 버전을 고정합니다.

```bash
corepack enable   # package.json에 고정된 pnpm이 설치됩니다
pnpm install

pnpm test         # vitest, 가짜 LanguageModel 전역을 주입해 검증합니다
pnpm typecheck
pnpm lint         # eslint (@tanstack/eslint-config)
pnpm format       # prettier
pnpm size         # 위 크기 표를 재현합니다
pnpm build        # vite (@tanstack/vite-config) + publint --strict
pnpm example      # Chrome 138+ 에서 실제 동작 확인
```

| 도구                                           | 역할                                                                 |
| :--------------------------------------------- | :------------------------------------------------------------------- |
| [TanStack Config](https://tanstack.com/config) | Vite 빌드와 ESLint 프리셋                                            |
| Prettier                                       | 포매팅, lint-staged를 통해 실행                                      |
| Husky                                          | Git 훅 (`pre-commit`, `commit-msg`)                                  |
| lint-staged                                    | 스테이징된 파일만 eslint·prettier 실행                               |
| commitlint                                     | [Conventional Commits](https://www.conventionalcommits.org/ko/) 강제 |

커밋 메시지는 Conventional Commits를 따릅니다. `feat: 공유 메모리 추가`는 통과하고, `수정함`은 거부됩니다.

## 라이선스

MIT
