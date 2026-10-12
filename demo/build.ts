/**
 * 데모를 한 파일로 묶는다.
 *
 * **진짜 앱 코드를 그대로 쓴다.** `src/` 의 도메인·응용·통신 규약은
 * 순수 TypeScript 라 React Native 없이도 돈다. esbuild 가 그걸 묶어
 * 브라우저가 읽을 수 있는 한 파일로 만든다.
 *
 * ```bash
 * pnpm demo          묶고 서버를 띄운다
 * pnpm demo:build    묶기만 한다
 * pnpm demo:publish <폴더>   공개용으로 묶어 그 폴더에 내보낸다
 * ```
 */

import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 탭에 뜨는 그림을 앱 아이콘과 같게 맞춘다.
 *
 * 베껴 두는 이유는 데모가 `demo/` 만 내보내는 서버로 뜨기 때문이다.
 * 바깥 폴더는 브라우저가 못 가져간다. **원본은 하나뿐이고** 여기서
 * 베낀 것은 무시 목록에 있다.
 */
function copyIcon(): void {
  copyFileSync(
    resolve(root, 'assets/icon/icon.svg'),
    resolve(root, 'demo/favicon.svg'),
  )
}

/**
 * `.env` 를 읽는다.
 *
 * 핫스팟 이름과 비밀번호는 저장소가 공개라 코드에 적지 않는다.
 * 앱은 Expo 가 알아서 읽어주지만 여기는 esbuild 라 직접 읽는다.
 *
 * **없어도 된다.** 값이 비면 이름을 알려주는 안내만 빠지고
 * 나머지는 그대로 돈다. (`src/composition/hotspot.ts` 참고)
 */
function readEnv(): Record<string, string> {
  let raw: string
  try {
    raw = readFileSync(resolve(root, '.env'), 'utf8')
  } catch {
    return {}
  }

  const values: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue

    const at = trimmed.indexOf('=')
    if (at <= 0) continue

    const key = trimmed.slice(0, at).trim()
    const value = trimmed.slice(at + 1).trim()
    values[key] = value.replace(/^["']|["']$/g, '')
  }
  return values
}

/**
 * 공개용으로 내보낼 곳. `--publish <폴더>` 로 받는다.
 *
 * dev.byb.kr 같은 공개 사이트에 올릴 때 쓴다.
 */
function publishTarget(): string | null {
  const at = process.argv.indexOf('--publish')
  if (at < 0) return null
  const target = process.argv[at + 1]
  if (target === undefined) {
    console.error('--publish 뒤에 내보낼 폴더를 적어주세요')
    process.exit(1)
  }
  return resolve(target)
}

/**
 * 공개용 페이지를 만든다.
 *
 * 묶은 결과물이라 거기서 고치면 다음에 덮어써진다. 그래서 맨 위에 적어두고,
 * 돌아갈 곳(허브) 링크를 단다.
 */
function publishPage(target: string): void {
  const html = readFileSync(resolve(root, 'demo/index.html'), 'utf8')
    .replace(
      '<!doctype html>',
      '<!doctype html>\n<!-- 이 폴더는 sky-talk 저장소 demo/ 에서 `pnpm demo:publish` 로 묶은 결과물입니다. 여기서 직접 고치지 말고 소스를 고쳐 다시 묶으세요. -->',
    )
    .replace(
      '<h1>',
      '<a class="back" href="../">← dev.byb.kr</a>\n<h1>',
    )
    .replace(
      '</style>',
      '.back { align-self: flex-start; color: var(--muted); font-size: 13px; text-decoration: none; }\n.back:hover { color: var(--text); }\n</style>',
    )
  writeFileSync(resolve(target, 'index.html'), html)
  copyFileSync(resolve(root, 'demo/favicon.svg'), resolve(target, 'favicon.svg'))
}

async function run(): Promise<void> {
  copyIcon()
  const target = publishTarget()

  // **공개용에는 .env 를 읽지 않는다.** 핫스팟 비밀번호가 묶음에 박혀
  // 그대로 공개된다. 비어도 데모는 그대로 돈다.
  const env = target === null ? readEnv() : {}

  /**
   * `process.env` 는 브라우저에 없다.
   *
   * 앱에서는 빌드할 때 값이 박히는데(EXPO_PUBLIC_), 여기서도 같게
   * 해준다. 안 하면 화면을 그리다 통째로 터진다.
   */
  const define: Record<string, string> = {
    'process.env.NODE_ENV': '"production"',
  }
  for (const key of ['EXPO_PUBLIC_HOTSPOT_SSID', 'EXPO_PUBLIC_HOTSPOT_PASSWORD']) {
    define[`process.env.${key}`] = JSON.stringify(env[key] ?? '')
  }

  const result = await build({
    entryPoints: [resolve(root, 'demo/src/main.ts')],
    outfile: target === null ? resolve(root, 'demo/app.js') : resolve(target, 'app.js'),
    minify: target !== null,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    alias: { '@': resolve(root, 'src') },
    define,
    logLevel: 'info',
  })

  if (result.errors.length > 0) process.exit(1)

  if (target !== null) {
    mkdirSync(target, { recursive: true })
    publishPage(target)
  }
}

void run()
