/**
 * 패키징 테스트.
 *
 * 유닛 테스트는 소스를 검증하지, 배포되는 물건을 검증하지 않는다.
 * 실제로 0.1.0 배포 직전에 preinstall 훅이 소비자 설치까지 따라가는 문제를
 * 여기서 잡았다. 그 회귀를 포함해 "설치했을 때 실제로 되는가"만 본다.
 *
 * 절차: 빌드 → pack → tarball 내용 검사 → npm으로 설치 → 실행 → 타입 해석
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve('.')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', shell: true, stdio: 'pipe' })

const ok = (message) => console.log(`✓ ${message}`)
const dir = mkdtempSync(join(tmpdir(), 'mla-pkg-'))
let tarball

try {
  // ---------------------------------------------------------------- 1. 빌드
  run('vite', ['build'], root)
  run('publint', ['--strict'], root)
  ok('빌드와 publint 통과')

  // ---------------------------------------------------- 2. 소비자 설치 훅 검사
  // preinstall/install/postinstall은 의존성으로 설치될 때도 실행된다.
  // 저장소용 도구(only-allow 같은)가 여기 들어가면 남의 설치를 망가뜨린다.
  for (const hook of ['preinstall', 'install', 'postinstall']) {
    assert.equal(
      manifest.scripts?.[hook],
      undefined,
      `${hook} 스크립트는 소비자 설치에서도 실행된다. 저장소 전용 명령을 넣지 마라.`,
    )
  }
  ok('소비자 설치에서 실행될 라이프사이클 스크립트 없음')

  // ------------------------------------------------------------------ 3. pack
  // prepare 훅이 pnpm을 강제하므로 pack 단계에서는 스크립트를 돌리지 않는다.
  const packed = run('npm', ['pack', '--ignore-scripts', '--json'], root)
  const [packInfo] = JSON.parse(packed.slice(packed.indexOf('[')))
  tarball = join(root, packInfo.filename)

  const names = packInfo.files.map((f) => f.path)
  for (const required of [
    'package.json',
    'LICENSE',
    'README.md',
    'dist/esm/index.js',
    'dist/esm/index.d.ts',
  ]) {
    assert.ok(names.includes(required), `tarball에 ${required} 가 없다`)
  }
  ok(
    `tarball 내용 정상 (${names.length}개 파일, ${(packInfo.size / 1024).toFixed(1)} kB)`,
  )

  // ---------------------------------------------- 4. exports 경로가 실재하는지
  const entries = [manifest.module, manifest.types, manifest.exports['.'].default]
  for (const entry of entries) {
    assert.ok(existsSync(join(root, entry)), `package.json이 가리키는 ${entry} 가 없다`)
  }
  ok('package.json이 가리키는 진입점이 모두 존재')

  // -------------------------------------------------------------- 5. npm 설치
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'consumer', type: 'module' }),
  )
  const installLog = run('npm', ['install', '--foreground-scripts', tarball], dir)
  assert.ok(
    !/> \S+ (pre|post)?install/.test(installLog),
    `설치 중 라이프사이클 스크립트가 실행됐다:\n${installLog}`,
  )
  ok('npm 설치 성공, 스크립트 실행 없음')

  // ------------------------------------------------------------- 6. 실제 실행
  writeFileSync(
    join(dir, 'smoke.mjs'),
    `import assert from 'node:assert/strict'
import { Agent, availability, chain, isSupported, localMemory, memoryTools, parallel, tool } from 'my-little-agent'

// Prompt API가 없는 환경에서도 던지지 않아야 한다.
assert.equal(isSupported(), false)
assert.equal(await availability(), 'unavailable')

const replies = []
globalThis.LanguageModel = {
  availability: async () => 'available',
  create: async () => ({
    prompt: async () => {
      const next = replies.shift()
      if (next === undefined) throw new Error('가짜 응답 소진')
      return next
    },
    promptStreaming: async function* () { yield '조각' },
    append: async () => {},
    clone: async function () { return this },
    destroy() {},
    contextUsage: 1,
    contextWindow: 4096,
    addEventListener() {},
  }),
}

replies.push('안녕하세요')
const chat = new Agent({ instruction: '비서' })
assert.equal(await chat.send('안녕'), '안녕하세요')
assert.equal(chat.history.length, 2)

replies.push(
  JSON.stringify({ tool: 'now', argsJson: '{}', answer: '' }),
  JSON.stringify({ tool: 'final', argsJson: '{}', answer: '2026년' }),
)
const clock = tool({ name: 'now', description: '연도', execute: () => '2026' })
assert.equal(await new Agent({ tools: [clock] }).send('몇 년?'), '2026년')

replies.push('A', 'B', '합침')
const mk = (name) => new Agent({ name, stateless: true })
assert.equal(await chain(parallel([mk('a'), mk('b')]), mk('m')).run('입력'), '합침')

const [remember, recall] = memoryTools(localMemory('pkg-test'))
await remember.execute({ key: 'k', value: 'v' })
assert.equal(await recall.execute({ key: 'k' }), 'v')

console.log('  런타임 동작 확인 완료')
`,
  )
  console.log(run('node', ['smoke.mjs'], dir).trim())
  ok('설치본 런타임 동작')

  // ------------------------------------------------------------ 7. 타입 해석
  writeFileSync(
    join(dir, 'check.ts'),
    `import { Agent, chain, tool, type Runnable, type MemoryStore } from 'my-little-agent'
const t = tool<{ city: string }>({ name: 'w', description: 'w', execute: ({ city }) => city.length })
const a: Runnable = new Agent({ tools: [t], stateless: true })
export const run = async (): Promise<string> => chain(a).run('hi')
export type Store = MemoryStore
`,
  )
  for (const moduleResolution of ['bundler', 'node16']) {
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          module: moduleResolution === 'node16' ? 'node16' : 'esnext',
          moduleResolution,
          lib: ['ES2022', 'DOM'],
          skipLibCheck: true,
        },
        files: ['check.ts'],
      }),
    )
    run('node', [`"${tsc}"`, '-p', 'tsconfig.json'], dir)
    ok(`타입 해석 (moduleResolution: ${moduleResolution})`)
  }

  console.log('\n패키징 테스트 전부 통과')
} catch (error) {
  // execFileSync 실패는 stdout에 진짜 원인이 들어 있다.
  const detail = error.stdout || error.stderr
  console.error(`\n패키징 테스트 실패\n${detail ? String(detail).trim() : error.message}`)
  process.exitCode = 1
} finally {
  rmSync(dir, { recursive: true, force: true })
  if (tarball) rmSync(tarball, { force: true })
}
