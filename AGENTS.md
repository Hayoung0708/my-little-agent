# AGENTS.md

이 저장소에서 작업하는 사람과 코딩 에이전트를 위한 문서입니다.
사용법은 [README](https://github.com/Hayoung0708/my-little-agent/blob/main/README.md)에 있고, 여기에는 개발·설계·계획만 둡니다.

## 이 라이브러리가 무엇인가

Chrome 내장 AI(Prompt API) 위에 얹는 얇은 층입니다. 핵심 규칙은 하나뿐입니다.

```ts
interface Runnable {
  name: string
  run(input: string): Promise<string>
}
```

`Agent`, `chain`, `parallel`, `router`, `refine`, `translator` 같은 Task 모델까지 전부 이 모양을 만족합니다. 그래서 어댑터 없이 서로 끼워집니다. **새 기능을 추가할 때 이 모양을 깨지 마세요.**

## 소스 구조

| 파일              | 역할                                                           |
| :---------------- | :------------------------------------------------------------- |
| `src/agent.ts`    | `Agent` 클래스. 세션 수명, 툴 루프, 대화 기록, 오늘 날짜 주입  |
| `src/tool.ts`     | `tool()` 헬퍼, 툴 루프용 스키마·설명서·JSON 파서               |
| `src/builtin.ts`  | 내장 툴 — `calculator()`, `pageTools()`                        |
| `src/task.ts`     | Chrome Task 모델 6종 래퍼. 공통 뼈대 `lazyTask()`              |
| `src/workflow.ts` | `chain` `parallel` `router` `refine` `step` + `stateless` 경고 |
| `src/memory.ts`   | `localMemory()`, `memoryTools()`                               |
| `src/model.ts`    | `LanguageModel` 전역 접근, 세션 생성                           |
| `src/types.ts`    | Chrome 내장 AI 타입 선언 (lib.dom에 아직 없음)                 |

## 설계 규칙

### 1. 컨텍스트 창이 모든 판단의 기준

온디바이스 모델의 창은 수천 토큰뿐입니다. 기능을 넣을지 말지는 대개 여기서 갈립니다.

- 툴을 하나 추가하면 그 설명서가 **매 호출마다** 시스템 프롬프트에 실립니다. 트리 셰이킹이 안 되는 무게입니다.
- 현재 `calculator()` + `pageTools()`가 약 229토큰(창 4096 기준 5.6%)입니다.
- **10%를 넘기면 재검토하세요.**

새 내장 툴을 넣을 때 스스로 물어볼 것: _이 툴이 매번 내는 설명서 값만큼 실제로 벌어주는가?_

### 2. 내장 툴의 채택 기준

세 가지를 모두 만족할 때만 넣습니다.

1. **브라우저 안에서 완결된다** — 서버도 API 키도 필요 없다
2. **모델이 못 하는 일이다** — 모델이 이미 잘하면 왕복만 낭비다
3. **결과가 검증 가능하다**

웹 검색이 1번에서 걸러집니다. 브라우저에 검색 기능이 없어 제3자 API를 써야 하고, 그러면 API 키·프록시 서버·과금·외부 전송이 전부 따라옵니다. 이 라이브러리의 전제가 통째로 무너집니다.

### 3. 조용한 실패를 만들지 않는다

가장 찾기 어려운 버그는 에러가 안 나는 버그입니다. 이미 대응한 것들:

- `stateless`를 안 켠 Agent가 조합기에 들어오면 콘솔 경고
- Task 모델을 못 쓰면 원문을 흘리지 않고 `fallback`으로 보내거나 던짐
- 언어 감지 실패 시 빈 문자열 대신 에러
- `today` 옵션 — 모델이 연도를 확신에 차서 틀리는 문제. 기본은 꺼져 있고 필요한 에이전트만 켬

### 4. `eval` 금지

모델 출력에는 사용자 입력이 섞여 들어옵니다. 그대로 실행하면 임의 코드 실행 구멍이고, CSP를 켠 사이트에서는 `eval` 자체가 막혀 라이브러리가 통째로 깨집니다. `calculator()`가 파서를 직접 쓰는 이유입니다.

## 개발

**이 저장소는 pnpm 전용입니다.** `npm install`과 `yarn install`은 `only-allow` 훅에서 막히고, `packageManager` 필드가 pnpm 버전을 고정합니다.

```bash
corepack enable   # package.json에 고정된 pnpm이 설치된다
pnpm install

pnpm test         # 유닛 + 파서 테스트, 가짜 전역을 주입해 검증
pnpm test:all     # 유닛 + 타입 + 패키징
pnpm typecheck
pnpm lint         # eslint (@tanstack/eslint-config)
pnpm format       # prettier
pnpm size         # 시나리오별 번들 크기
pnpm build        # vite (@tanstack/vite-config) + publint --strict
pnpm example      # Chrome에서 실제 동작 확인
```

### 테스트 층

네 층입니다. 각자 다른 층이 못 잡는 걸 잡습니다.

| 명령                | 잡는 것                                                                                                                                                                                           |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`         | Agent, 툴 루프, 조립, 창고, Task 모델, 내장 툴. 가짜 전역을 쓰므로 Chrome 없이 돕니다. 파서 퍼징도 포함 — 모델 출력은 우리가 통제할 수 없는 유일한 입력입니다.                                    |
| `pnpm test:types`   | 소비자가 기대는 제네릭 추론 (`tool<T>`, `generate<T>`, `Runnable`). 런타임은 멀쩡한데 타입만 깨지는 회귀를 잡습니다.                                                                              |
| `pnpm test:package` | pack → npm 설치 → 실행 → `bundler`/`node16` 양쪽 타입 해석. 설치 라이프사이클 스크립트가 딸려 나가지 않는지도 확인합니다. 실제로 배포 직전에 터졌던 문제입니다.                                   |
| `pnpm test:e2e`     | Playwright로 **진짜** Chrome에서 검증. 가짜 모델은 시킨 대로만 답하니, Gemini Nano가 JSON Schema 제약을 지키고 툴 루프가 수렴하는지는 이 층에서만 확인됩니다. 내장 AI가 없으면 스스로 skip합니다. |

`test:e2e`는 시스템에 설치된 Chrome(`channel: 'chrome'`)을 쓰므로 브라우저를 따로 내려받지 않습니다.

### 도구

| 도구                                           | 역할                                                                 |
| :--------------------------------------------- | :------------------------------------------------------------------- |
| [TanStack Config](https://tanstack.com/config) | Vite 빌드와 ESLint 프리셋                                            |
| Prettier                                       | 포매팅. lint-staged가 실행                                           |
| Husky                                          | Git 훅 (`pre-commit`, `commit-msg`)                                  |
| lint-staged                                    | 스테이징된 파일만 eslint·prettier 실행                               |
| commitlint                                     | [Conventional Commits](https://www.conventionalcommits.org/ko/) 강제 |

커밋 메시지는 Conventional Commits를 따릅니다. `feat: 공유 메모리 추가`는 통과하고 `수정함`은 거부됩니다.

### README를 고칠 때

- 한국어가 원본(`README.md`), 영어(`README-en_us.md`)가 번역본입니다. **양쪽을 같이 고치세요.**
- 언어 토글 링크는 **절대 URL**이어야 합니다. 상대 경로는 npm 페이지에서 404가 납니다.
- 목차 앵커가 실제 제목과 맞는지 확인하세요.
- 리치 텍스트 편집기로 열지 마세요. `<T>` 같은 제네릭을 HTML 태그로 오인해 토큰으로 치환하고, `<p align="center">` 안에 빈 줄을 넣어 가운데 정렬을 깨뜨린 적이 있습니다.

## 로드맵

- [x] 대화 기록 영속화 (`agent.history`)와 공유 창고 (`localMemory`)
- [x] 컨텍스트 가드 (`stateless`, 도구 결과 절단, 조립 시 경고)
- [x] Chrome Task 모델 6종 (`translator` 외)
- [x] 내장 툴 (`calculator`, `pageTools`)과 `today` 옵션
- [ ] `maxToolResultChars` 기본값 재조정 — 4000자는 영어 기준이라 한국어에서는 창의 3분의 1을 넘김
- [ ] `send(input, { signal })` — 지금은 생성자에서만 취소 신호를 받아 한 턴만 취소하려면 Agent를 새로 만들어야 함
- [ ] 컨텍스트 초과 전 자동 요약 압축 — 창고와 `summarizer()`를 자동 연결
- [ ] 에이전트 간 위임 · 인계
- [ ] 도구 실행 전 사용자 승인 — DOM을 바꾸는 도구에는 사실상 필수
- [ ] `measureContextUsage()` 활용 — 보내기 전에 창을 넘길지 확인
- [ ] IndexedDB `MemoryStore` 기본 제공
- [ ] Web Worker 오프로드

## 알려진 약점

- **`argsJson`이 문자열입니다.** 툴 루프의 출력 스키마가 인자를 JSON 문자열로 받습니다. 소형 모델에게 이스케이프를 이중으로 시키는 셈이라 실패율이 있습니다. 도구를 먼저 고르고, 그 도구의 스키마로 인자를 두 번째 호출에서 받는 2단계 방식이 대안입니다. 호출이 한 번 늘어납니다.
- **도구가 있으면 `stream()`이 스트리밍이 아닙니다.** 루프가 끝나야 답이 확정되므로 최종 답변을 한 덩어리로 흘립니다. 진행 상황은 `onEvent`로 관찰하세요.
- **`agent.history`가 툴 루프 중간 과정을 담지 않습니다.** 루프의 발판 텍스트는 세션에만 쌓이고 기록에는 원래 입력과 최종 답만 남습니다. 복원하면 원본과 다른 맥락이 됩니다.
- **Chrome 네이티브 `tools`.** MDN과 명세에는 `LanguageModel.create({ tools })`가 문서화되어 있지만 browser-compat-data에는 없고 Chrome 공식 문서에도 언급이 없습니다. 정식 출시되면 `#runToolLoop`은 폴리필이 되고, 조립·창 관리·기록은 그대로 남습니다. 확인 방법:

  ```js
  let read = false
  const s = await LanguageModel.create({
    get tools() {
      read = true
      return []
    },
  })
  s.destroy()
  console.log('native tools:', read)
  ```
