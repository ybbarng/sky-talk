/**
 * 블루투스를 쓰겠다고 안드로이드에 물어본다.
 *
 * **안 물어보면 아무것도 못 찾는다.** 안드로이드 12 부터 블루투스로
 * 찾는 일이 위치 정보와 같은 등급이 되어서, 권한 없이 찾기를 시작하면
 * 오류도 안 나고 **결과만 영영 안 온다.** 그래서 "상대를 못 찾았다" 로만
 * 보이고 왜 그런지 알 길이 없다. 비행기 안에서 이러면 손쓸 수 없다.
 *
 * 아이폰은 물어볼 것이 없다. 처음 쓸 때 운영체제가 알아서 묻는다.
 *
 * (docs/04-transport-spec.md 4장 · T20)
 */

import type { DomainError } from '@/domain/shared/DomainError'
import { domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'

/** 안드로이드 12. 여기서 블루투스 권한이 통째로 바뀌었다 */
export const BLUETOOTH_PERMISSION_CHANGED = 31

export const BLUETOOTH_PERMISSIONS = {
  scan: 'android.permission.BLUETOOTH_SCAN',
  connect: 'android.permission.BLUETOOTH_CONNECT',
  advertise: 'android.permission.BLUETOOTH_ADVERTISE',
  /** 옛 안드로이드는 위치 권한으로 블루투스를 찾게 했다 */
  location: 'android.permission.ACCESS_FINE_LOCATION',
} as const

/**
 * 이 기기에서 무엇을 물어봐야 하나.
 *
 * 필요 없는 것까지 물으면 사용자가 겁을 먹는다. **위치를 묻지 않는 것이
 * 요점이다.** 안드로이드 12 부터는 `neverForLocation` 표시 덕에 안 물어도
 * 된다(`app.config.ts` 참고). 그 아래에서만 어쩔 수 없이 묻는다.
 */
export function neededPermissions(os: string, version: number): readonly string[] {
  if (os !== 'android') return []

  if (version >= BLUETOOTH_PERMISSION_CHANGED) {
    return [
      BLUETOOTH_PERMISSIONS.scan,
      BLUETOOTH_PERMISSIONS.connect,
      BLUETOOTH_PERMISSIONS.advertise,
    ]
  }

  return [BLUETOOTH_PERMISSIONS.location]
}

/** 물어본 결과. `PermissionsAndroid` 가 돌려주는 모양이다 */
export type PermissionAnswers = Readonly<Record<string, string>>

/**
 * 다 받았나.
 *
 * `'granted'` 가 아닌 것이 하나라도 있으면 찾기를 시작하지 않는다.
 * 반쯤 받은 채로 시작하면 조용히 실패한다.
 */
export function allGranted(
  needed: readonly string[],
  answers: PermissionAnswers,
): boolean {
  return needed.every(name => answers[name] === 'granted')
}

/**
 * 거절당했을 때 화면에 띄울 말.
 *
 * **무엇을 누르면 되는지 적는다.** 영어 권한 이름을 띄우면 손쓸 수 없다.
 */
export const BLUETOOTH_DENIED =
  '블루투스를 쓸 수 없어서 상대를 못 찾아요.\n설정 → 앱 → SkyTalk → 권한에서 근처 기기를 켜주세요.'

/**
 * 실제로 물어본다.
 *
 * `react-native` 은 켜자마자 도는 길에 있어도 괜찮다(`check-native` 가
 * 허락한다). 그래도 쓸 때 부른다.
 */
export async function askForBluetooth(): Promise<Result<void, DomainError>> {
  const { PermissionsAndroid, Platform } = require('react-native')

  const needed = neededPermissions(Platform.OS, Number(Platform.Version))
  if (needed.length === 0) return ok(undefined)

  try {
    const answers: PermissionAnswers = await PermissionsAndroid.requestMultiple(needed)

    if (!allGranted(needed, answers)) {
      return err(domainError('not-allowed', BLUETOOTH_DENIED, 'ble'))
    }

    return ok(undefined)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return err(
      domainError('not-allowed', `블루투스 권한을 묻지 못했다: ${detail}`, 'ble'),
    )
  }
}
