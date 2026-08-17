/**
 * 번들 크기 측정 스크립트. README의 "little" 주장을 재현 가능하게 만든다.
 *
 * 세 가지 시나리오를 각각 esbuild로 번들 + minify 한 뒤 gzip/brotli 크기를 잰다.
 * - core:    Agent 하나만 import (트리 셰이킹이 실제로 먹는지 확인)
 * - typical: 에이전트 + 도구 + 워크플로 (현실적인 사용)
 * - all:     공개 API 전부
 */
import { build } from 'esbuild'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SRC = resolve('src/index.ts')

const scenarios = {
  core: `import { Agent } from ${JSON.stringify(SRC)}\nconsole.log(Agent)`,
  typical: `import { Agent, tool, chain, parallel, router, refine } from ${JSON.stringify(SRC)}\nconsole.log(Agent, tool, chain, parallel, router, refine)`,
  all: `export * from ${JSON.stringify(SRC)}`,
}

const dir = mkdtempSync(join(tmpdir(), 'mla-size-'))
const kb = (n) => `${(n / 1024).toFixed(2)} kB`

try {
  console.log(
    '시나리오'.padEnd(10),
    'minified'.padStart(10),
    'gzip'.padStart(10),
    'brotli'.padStart(10),
  )
  for (const [name, source] of Object.entries(scenarios)) {
    const entry = join(dir, `${name}.ts`)
    writeFileSync(entry, source)
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: 'esm',
      write: false,
      logLevel: 'error',
    })
    const bytes = Buffer.from(result.outputFiles[0].contents)
    console.log(
      name.padEnd(10),
      kb(bytes.length).padStart(10),
      kb(gzipSync(bytes).length).padStart(10),
      kb(brotliCompressSync(bytes).length).padStart(10),
    )
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
