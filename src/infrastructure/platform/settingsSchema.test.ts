import { describe, expect, it } from 'vitest'
import { defaultPreferences, preferencesSchema, profileSchema } from './settingsSchema'

/**
 * **예전에 저장해둔 설정이 살아남아야 한다.**
 *
 * 형식에 안 맞으면 통째로 버려지고 기본값으로 돌아간다. 그러면
 * `onboardingDone` 까지 날아가서 비행기 안에서 첫 실행 안내부터 다시
 * 하게 된다. 새 값을 더할 때마다 여기서 막는다.
 */

/** 새 값이 생기기 전에 저장해뒀을 법한 것 */
const older = {
  audioMode: 'like-a-call',
  duckMusic: false,
  volumeKeyTalk: false,
  onboardingDone: true,
  installedAt: 1_700_000_000_000,
}

describe('예전 설정 읽기', () => {
  it('새로 생긴 값이 없어도 읽힌다', () => {
    const parsed = preferencesSchema.safeParse(older)

    expect(parsed.success).toBe(true)
  })

  it('첫 실행 안내를 다시 하게 만들지 않는다', () => {
    // 이게 날아가면 비행기 안에서 처음부터 다시 해야 한다.
    const parsed = preferencesSchema.parse(older)

    expect(parsed.onboardingDone).toBe(true)
    expect(parsed.audioMode).toBe('like-a-call')
  })

  it('새로 생긴 값은 기본값으로 채운다', () => {
    const parsed = preferencesSchema.parse(older)

    expect(parsed.alertMode).toBe('vibrate')
    expect(parsed.tapWhileWatching).toBe(true)
  })

  it('보고 있을 때 떠는 것과 안 보고 있을 때 알리는 것은 따로 정한다', () => {
    // 하나로 묶으면 한쪽을 끄려다 다른 쪽까지 꺼진다.
    const parsed = preferencesSchema.parse({
      ...older,
      alertMode: 'silent',
      tapWhileWatching: true,
    })

    expect(parsed.alertMode).toBe('silent')
    expect(parsed.tapWhileWatching).toBe(true)
  })

  it('기본은 진동이다', () => {
    // 비행기는 시끄럽고 상대는 이어폰을 꽂고 있다. 옆자리 승객도 있다.
    expect(defaultPreferences.alertMode).toBe('vibrate')
  })

  it('모르는 값이 들어 있어도 읽힌다', () => {
    // 새 버전에서 쓰던 값이 남아 있을 수 있다.
    const parsed = preferencesSchema.safeParse({ ...older, 나중에생긴것: 1 })

    expect(parsed.success).toBe(true)
  })
})

describe('예전 프로필 읽기', () => {
  const olderProfile = {
    peerId: 'peer-ybbarng1',
    displayName: '나',
    character: 'orion',
    // 예전 앱이 남긴 여섯 자리 코드. 지금은 안 쓰지만 있어도 읽혀야 한다
    pairingCode: '482913',
    role: 'host',
  }

  it('상대 별명이 없어도 읽힌다', () => {
    const parsed = profileSchema.safeParse(olderProfile)

    expect(parsed.success).toBe(true)
  })

  it('별명이 없으면 없는 대로 둔다', () => {
    // 비워둔 것과 안 정한 것을 구별할 필요가 없다. 둘 다 "상대" 다.
    expect(profileSchema.parse(olderProfile).peerNickname).toBeUndefined()
  })

  it('예전 앱이 남긴 코드는 무시하고 읽는다', () => {
    // 코드 기능을 없앴다. 그 값이 망가져 있어도 설정을 통째로 버리면 안 된다.
    expect(profileSchema.safeParse({ ...olderProfile, pairingCode: '12' }).success).toBe(
      true,
    )
    expect('pairingCode' in profileSchema.parse(olderProfile)).toBe(false)
  })
})

describe('기본값 자체가 형식에 맞는다', () => {
  it('기본값을 저장했다 읽어도 그대로다', () => {
    expect(preferencesSchema.parse(defaultPreferences)).toEqual(defaultPreferences)
  })
})
