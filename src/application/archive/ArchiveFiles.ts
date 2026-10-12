import type { Clock } from '@/domain/shared/Clock'

/**
 * 꺼낸 파일에 붙일 이름.
 *
 * **이름만 보고 언제 것인지 알 수 있어야 한다.** 여러 번 꺼내면
 * 파일이 쌓이는데, 전부 "대화.json" 이면 어느 게 최신인지 모른다.
 *
 * 시각을 글자로 적되 자리 수를 고정한다. 그래야 이름순으로 줄 세우면
 * 시간순이 된다.
 */

export type ArchiveKind = 'json' | 'html' | 'text'

const extensions: Record<ArchiveKind, string> = {
  json: '.skytalk.json',
  html: '.html',
  text: '.txt',
}

export function archiveFileName(kind: ArchiveKind, at: Date): string {
  return `대화-${stamp(at)}${extensions[kind]}`
}

/** 자동으로 남겨두는 것. 손으로 꺼낸 것과 이름으로 구별한다 */
export function autoBackupFileName(at: Date): string {
  return `자동보관-${stamp(at)}.skytalk.json`
}

export function isAutoBackup(name: string): boolean {
  return name.startsWith('자동보관-')
}

function stamp(at: Date): string {
  const p = (value: number, width = 2) => String(value).padStart(width, '0')
  return (
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}`
  )
}

/**
 * 자동 보관을 할 때가 됐나.
 *
 * 앱이 뒤로 갈 때마다 확인한다. **너무 자주 만들면** 저장 공간을
 * 갉아먹고 앱이 느려진다. 하루에 한 번이면 충분하다.
 */
export const AUTO_BACKUP_EVERY_MS = 24 * 60 * 60 * 1000

export function shouldAutoBackup(lastAt: number | null, now: number): boolean {
  if (lastAt === null) return true
  return now - lastAt >= AUTO_BACKUP_EVERY_MS
}

/** 최근 몇 개만 남긴다. 오래된 것은 지운다 */
export const KEEP_BACKUPS = 3

/**
 * 지울 것을 고른다.
 *
 * 이름에 시각이 박혀 있어서 이름순으로 줄 세우면 시간순이 된다.
 * **최근 것부터 남기고 나머지를 지운다.**
 */
export function backupsToRemove(names: readonly string[]): string[] {
  const backups = names.filter(isAutoBackup).sort()
  if (backups.length <= KEEP_BACKUPS) return []
  return backups.slice(0, backups.length - KEEP_BACKUPS)
}

/**
 * 아이폰 앱이 만료되기까지 남은 날.
 *
 * 유료 개발자 계정이 없어서 **7일 뒤에는 앱이 안 열린다.**
 *
 * ## 화면에 띄우지 않기로 했다
 *
 * 아래 두 함수를 부르는 곳이 없는 것은 실수가 아니다.
 *
 * 7일을 넘겨 비행할 일이 없고, 대화 기록은 **안드로이드에서 뽑는다.**
 * 안드로이드에는 만료가 없으니 아이폰이 안 열려도 잃는 것이 없다.
 * 그래서 비행 중에 "곧 앱이 안 열려요" 를 띄워 겁줄 이유가 없다.
 *
 * 함수와 테스트는 남겨둔다. 사정이 바뀌어 아이폰에서도 뽑아야 하면
 * 그때 화면에 붙이면 된다.
 */
export const APP_LIFETIME_DAYS = 7

/** 며칠 전에 알릴까. 하루 전에 알리면 손쓸 시간이 없다 */
export const WARN_BEFORE_DAYS = 3

export function daysUntilExpiry(installedAt: number, now: number): number {
  const elapsedDays = (now - installedAt) / (24 * 60 * 60 * 1000)
  return Math.ceil(APP_LIFETIME_DAYS - elapsedDays)
}

export function shouldWarnAboutExpiry(installedAt: number | null, now: number): boolean {
  // 안드로이드에는 만료가 없다. 설치 날짜를 안 적어둔다.
  if (installedAt === null) return false

  const left = daysUntilExpiry(installedAt, now)
  // 이미 지났으면 알려도 소용없다. 앱이 안 열린다.
  return left <= WARN_BEFORE_DAYS && left > 0
}

export function expiryMessage(installedAt: number, clock: Clock): string {
  const left = daysUntilExpiry(installedAt, clock.epochMillis())
  return `${left}일 뒤면 이 앱이 열리지 않아요.\n대화를 꺼내두면 다시 설치한 뒤에도 그대로 볼 수 있어요.`
}
