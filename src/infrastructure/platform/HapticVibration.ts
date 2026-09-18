import { Platform, Vibration as RNVibration } from 'react-native'
import type { Vibration } from '@/application/ports/Vibration'

/**
 * 폰을 떨게 한다.
 *
 * 콕 찌르기, 마이크가 열렸을 때, 그리고 앱을 보는 동안 새 말이 왔을
 * 때 쓴다. **말 없이 "자니?" 하는 용도라** 소리보다 진동이 맞다.
 * 비행기는 시끄럽고, 상대는 이어폰을 꽂고 있다.
 *
 * ## 맨 위에서 들여오지 않는다
 *
 * `expo-haptics` 는 네이티브 모듈이다. 맨 위에서 `import` 하면 빌드가
 * 어긋났을 때 **앱이 통째로 안 켜진다.** 이 파일은 조립
 * (`composition/services.ts`)을 거쳐 거의 모든 화면이 들고 있어서,
 * 여기서 터지면 글도 못 쓴다.
 *
 * 그래서 쓸 때 들여오고, 없으면 `react-native` 의 기본 진동으로
 * 물러난다. 그것도 없으면 아무 일도 안 한다.
 *
 * ## 실패해도 조용히 넘어간다
 *
 * 진동이 안 울리는 것은 아쉬울 뿐이고, **그것 때문에 앱이 죽으면
 * 훨씬 나쁘다.** 진동을 못 쓰는 기기가 있고, 설정에서 꺼둔 사람도 있다.
 */

type LoadResult =
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈이라 타입을 우리가 정하지 않는다
  { readonly available: true; readonly module: any } | { readonly available: false }

let cached: LoadResult | null = null

function load(): LoadResult {
  if (cached !== null) return cached

  try {
    const loaded = require('expo-haptics')
    cached =
      loaded !== null && typeof loaded.impactAsync === 'function'
        ? { available: true, module: loaded }
        : { available: false }
  } catch {
    cached = { available: false }
  }

  return cached
}

/** 햅틱이 없으면 기본 진동으로 물러난다 */
function buzz(pattern: number[]): void {
  try {
    RNVibration.vibrate(pattern)
  } catch {
    // 진동도 없다. 화면에는 이미 떴다.
  }
}

export class HapticVibration implements Vibration {
  /**
   * 콕 찔렸을 때. **약하게** 두 번 톡톡.
   *
   * 말 없이 "자니?" 하는 것이라 놀라게 하면 안 된다. 세게 울리면
   * 옆자리 승객까지 돌아본다. 두 번인 것은 새 말이 왔을 때의
   * 한 번(`tap`)과 손끝으로 구별하기 위해서다.
   */
  async nudge(): Promise<void> {
    // **햅틱이 아니라 진동 모터를 직접 돌린다.** 햅틱은 아이폰의 "시스템
    // 햅틱" 설정이 꺼져 있으면 아예 안 울리고, 삼성 폰에서는 가벼운 톡이
    // 거의 안 느껴진다. 실제로 두 폰 다 "진동이 없다" 고 했다(2026-09-19).
    // 모터는 설정과 상관없이 돈다. 아이폰은 한 번의 길이가 정해져 있어
    // 숫자는 사이 간격만 뜻한다.
    if (Platform.OS === 'ios') {
      buzz([0, 400, 250, 400])
      return
    }

    buzz([0, 70, 90, 70])
  }

  /**
   * 마이크가 열렸을 때. 짧게 한 번.
   *
   * 소리 설정을 바꾸는 데 0.1초쯤 걸린다. **이 진동이 오기 전에
   * 말하면 앞부분이 잘린다.** 그래서 준비됐다는 표시다.
   */
  async talkReady(): Promise<void> {
    const haptics = load()
    if (!haptics.available) {
      buzz([0, 40])
      return
    }

    try {
      await haptics.module.impactAsync(haptics.module.ImpactFeedbackStyle.Medium)
    } catch {
      // 없어도 된다. 화면 색이 이미 바뀌었다.
    }
  }

  /** 가벼운 확인. 앱을 보는 동안 새 말이 왔을 때 같은 것 */
  async tap(): Promise<void> {
    const haptics = load()
    if (!haptics.available) {
      buzz([0, 25])
      return
    }

    try {
      await haptics.module.impactAsync(haptics.module.ImpactFeedbackStyle.Light)
    } catch {
      // 조용히 넘어간다
    }
  }

  /** 뭔가 잘못됐을 때 */
  async warn(): Promise<void> {
    const haptics = load()
    if (!haptics.available) {
      buzz([0, 60, 80, 60])
      return
    }

    try {
      await haptics.module.notificationAsync(
        haptics.module.NotificationFeedbackType.Error,
      )
    } catch {
      // 조용히 넘어간다
    }
  }
}
