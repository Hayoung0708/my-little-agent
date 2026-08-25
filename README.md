<h1 align="center">My Little Agent</h1>

<p align="center">
<b>Chrome Built-in AI</b> 기반 <b>멀티 에이전트</b> 조립 라이브러리<br/>
서버도, API 키도, 토큰 비용도 없이 사용자 브라우저 안에서 전부 끝납니다.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/gzip-6.17%20kB-brightgreen" alt="gzip 6.17 kB" height="18">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="의존성 0개" height="18">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6" alt="TypeScript strict" height="18">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT license" height="18">
</p>

<p align="center">
  <b>한국어</b> |
  <a href="https://github.com/Hayoung0708/my-little-agent/blob/main/README-en_us.md">English</a>
</p>

```ts
import { Agent, chain, summarizer, tool, translator } from 'my-little-agent'

// 1. 에이전트가 부르는 커스텀 함수
const findOrder = tool<{ id: string }>({
  name: 'findOrder',
  description: '주문번호로 주문 정보를 조회한다',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  execute: ({ id }) => db.orders.get(id),
})

// 2. 도구를 쥔 에이전트
const desk = new Agent({
  instruction: '고객 상담원. 주문 관련 질문은 반드시 도구로 확인하고 답한다.',
  tools: [findOrder],
  stateless: true,
})

// 3. 답변을 줄이고 한국어로. 뒤 두 단계는 Chrome 전용 모델이라 에이전트의 컨텍스트 창을 1토큰도 쓰지 않는다.
const flow = chain(desk, summarizer({ length: 'short' }), translator({ to: 'ko' }))

await flow.run('Where is my order A-1024?')
```

## 이걸 쓰면 뭐가 좋나요?

### Built-in AI에서 오는 장점

1. **서버리스** — 모델이 Chrome 안에 있습니다. 프록시도, 키 관리도, 과금 대시보드도 없습니다.
2. **비용 0원** — 개발자에게 토큰 요금이 청구되지 않고, 사용자가 자기 API 키를 붙여넣을 필요도 없습니다.
3. **정보 보호** — 의료·금융·사내 문서처럼 외부 전송이 막힌 데이터도 다룰 수 있습니다. 오프라인에서도 돕니다.

### My Little Agent에서 추가로 오는 장점

1. **도구 호출** —
   모델에게 함수를 쥐여주려면, 출력을 JSON Schema로 묶고 → 파싱하고 → 없는 도구를 지목하면 되돌리고 → 실행 결과를 다시 넣어주고 → 최종 답이 나올 때까지 반복해야 합니다. 이 루프를 `tools: [...]` 한 줄로 줄였습니다.

2. **멀티 에이전트 조립** —
   순차(`chain`) · 동시(`parallel`) · 분기(`router`) · 재작성(`refine`) 네 가지. 결과물도 다시 부품이라 서로 중첩됩니다. `chain(parallel([a, b]), router({ … }))` 처럼요.

3. **컨텍스트 창 관리** —
   온디바이스 모델의 창은 수천 토큰뿐이라 금방 넘칩니다. 에이전트마다 창을 따로 씁니다. 흐름을 다시 돌려도 지난 대화가 쌓이지 않고, 큰 도구 결과는 잘려서 들어갑니다. 넘칠 만한 실수는 콘솔이 먼저 짚어줍니다.

4. **모델 밖 기억** —
   창에 다 담을 수 없는 것은 브라우저 저장소에 두고 필요할 때만 꺼내 씁니다. 같은 저장소를 여러 에이전트에게 넘기면 그대로 공유 작업판이 됩니다. 새로고침해도 남습니다.

5. **못 쓰는 환경 우회** —
   Chrome 전용 모델은 언어쌍마다, 기능마다 사용 가능 여부가 다릅니다. 여섯 군데를 일일이 확인하는 대신 `fallback`에 대체 에이전트를 하나 걸어두면 됩니다.

## 먼저 알아둘 것 — 필수 기능에는 쓰지 마세요

모델이 **사용자 기기에서** 돌기 때문에, 기기 사정이 안 맞으면 기능 자체가 아예 켜지지 않습니다.

|           |                                                                              |
| :-------- | :--------------------------------------------------------------------------- |
| 브라우저  | Chrome 138 이상 **데스크톱** (모바일 미지원)                                 |
| 저장 공간 | 다운로드 시작 전 **22GB 이상 여유**, 이후 **10GB 밑으로 떨어지면 모델 삭제** |
| 기기 성능 | VRAM 4GB 초과, 또는 RAM 16GB + 4코어 이상                                    |
| 첫 실행   | 모델 약 **4GB** 다운로드. 그동안 대기                                        |

모델은 사이트별이 아니라 **브라우저 전역**이라, 사용자가 다른 곳에서 이미 한 번 받았다면 그대로 씁니다.

> **"있으면 더 좋은" 자리에 쓰세요.**
> 없으면 서비스가 안 돌아가는 자리에는 쓰지 마세요. 기능을 숨기거나, 서버 경로를 따로 두거나, `fallback`을 지정해 두세요.

## 문서

- [시작하기](#시작하기)
- [구성 요소](#구성-요소)
  - [Availability — 이 브라우저에서 사용 가능한지 확인하기](#availability--이-브라우저에서-사용-가능한지-확인하기)
  - [Agent — AI 모델 한 명](#agent--ai-모델-한-명)
    - [option](#option)
    - [method](#method)
    - [내장 Agent](#내장-agent)
  - [Tool — 모델이 부르는 커스텀 함수](#tool--모델이-부르는-커스텀-함수)
    - [내장 Tool](#내장-tool)
  - [Workflow — 부품을 이어 붙이기](#workflow--부품을-이어-붙이기)
  - [Memory — 브라우저에 저장](#memory--브라우저에-저장)
- [컨텍스트와 기억](#컨텍스트와-기억)
- [활용 예시](#활용-예시)

## 시작하기

```bash
pnpm add my-little-agent
```

모델은 Chrome이 알아서 내려받고 관리합니다. 앱 번들에는 아무것도 늘지 않습니다. 지금 상태는 `chrome://on-device-internals`에서 볼 수 있습니다.

### 기본은 세 줄이면 됩니다

```ts
import { Agent } from 'my-little-agent'

const agent = new Agent({ instruction: '한국어로 짧고 명확하게 답한다.' })
console.log(await agent.send('재귀를 한 문장으로 설명해줘'))
```

이 세 줄만 놓고 보면 Chrome API를 직접 쓰는 것과 거의 같습니다. **차이는 도구를 붙이고 여러 개를 이어 붙이는 순간부터 생깁니다.** 아래로 이어집니다.

## 구성 요소

`Agent`와 `Workflow`는 **같은 모양**입니다. `{ name, run(input) }` — 이름이 있고, 문자열을 받아 문자열을 돌려줍니다. 코드에서는 이 모양을 `Runnable`이라고 부릅니다. 어댑터 없이 서로 끼워지는 이유가 이것 하나입니다.

| 요소             | 기능                      | 예시                                          |
| :--------------- | :------------------------ | :-------------------------------------------- |
| **Availability** | 이 브라우저에서 되나 확인 | `isSupported()`, `availability()`             |
| **Agent**        | AI 모델 한 명             | `new Agent({ instruction: '너는 번역가다' })` |
| **Tool**         | 모델이 부르는 커스텀 함수 | `tool({ … })`                                 |
| **Workflow**     | Agent를 이어 붙임         | `chain`, `parallel`, `router`, `refine`       |
| **Memory**       | 브라우저에 저장           | `localMemory()`, `memoryTools()`              |

`Availability`와 `Memory`는 `Runnable`이 아닙니다. 각각 시작 전 확인과 저장소이고, 나머지가 부품입니다.

### Availability — 이 브라우저에서 사용 가능한지 확인하기

모든 방문자가 내장 AI를 쓸 수 있는 건 아닙니다. 안 되는 환경에서도 예외를 던지지 않고 `'unavailable'`을 돌려주니, 분기만 해 두면 됩니다.

```ts
import { availability, isSupported } from 'my-little-agent'

isSupported() // boolean — 전역 LanguageModel 존재 여부만 (동기)
await availability() // 모델까지 준비됐는지 (비동기)
// → 'unavailable' | 'downloadable' | 'downloading' | 'available'
```

| 값               | 뜻                        | 할 일                                         |
| :--------------- | :------------------------ | :-------------------------------------------- |
| `'unavailable'`  | 이 기기에서는 못 씀       | 기능을 숨기거나 서버 경로로                   |
| `'downloadable'` | 쓸 수 있지만 아직 안 받음 | 첫 호출에서 받기 시작. **진행률을 보여줄 것** |
| `'downloading'`  | 지금 받는 중              | 기다리게 하고 진행률 표시                     |
| `'available'`    | 바로 사용 가능            | 그냥 쓰면 됨                                  |

```ts
if ((await availability()) === 'downloadable') {
  // 첫 호출에서 약 4GB를 내려받는다. 진행률을 꼭 보여주자.
  new Agent({ onDownloadProgress: (p) => setProgress(Math.round(p * 100)) })
}
```

### Agent — AI 모델 한 명

역할 하나에 세션 하나입니다. 세션은 **첫 호출 때** 만들어지므로, 인스턴스를 미리 여러 개 만들어 둬도 부담이 없습니다.

```ts
const writer = new Agent({
  name: 'writer',
  instruction: '제품 광고 문구를 쓰는 카피라이터.',
})

await writer.send('여름 세일 배너 문구 세 개만')
```

#### option

전부 선택입니다. `new Agent()`만 해도 동작합니다.

| 옵션                                 | 기본값        | 언제 쓰나                                                                          |
| :----------------------------------- | :------------ | :--------------------------------------------------------------------------------- |
| `instruction`                        | 없음          | **이 에이전트의 역할.** 시스템 프롬프트로 들어갑니다. 거의 항상 씁니다             |
| `tools`                              | `[]`          | 모델에게 쥐여줄 함수들. 하나라도 있으면 툴 호출 루프로 동작합니다                  |
| `stateless`                          | `false`       | **`true`면 호출마다 백지에서 시작.** `chain`·`parallel`에 넣을 에이전트는 켜세요   |
| `name`                               | `'agent'`     | 로그와 `parallel` 결과 라벨에 쓰입니다. 여럿을 엮을 때 붙이세요                    |
| `today`                              | `false`       | 오늘 날짜를 시스템 프롬프트에 한 줄 넣습니다. 날짜·기간을 다루는 에이전트면 켜세요 |
| `maxSteps`                           | `5`           | 툴 루프 반복 상한. 도구를 여러 번 거쳐야 하는 작업이면 올리세요                    |
| `maxToolResultChars`                 | `4000`        | 도구 결과를 이 길이에서 자릅니다. 큰 JSON을 돌려주는 도구가 있으면 줄이세요        |
| `history`                            | `[]`          | 이전 대화를 넣어 복원합니다. 새로고침 후 이어가기에 씁니다                         |
| `temperature` / `topK`               | Chrome 기본값 | 0에 가까울수록 결정적. **둘 다 주거나 둘 다 안 주거나**만 됩니다                   |
| `onEvent`                            | 없음          | 툴 호출·결과·오류·컨텍스트 초과를 흘려보냅니다. 로그 UI에 연결하세요               |
| `onDownloadProgress`                 | 없음          | 모델 다운로드 진행률 `0~1`                                                         |
| `signal`                             | 없음          | `AbortSignal`. 이 에이전트의 실행 전체를 취소합니다                                |
| `expectedInputs` / `expectedOutputs` | 텍스트        | 멀티모달을 쓸 때 선언합니다. 예: `[{ type: 'image' }]`                             |

```ts
// 챗봇 — 대화를 이어가야 하니 stateless를 끕니다(기본값)
const bot = new Agent({ instruction: '친절한 상담원.' })

// 워크플로우 단계 — 매번 백지에서 시작해야 하니 켭니다
const step = new Agent({ instruction: '핵심만 세 문장으로.', stateless: true })

// 도구를 쓰는 에이전트 — 여러 번 거쳐야 하면 maxSteps를 올립니다
const researcher = new Agent({
  instruction: '도구로 사실을 확인한 뒤 답한다.',
  tools: [searchTool, dbTool],
  maxSteps: 8,
  maxToolResultChars: 1500, // 결과가 크면 창을 아끼려고 줄입니다
  onEvent: (e) => console.log(e.type, e),
})
```

> **`today: true`를 켜면 오늘 날짜가 들어갑니다.**
> 온디바이스 모델은 학습 시점이 고정돼 있고 시계가 없습니다. 날짜를 물으면 확신에 찬 오답을 냅니다.
> 켜면 시스템 프롬프트 맨 앞에 `Today's date: 2026-08-25 (Tuesday).` 한 줄이 붙습니다. 20토큰 남짓입니다.

#### method

|                              | 돌려주는 것                 | 언제 쓰나                                                                     |
| :--------------------------- | :-------------------------- | :---------------------------------------------------------------------------- |
| `send(input)`                | `Promise<string>`           | **기본.** 최종 답변 하나. 도구가 있으면 루프를 끝까지 돌린 뒤 답합니다        |
| `stream(input)`              | `AsyncGenerator<string>`    | 타이핑 효과. 글자 조각이 순서대로 나옵니다                                    |
| `generate<T>(input, schema)` | `Promise<T>`                | **JSON을 받고 싶을 때.** 스키마로 출력을 강제하고 파싱까지 해서 객체로 줍니다 |
| `run(input)`                 | `Promise<string>`           | `send()`의 별칭. `Runnable` 규약을 맞추려고 있습니다                          |
| `fork(name?)`                | `Promise<Agent>`            | 지금 대화를 복제한 새 에이전트. 같은 맥락에서 갈라져 실험할 때                |
| `ready()`                    | `Promise<Session>`          | 세션을 미리 만들어 둡니다. 첫 응답 지연을 앞당길 때                           |
| `history`                    | `PromptMessage[]`           | 지금까지의 대화. JSON으로 저장했다가 `history` 옵션으로 복원합니다            |
| `usage`                      | `{ used, total }` \| `null` | 컨텍스트 토큰 사용량. 세션이 없으면 `null`                                    |
| `stateless`                  | `boolean` \| `undefined`    | 설정값. **지정 안 했으면 `undefined`** (`false`가 아닙니다)                   |
| `reset()`                    | —                           | 세션과 대화 기록을 모두 버립니다                                              |
| `destroy()`                  | —                           | 세션만 반납합니다. **다 쓴 에이전트는 꼭 호출하세요**                         |

```ts
// send — 가장 흔한 사용
const answer = await agent.send('여름 세일 문구 써줘')

// stream — 한 글자씩 화면에 흘리기
for await (const chunk of agent.stream('길게 설명해줘')) {
  setText((prev) => prev + chunk)
}

// generate — 파싱 걱정 없이 객체로
const parsed = await agent.generate<{ title: string; tags: string[] }>(article, {
  type: 'object',
  properties: {
    title: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'tags'],
})

// 저장하고 복원하기
localStorage.setItem('chat', JSON.stringify(agent.history))
const restored = new Agent({ instruction, history: JSON.parse(saved).slice(-10) })

agent.usage // { used: 812, total: 4096 }
agent.destroy()
```

#### 내장 Agent

Chrome은 한 가지 일만 하는 전용 모델을 따로 줍니다. 직접 만든 에이전트와 **똑같이 쓰도록** 감싸 뒀습니다. 지시문을 쓸 필요가 없는, 이미 완성된 에이전트라고 보면 됩니다.

```ts
import {
  languageDetector,
  proofreader,
  rewriter,
  summarizer,
  translator,
  writer,
} from 'my-little-agent'

await translator({ to: 'ko' }).run('Hello') // → '안녕하세요' (출발어 자동 감지)
await summarizer({ type: 'tldr', length: 'short' }).run(longText)
await languageDetector().run('Bonjour') // → 'fr'
await writer({ tone: 'formal' }).run('환불 요청 메일')
await rewriter({ tone: 'more-casual', length: 'shorter' }).run(draft)
await proofreader().run('I seen him') // → 'I saw him'
```

| 내장 Agent           | 하는 일                                | 옵션                                           |
| :------------------- | :------------------------------------- | :--------------------------------------------- |
| `translator()`       | 번역                                   | `to` (필수) · `from` (생략하면 자동 감지)      |
| `summarizer()`       | 요약                                   | `type` · `length` · `format` · `sharedContext` |
| `languageDetector()` | 무슨 언어인지 판별. 언어 코드를 돌려줌 | —                                              |
| `writer()`           | 지시대로 새 글 작성                    | `tone` · `length` · `format` · `context`       |
| `rewriter()`         | 기존 글의 어조·길이 변경               | `tone` · `length` · `format` · `context`       |
| `proofreader()`      | 문법·가독성 교정                       | `expectedInputLanguages`                       |

전부 `fallback`(못 쓸 때 대신 돌릴 Agent)과 `signal`을 받습니다. 앞의 셋은 Chrome 138부터 정식이고, 뒤의 셋은 아직 오리진 트라이얼이라 대부분의 환경에서 `fallback`을 탑니다.

**이게 가장 큰 절약입니다.** 전용 모델은 별도로 돌기 때문에 다른 에이전트의 컨텍스트 창을 **1토큰도 쓰지 않습니다.** 창이 수천 토큰뿐인 환경에서, 모델에게 안 시키고 끝낼 수 있는 일을 골라내는 것이 가장 크게 남습니다.

```ts
// Agent와 나란히 섞입니다
chain(analyst, summarizer(), translator({ to: 'ko' }))

// 못 쓰는 환경이면 이 에이전트가 대신 번역합니다
translator({
  to: 'ko',
  fallback: new Agent({ instruction: '입력을 한국어로만 번역해 출력해라.' }),
})
```

`proofreader`만 결과가 문자열이 아니라 객체라서 둘로 나뉩니다.

```ts
const fix = proofreader()
await fix.run('I seen him') // → 'I saw him'                      (조립용)
await fix.proofread('I seen him') // → { correctedInput, corrections } (밑줄 그을 때)
```

> **Tool과 헷갈리지 마세요.**
> Tool은 **모델이** 판단해서 부르는 함수라 `tools: [...]`에 넣습니다. 이쪽은 Agent라서 `chain(...)`에 넣습니다.
> 대화를 이어가는 에이전트는 아닙니다. `send()`·`history`·`tools`는 없고 `run()`만 있습니다.

### Tool — 모델이 부르는 커스텀 함수

```ts
const weather = tool<{ city: string }>({
  name: 'weather',
  description: '도시의 현재 기온을 조회한다', // 모델은 이 한 줄만 보고 고른다
  parameters: { type: 'object', properties: { city: { type: 'string' } } },
  execute: async ({ city }) => fetch(`/api/weather?city=${city}`).then((r) => r.json()),
})

new Agent({ instruction: '날씨 비서', tools: [weather] })
```

**모델이 스스로 판단해서 부릅니다.** 언제 부를지는 `description` 한 줄로 정해지니 구체적으로 쓰세요.

도구가 예외를 던져도 루프는 죽지 않습니다. 오류 내용이 모델에게 전달돼서 다른 방법을 시도합니다.

#### 내장 Tool

```ts
import { calculator, pageTools } from 'my-little-agent'

new Agent({
  instruction: '이 페이지를 보며 답하는 도우미.',
  tools: [calculator(), ...pageTools()],
})
```

| 내장 Tool                  | 하는 일                                   | 인자        |
| :------------------------- | :---------------------------------------- | :---------- |
| `calculator()`             | 정확한 계산                               | 수식 문자열 |
| `pageTools()` → `pageInfo` | 페이지 제목, 주소, 사용자가 선택한 텍스트 | 없음        |
| `pageTools()` → `readPage` | 페이지 본문 텍스트                        | 없음        |

**`calculator()`** — 소형 모델이 확실히 못하는 일이 정확한 계산입니다. 그 칸을 도구로 메웁니다. 사칙연산·나머지(`%`)·괄호·소수를 지원하고, 자릿수 쉼표(`1,200`)도 받아줍니다. 백분율은 `0.15`처럼 소수로 씁니다.

**`pageTools()`** — 지금 열려 있는 페이지를 읽습니다. 도구 두 개가 나옵니다.

**서버 LLM이 구조적으로 못 하는 일입니다.** 사용자 화면 안에 있는 것은 브라우저 안에서 도는 모델만 볼 수 있습니다.

```ts
pageTools({
  root: () => document.querySelector('article'), // 읽을 범위. 기본은 body
  maxChars: 2000, // 절단 기준
  includeQuery: false, // 주소의 쿼리 문자열 포함 여부. 기본 false
})
```

주소는 기본적으로 **쿼리 문자열을 뺍니다.** 세션 토큰이 실리는 경우가 흔한데, 모델이 로컬에서 돌더라도 대화 기록은 저장될 수 있기 때문입니다.

> **웹 검색은 넣지 않았습니다.**
> 브라우저에 검색 기능이 없어 제3자 API를 써야 하는데, 그 순간 API 키·프록시 서버·과금·외부 전송이 전부 따라옵니다. 이 라이브러리의 전제가 통째로 무너집니다. 필요하면 `tool()`로 직접 만드세요. 열 줄이면 됩니다.

### Workflow — 부품을 이어 붙이기

|                                  | 하는 일                         | 쓰는 곳                |
| :------------------------------- | :------------------------------ | :--------------------- |
| `chain(...steps)`                | 순서대로, 앞 결과가 뒤 입력     | 초안 → 교정 → 번역     |
| `parallel(steps, opts?)`         | 같은 입력을 동시에 돌리고 합침  | 여러 관점 동시 분석    |
| `router({ classifier, routes })` | 분류한 뒤 한 경로만 실행        | 문의 유형별 분기       |
| `refine({ worker, evaluator })`  | 기준 점수에 닿을 때까지 다시 씀 | 품질이 중요한 결과물   |
| `step(fn)`                       | 모델 없이 도는 순수 함수        | 전처리, 후처리, 마스킹 |

```ts
// 전화번호를 지우고, 세 관점으로 나눠 분석하고, 하나로 합친다.
const flow = chain(
  step((s) => s.replace(/\d{3}-\d{4}-\d{4}/g, '[전화번호]')),
  parallel([pros, cons, risks]),
  summarizer(),
)
```

결과도 부품이라 다시 조립할 수 있습니다.

```ts
chain(parallel([a, b, c]), router({ ... }), refine({ ... }))
```

직접 합치려면 `reduce`를 넘기세요.

```ts
parallel([a, b], { reduce: (results) => results.join('\n---\n') })
```

> **조립할 Agent는 `stateless: true`를 켜세요.**
> 안 켜면 흐름을 두 번째 실행할 때 첫 번째 대화가 창에 그대로 남아 결과가 조용히 달라집니다. 에러도 안 나서 가장 찾기 어려운 실수라, 조합기가 콘솔로 경고해 줍니다.
> 일부러 대화를 이어갈 의도라면 `stateless: false`를 명시하면 경고가 사라집니다.

### Memory — 브라우저에 저장

세션은 새로고침하면 사라지고, 창은 좁습니다. 그래서 기억은 모델 밖에 둡니다.

```ts
const shared = localMemory('support-desk')
const tools = memoryTools(shared) // remember / recall / listMemories

new Agent({ instruction: '알아낸 사실은 remember로 저장한다.', tools })
```

**같은 저장소를 여러 에이전트에게 넘기면 그게 곧 공유 작업판입니다.** 자세한 내용은 아래에서 이어집니다.

## 컨텍스트와 기억

### 에이전트끼리는 컨텍스트를 공유하지 않습니다

에이전트는 각자 자기 세션, 자기 창을 씁니다. 서로에게 넘어가는 건 `run()`이 돌려준 문자열 하나뿐입니다.

```
   [분류기]         [분석가]         [요약가]
    자기 창          자기 창          자기 창
       └── 문자열 ──→   └── 문자열 ──→
```

제약처럼 보이지만 노린 겁니다. 창이 좁을수록 공유는 독이 됩니다. 한 에이전트가 만든 잡음을 나머지가 다 같이 짊어지니까요. 따로 두면 에이전트 N개가 **독립된 창 N개**가 되고, 시스템 전체가 다루는 정보량은 오히려 늘어납니다.

### 창이 넘치는 지점은 네 곳입니다

| 상황                                    | 무슨 일이 생기나                    | 대응                                          |
| :-------------------------------------- | :---------------------------------- | :-------------------------------------------- |
| 같은 에이전트로 조립한 흐름을 반복 실행 | 지난 실행의 대화가 창에 그대로 남음 | `stateless: true` (안 켜면 경고)              |
| 도구가 큰 JSON을 돌려줌                 | 결과 하나가 대화를 통째로 밀어냄    | `maxToolResultChars` (기본 4000자)            |
| 입력 문서 자체가 김                     | 오래된 부분이 소리 없이 잘려나감    | `step()`으로 쪼개 `parallel` 처리             |
| 번역·요약을 모델에게 시킴               | 안 써도 될 창을 씀                  | `translator()` · `summarizer()` (창 사용량 0) |

```ts
agent.usage // { used: 812, total: 4096 }
new Agent({ onEvent: (e) => e.type === 'context-overflow' && warn() })
```

### 세션은 새로고침하면 사라집니다

Chrome이 디스크에 들고 있는 건 **모델 가중치뿐**입니다. 대화 기록은 메모리에만 있어서 탭을 닫으면 없어집니다. 저장은 우리 몫이고, `agent.history`가 그 창구입니다.

```ts
localStorage.setItem('chat', JSON.stringify(agent.history))

// 복원은 최근 몇 턴만. 전부 밀어 넣으면 창이 다시 꽉 찬다.
const saved = JSON.parse(localStorage.getItem('chat') ?? '[]')
const agent = new Agent({ instruction: '...', history: saved.slice(-10) })
```

> 저장은 **지속성** 문제를 풀지, **용량** 문제를 풀지 않습니다. 저장소가 아무리 커도 창에 넣을 수 있는 양은 그대로입니다.

### 그래서 기억은 모델 밖에 둡니다

> **컨텍스트 창은 작업대, 브라우저 저장소는 창고입니다.**
> 창고를 통째로 작업대에 올리지 않습니다. 필요한 것만 그때그때 꺼내 옵니다.

```ts
import { Agent, chain, localMemory, memoryTools } from 'my-little-agent'

const shared = localMemory('support-desk')
const tools = memoryTools(shared)

const researcher = new Agent({
  instruction: '자료를 찾아 알아낸 사실은 remember로 저장한다.',
  tools: [...tools, searchTool],
  stateless: true,
})

const writer = new Agent({
  instruction: 'recall로 필요한 사실을 꺼낸 뒤 답변을 작성한다.',
  tools,
  stateless: true,
})

await chain(researcher, writer).run('경쟁사 가격 정책 정리해줘')
```

두 에이전트의 창은 끝까지 남남입니다. 오가는 건 창고에 남은 짧은 항목들뿐이라, 협업이 길어져도 창이 터지지 않습니다. 새로고침해도 창고는 그대로 남고요.

창고는 메서드 네 개만 구현하면 갈아끼울 수 있습니다.

```ts
interface MemoryStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}
```

`localMemory()`는 localStorage(약 5 MB)를 씁니다. 더 큰 저장이 필요하면 IndexedDB나 자체 API로 같은 인터페이스를 구현하세요.

## 활용 예시

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

`generate()`는 디코딩 자체를 묶어버립니다. 모델이 설명을 덧붙이거나 형식을 어길 수가 없어서, 결과를 바로 `setState`에 넣어도 됩니다.

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

### 다국어 리뷰를 한국어로 모아 보기

```ts
// 전부 Chrome 전용 모델이라 컨텍스트 창을 쓰지 않는다
const digest = chain(summarizer({ length: 'short' }), translator({ to: 'ko' }))

const summaries = await Promise.all(reviews.map((r) => digest.run(r)))
```

### 페이지 기능을 도구로 노출

```ts
const assistant = new Agent({
  instruction: '쇼핑몰 비서. 필요하면 도구를 쓴다.',
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
  classifier: new Agent({ name: 'classifier', stateless: true }),
  routes: { refund: refundAgent, tech: techAgent, sales: salesAgent },
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
  worker: new Agent({
    instruction: '제품 광고 문구를 쓰는 카피라이터.',
    stateless: true,
  }),
  evaluator: new Agent({ instruction: '문구를 깐깐하게 보는 편집장.', stateless: true }),
  minScore: 85,
  maxRounds: 3,
})
```

### React

별도 어댑터가 필요 없습니다.

```tsx
function useAgent(instruction: string) {
  const ref = useRef<Agent>()
  if (!ref.current) ref.current = new Agent({ instruction }) // 세션은 지연 생성이라 만들어만 두면 공짜다
  useEffect(() => () => ref.current?.destroy(), [])
  return ref.current
}

export function Summary({ text }: { text: string }) {
  const agent = useAgent('핵심만 세 문장으로 줄인다.')
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
  instruction: '사진에 보이는 것을 설명한다.',
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

---

개발·설계 규칙·로드맵은 [AGENTS.md](https://github.com/Hayoung0708/my-little-agent/blob/main/AGENTS.md)에 있습니다. 라이선스는 [MIT](https://github.com/Hayoung0708/my-little-agent/blob/main/LICENSE)입니다.
