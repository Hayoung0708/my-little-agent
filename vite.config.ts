import { defineConfig, mergeConfig } from 'vitest/config'
import { tanstackViteConfig } from '@tanstack/vite-config'

const config = defineConfig({
  test: {
    // 브라우저 API는 테스트에서 가짜 전역으로 주입하므로 node 환경이면 충분하다.
    environment: 'node',
    // e2e는 Playwright가 실제 Chrome에서 돌린다. vitest가 집어가면 안 된다.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
    typecheck: {
      include: ['tests/**/*.test-d.ts'],
    },
  },
})

export default mergeConfig(
  config,
  tanstackViteConfig({
    entry: './src/index.ts',
    srcDir: './src',
    // 브라우저 전용 라이브러리라 CJS 산출물은 만들지 않는다.
    cjs: false,
  }),
)
