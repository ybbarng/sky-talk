import { describe, expect, it } from 'vitest'
import {
  APP_LIFETIME_DAYS,
  AUTO_BACKUP_EVERY_MS,
  archiveFileName,
  autoBackupFileName,
  backupsToRemove,
  daysUntilExpiry,
  isAutoBackup,
  KEEP_BACKUPS,
  shouldAutoBackup,
  shouldWarnAboutExpiry,
  WARN_BEFORE_DAYS,
} from './ArchiveFiles'

const AT = new Date('2026-09-18T14:05:00')
const DAY = 24 * 60 * 60 * 1000

describe('파일 이름', () => {
  it('언제 꺼낸 것인지 이름에 담는다', () => {
    // 여러 번 꺼내면 쌓이는데 전부 "대화.json" 이면 어느 게 최신인지 모른다
    expect(archiveFileName('json', AT)).toBe('대화-20260918-1405.skytalk.json')
    expect(archiveFileName('html', AT)).toBe('대화-20260918-1405.html')
    expect(archiveFileName('text', AT)).toBe('대화-20260918-1405.txt')
  })

  it('이름순으로 줄 세우면 시간순이 된다', () => {
    // 자리 수가 고정이라 그렇다. 9월을 "9" 로 적으면 10월보다 뒤로 간다.
    const names = [
      archiveFileName('json', new Date('2026-10-02T09:00:00')),
      archiveFileName('json', new Date('2026-09-18T14:05:00')),
      archiveFileName('json', new Date('2026-09-18T09:30:00')),
    ]

    expect([...names].sort()).toEqual([names[2], names[1], names[0]])
  })

  it('자동으로 남긴 것과 손으로 꺼낸 것을 가른다', () => {
    expect(isAutoBackup(autoBackupFileName(AT))).toBe(true)
    expect(isAutoBackup(archiveFileName('json', AT))).toBe(false)
  })
})

describe('자동 보관', () => {
  it('한 번도 안 했으면 한다', () => {
    expect(shouldAutoBackup(null, AT.getTime())).toBe(true)
  })

  it('하루가 지나야 다시 한다', () => {
    // 앱이 뒤로 갈 때마다 만들면 저장 공간을 갉아먹는다
    const last = AT.getTime()

    expect(shouldAutoBackup(last, last + DAY - 1)).toBe(false)
    expect(shouldAutoBackup(last, last + DAY)).toBe(true)
  })

  it('하루에 한 번이다', () => {
    expect(AUTO_BACKUP_EVERY_MS).toBe(DAY)
  })

  it('최근 세 개만 남긴다', () => {
    const names = [
      '자동보관-20260915-0900.skytalk.json',
      '자동보관-20260916-0900.skytalk.json',
      '자동보관-20260917-0900.skytalk.json',
      '자동보관-20260918-0900.skytalk.json',
      '자동보관-20260919-0900.skytalk.json',
    ]

    expect(backupsToRemove(names)).toEqual([names[0], names[1]])
  })

  it('세 개 이하면 안 지운다', () => {
    const names = [
      '자동보관-20260917-0900.skytalk.json',
      '자동보관-20260918-0900.skytalk.json',
    ]

    expect(backupsToRemove(names)).toEqual([])
  })

  it('손으로 꺼낸 것은 절대 안 지운다', () => {
    // **사람이 일부러 만든 것이다.** 앱이 마음대로 지우면 안 된다.
    const names = [
      '대화-20260915-0900.skytalk.json',
      '대화-20260916-0900.skytalk.json',
      '대화-20260917-0900.skytalk.json',
      '대화-20260918-0900.skytalk.json',
      '자동보관-20260919-0900.skytalk.json',
    ]

    expect(backupsToRemove(names)).toEqual([])
  })

  it('남기는 개수가 하나보다는 많다', () => {
    // 하나만 남기면 그게 망가졌을 때 돌아갈 곳이 없다
    expect(KEEP_BACKUPS).toBeGreaterThan(1)
  })
})

describe('아이폰 만료 알림', () => {
  const installed = new Date('2026-09-18T10:00:00').getTime()

  it('남은 날을 센다', () => {
    expect(daysUntilExpiry(installed, installed)).toBe(APP_LIFETIME_DAYS)
    expect(daysUntilExpiry(installed, installed + 4 * DAY)).toBe(3)
  })

  it('만료가 다가오면 알린다', () => {
    expect(shouldWarnAboutExpiry(installed, installed + 4 * DAY)).toBe(true)
  })

  it('아직 멀었으면 안 알린다', () => {
    // 처음부터 알리면 매번 보이는 잔소리가 된다
    expect(shouldWarnAboutExpiry(installed, installed + 1 * DAY)).toBe(false)
  })

  it('이미 지났으면 알려도 소용없다', () => {
    // 앱이 안 열린다. 이 알림을 볼 수조차 없다.
    expect(shouldWarnAboutExpiry(installed, installed + 8 * DAY)).toBe(false)
  })

  it('안드로이드에는 만료가 없다', () => {
    // 설치 날짜를 안 적어둔다. 알릴 이유가 없다.
    expect(shouldWarnAboutExpiry(null, Date.now())).toBe(false)
  })

  it('손쓸 시간을 두고 알린다', () => {
    // 하루 전에 알리면 맥이 없는 곳에서는 아무것도 못 한다
    expect(WARN_BEFORE_DAYS).toBeGreaterThanOrEqual(2)
    expect(WARN_BEFORE_DAYS).toBeLessThan(APP_LIFETIME_DAYS)
  })
})
