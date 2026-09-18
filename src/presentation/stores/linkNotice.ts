import type { Role } from '../copy/connecting'

/**
 * 연결이 끊겼다고 알릴까, 알린다면 언제.
 *
 * **소켓을 건드리지 않는 순수한 계산이다.** 실제로 알림을 띄우는 일만
 * 바깥에 맡기고 판단은 여기서 전부 시험한다.
 *
 * ## 왜 바로 안 알리나
 *
 * 연결은 원래 자주 끊긴다. 화면이 꺼지거나, 상대가 앱을 잠깐 닫거나,
 * 좌석 사이 벽에 신호가 가렸을 때 끊겼다가 몇 초 만에 돌아온다.
 * 그때마다 알리면 **세 시간 내내 폰이 울린다.** 그러면 알림을 꺼버리고,
 * 정작 진짜 끊겼을 때 모른다.
 *
 * 그래서 한참 지나도 안 돌아올 때만 알린다.
 *
 * ## 왜 블루투스가 꺼진 것만 따로 다루나
 *
 * 다른 이유로 끊긴 것은 앱이 알아서 다시 붙는다. 그런데 **블루투스가
 * 꺼진 것은 사람이 켜야 풀린다.** 아무리 기다려도 저절로 안 돌아온다.
 * 그래서 더 빨리, 더 세게 알리고 무엇을 눌러야 하는지 적는다.
 * (`connectPhase.ts` 도 같은 이유로 블루투스를 먼저 본다)
 */

/** 블루투스가 꺼졌을 때. 사람이 켜야 하니 빨리 알린다 */
export const BLUETOOTH_OFF_AFTER_MS = 20_000

/** 그 밖의 이유. 앱이 알아서 다시 붙을 시간을 준다 */
export const LINK_LOST_AFTER_MS = 90_000

export type LinkNotice =
  /** 알릴 것이 없다 */
  | { readonly kind: 'none' }
  /** 블루투스가 꺼졌다. 켜야 풀린다 */
  | { readonly kind: 'bluetooth-off' }
  /** 한참 못 붙고 있다 */
  | { readonly kind: 'lost' }
  /** 다시 붙었다 */
  | { readonly kind: 'back' }

export interface LinkWatch {
  readonly role: Role
  readonly connected: boolean
  /**
   * 블루투스가 켜져 있나.
   *
   * 아직 못 읽었으면 `null`. **모르는 것을 "꺼졌다" 로 바꾸지 않는다.**
   * 멀쩡한 사람에게 켜라고 하면 무엇을 눌러야 할지 모른다.
   */
  readonly bluetoothOn: boolean | null
  /** 끊긴 지 얼마나 됐나. 붙어 있으면 0 */
  readonly downForMs: number
  /** 앱을 보고 있나. 보고 있으면 화면이 이미 말해준다 */
  readonly appActive: boolean
  /** 한 번이라도 붙어본 적이 있나 */
  readonly everConnected: boolean
  /** 끊겼다고 이미 알렸나 */
  readonly toldLost: boolean
}

export function decideNotice(watch: LinkWatch): LinkNotice {
  // 한 번도 안 붙어봤으면 "끊긴" 것이 아니다. 첫 연결을 기다리는 중이다.
  if (!watch.everConnected) return { kind: 'none' }

  if (watch.connected) {
    // 끊겼다고 알린 적이 있어야 돌아왔다고 알릴 값이 있다.
    // 안 알렸으면 사람은 끊긴 줄도 몰랐다.
    return watch.toldLost ? { kind: 'back' } : { kind: 'none' }
  }

  // **보고 있으면 안 띄운다.** 화면에 이미 "연결이 끊겼어요" 가 떠 있다.
  if (watch.appActive) return { kind: 'none' }
  if (watch.toldLost) return { kind: 'none' }

  // 사람이 켜야 풀리는 일은 더 빨리 알린다.
  // 아직 못 읽었으면(null) 그냥 끊긴 것으로 본다.
  if (watch.bluetoothOn === false) {
    return watch.downForMs >= BLUETOOTH_OFF_AFTER_MS
      ? { kind: 'bluetooth-off' }
      : { kind: 'none' }
  }

  return watch.downForMs >= LINK_LOST_AFTER_MS ? { kind: 'lost' } : { kind: 'none' }
}
