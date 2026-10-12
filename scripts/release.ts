/**
 * 앱을 만들어 GitHub 릴리스에 올린다.
 *
 * **반년 뒤에 절차를 기억하지 못한다.** 그래서 순서를 사람이 아니라
 * 여기에 적어둔다. 검사가 하나라도 실패하면 멈춘다.
 *
 * 서명 열쇠는 이 저장소에 없고 앞으로도 없다. 그래서 앱을 만드는 일은
 * 자동으로 하지 않는다. 이 스크립트는 **내 맥에서만** 돈다.
 *
 * (docs/08-build-release.md 7장 · T25)
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const version = process.argv[2]

if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail('버전을 이렇게 적어주세요:  pnpm release 1.0.0')
}

run()

function run(): void {
  step('1/7 원격을 최신으로 맞춘다')
  // **가장 먼저 한다.** 남이 올린 것 위에 올려야 커밋이 안 사라진다.
  sh('git', ['fetch', '--all', '--prune'])

  step('2/7 손대던 것이 남아 있는지 본다')
  const dirty = out('git', ['status', '--porcelain']).trim()
  if (dirty.length > 0) {
    fail(`아직 저장 안 한 것이 있어요:\n${dirty}`)
  }

  step('3/7 검사를 돌린다')
  // 여기서 막히면 릴리스를 안 만든다. 깨진 앱을 비행기에 들고 갈 수 없다.
  sh('pnpm', ['verify'])

  step('4/7 버전을 적는다')
  bumpVersion(version as string)

  step('5/7 안드로이드 앱을 만든다')
  sh('pnpm', ['apk'])

  step('6/7 적어둔 것을 커밋하고 표시를 붙인다')
  sh('git', ['add', 'app.config.ts', 'package.json', 'CHANGELOG.md'])
  sh('git', ['commit', '-m', `chore: ${version} 로 올린다`])
  sh('git', ['tag', '-a', `v${version}`, '-m', `${version}`])
  sh('git', ['push', 'origin', 'HEAD', '--tags'])

  step('7/7 릴리스를 올린다')
  const apk = join(projectRoot, 'android/app/build/outputs/apk/release/app-release.apk')
  sh('gh', [
    'release',
    'create',
    `v${version}`,
    apk,
    '--title',
    `SkyTalk ${version}`,
    '--notes',
    releaseNotes(version as string),
  ])

  console.log(`\n끝났어요. v${version} 이 올라갔습니다.`)
}

/**
 * 버전을 두 곳에 적는다.
 *
 * 한 곳만 고치면 앱 화면에 뜨는 버전과 실제가 어긋난다. 상대가 다른
 * 버전일 때 그걸로 판단하는데, 어긋나 있으면 엉뚱한 결론이 난다.
 */
function bumpVersion(next: string): void {
  edit('package.json', text => text.replace(/"version": "[^"]+"/, `"version": "${next}"`))
  edit('app.config.ts', text => text.replace(/version: '[^']+'/, `version: '${next}'`))

  // 바뀐 내용은 사람이 적는다. 자리만 만들어 둔다.
  edit('CHANGELOG.md', text =>
    text.includes(`## ${next}`)
      ? text
      : text.replace(
          '<!-- 여기에 새 버전을 적는다 -->',
          `<!-- 여기에 새 버전을 적는다 -->\n\n## ${next}\n\n- (무엇이 달라졌는지 적어주세요)`,
        ),
  )
}

/**
 * 릴리스 설명.
 *
 * **설치 방법을 매번 같이 적는다.** 반년 뒤에 절차를 기억하지 못한다.
 */
function releaseNotes(next: string): string {
  return `## 설치하기

### 안드로이드

아래 \`app-release.apk\` 를 폰에서 받아 누른다. "출처를 알 수 없는 앱"을
허용해야 할 수 있다.

같은 열쇠로 만든 것이라 **덮어써도 대화가 남는다.** 지우고 다시 깔면
대화가 날아가니, 지우지 말고 덮어쓴다.

### 아이폰

맥에 USB 로 연결하고 저장소에서 실행한다.

\`\`\`bash
pnpm dev:ios
\`\`\`

설치한 뒤 아이폰에서 한 번 더 해야 한다.

\`\`\`
설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 → 신뢰
\`\`\`

**유료 개발자 계정이 없어서 7일 뒤에는 안 열린다.** 그 전에 설정에서
"대화 꺼내두기"를 해두면 다시 깐 뒤에 되돌릴 수 있다.

앱이 죽었는데 맥이 없으면, 안드로이드 핫스팟에 붙은 채로 사파리에서
\`http://192.168.43.1:51705\` 에 들어간다. 글로는 계속 대화할 수 있다.

### 쓰기 전에

\`.env\` 에 핫스팟 이름과 비밀번호를 적고 빌드해야 한다. 안 적어도
앱은 돌지만 이름 안내가 빠진다.

버전 ${next}
`
}

function edit(relative: string, change: (text: string) => string): void {
  const path = join(projectRoot, relative)
  const before = readFileSync(path, 'utf8')
  const after = change(before)
  if (after !== before) writeFileSync(path, after)
}

function sh(command: string, args: readonly string[]): void {
  execFileSync(command, args, { cwd: projectRoot, stdio: 'inherit' })
}

function out(command: string, args: readonly string[]): string {
  return execFileSync(command, args, { cwd: projectRoot, encoding: 'utf8' })
}

function step(what: string): void {
  console.log(`\n▶ ${what}`)
}

function fail(why: string): never {
  console.error(`\n✘ ${why}`)
  process.exit(1)
}
