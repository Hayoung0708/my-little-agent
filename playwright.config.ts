import { defineConfig } from '@playwright/test'

/**
 * 실제 Chrome에서 도는 e2e 설정.
 *
 * Playwright가 내려받는 Chromium에는 Gemini Nano가 없다. 그래서 번들 브라우저
 * 대신 시스템에 깔린 Chrome(channel: 'chrome')을 그대로 띄운다. 브라우저를
 * 따로 내려받지 않으므로 설치도 가볍다.
 *
 * 모델이 없는 기기에서는 각 테스트가 스스로 skip한다. CI에서 깨지지 않는다.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // 온디바이스 추론은 느리다. 첫 호출에 모델 로딩까지 겹칠 수 있다.
  timeout: 180_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    channel: 'chrome',
    headless: false, // Built-in AI는 헤드리스에서 꺼져 있는 경우가 있다
  },
  webServer: {
    // 프로젝트 루트를 서빙해야 example이 dist/를 그대로 import할 수 있다.
    command: 'vite --port 5174 --strictPort',
    url: 'http://localhost:5174/example/index.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
