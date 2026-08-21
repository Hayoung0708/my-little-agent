import { expect, test } from '@playwright/test'

/**
 * 유닛 테스트의 가짜 모델은 "우리가 시킨 대로" 답한다.
 * 그래서 진짜 Gemini Nano가 JSON Schema 제약을 지키는지, 툴 루프가 실제로
 * 수렴하는지는 전혀 검증되지 않는다. 그 구멍만 여기서 메운다.
 *
 * 실행: pnpm build && pnpm test:e2e
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/example/index.html')

  const status = page.locator('#status')
  await expect(status).not.toHaveText('확인 중…', { timeout: 30_000 })

  const state = (await status.textContent()) ?? ''
  test.skip(
    state.includes('unavailable'),
    '이 기기에서 Built-in AI를 쓸 수 없다. 여유 디스크가 10GB 밑이면 Chrome이 모델을 지운다. chrome://on-device-internals 확인 필요',
  )
})

test('모델 가용 상태를 읽어온다', async ({ page }) => {
  // availability()가 스펙에 정의된 네 값 중 하나를 돌려주는지 본다.
  // 우리가 손으로 선언한 타입이 실제 API와 어긋나면 여기서 먼저 깨진다.
  await expect(page.locator('#status')).toHaveText(
    /모델 상태: (available|downloadable|downloading)/,
  )
})

test('단일 에이전트가 스트리밍으로 답한다', async ({ page }) => {
  await page.click('#chat')

  const out = page.locator('#out')
  await expect(out).not.toBeEmpty()
  // 조각이 이어붙어 문장이 되는지. 한두 글자만 오면 스트리밍이 깨진 것이다.
  expect((await out.textContent())?.length ?? 0).toBeGreaterThan(10)
})

test('도구 호출 루프가 실제 모델에서 수렴한다', async ({ page }) => {
  await page.click('#tools')

  const out = page.locator('#out')
  // 예제 페이지는 onEvent를 그대로 찍는다. 도구가 실제로 불렸는지 확인한다.
  await expect(out).toContainText('tool-call')
  await expect(out).toContainText('tool-result')
  // 루프가 최종 답까지 갔는지. maxSteps 초과였다면 에러가 났을 것이다.
  await expect(out).toContainText('final')
})

test('병렬 + 요약 워크플로가 끝까지 돈다', async ({ page }) => {
  await page.click('#flow')

  const out = page.locator('#out')
  await expect(out).not.toBeEmpty()
  expect((await out.textContent())?.length ?? 0).toBeGreaterThan(20)
})
