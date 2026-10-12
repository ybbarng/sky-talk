/**
 * 가상 비행기.
 *
 * **폰도 비행기도 없이 진짜 앱 코드를 돌리려고 만든다.** 두 폰 사이에
 * 길이 두 가닥 있다. 블루투스와 기내 Wi-Fi 다. 어느 길이 닿는지는
 * 사람이 하는 일로 정해진다.
 *
 *   · 블루투스 — 두 폰 다 켜져 있고, **가까이 앉아야** 닿는다
 *   · 기내 Wi-Fi — 두 폰 다 붙어 있고, **손님끼리 막힌 망이 아니어야** 닿는다.
 *                  자리가 멀어도 된다
 *
 * 흉내 내는 것은 **선까지만**이다. 그 위의 봉투 형식, 바이트 자르기,
 * 두 길 사이 옮겨 타기, 놓친 말 되찾기는 전부 `src/` 의 진짜 코드다.
 * (docs/04-transport-spec.md 1장, 1.2)
 */

import type { LinkKind } from '@/domain/connection/LinkKind'

export type Side = 'host' | 'guest'

/** 블루투스와 Wi-Fi 만 흉내 낸다. 웹 길은 데모에 없다 */
export type DemoLinkKind = Extract<LinkKind, 'wifi' | 'ble'>

/**
 * 기내 Wi-Fi 에서 받는 주소.
 *
 * 같은 때 붙은 두 폰은 대개 가까운 주소를 받는다. 그래서 앱은 내 주소
 * 근처부터 훑는다(`scanTargets`). 망은 핫스팟보다 넓게 잡았다.
 */
export const CABIN_ADDRESS: Record<Side, string> = {
  host: '10.23.4.57',
  guest: '10.23.4.61',
}

export interface WorldEvent {
  readonly at: number
  readonly side: Side | 'net'
  readonly link: DemoLinkKind | null
  readonly text: string
  readonly kind: 'info' | 'send' | 'recv' | 'warn'
}

/** 선 한쪽 끝. 바이트만 받는다 */
export interface Endpoint {
  onBytes(bytes: Uint8Array): void
  /** 선이 끊겼다. 블루투스가 꺼졌거나, 멀어졌거나, Wi-Fi 에서 나갔다 */
  onCut(): void
}

export class World {
  /** 폰마다 켜고 끄는 것. **사람이 하는 일은 이것뿐이다** */
  readonly bluetoothOn: Record<Side, boolean> = { host: false, guest: false }
  readonly wifiJoined: Record<Side, boolean> = { host: false, guest: false }

  /** 블루투스가 닿을 만큼 가까이 앉았나 */
  seatsNear = true

  /**
   * 손님끼리 못 닿게 막아둔 기내 Wi-Fi 인가(AP isolation).
   *
   * 이러면 앱이 무엇을 해도 Wi-Fi 로는 못 닿는다. 비행기에 타봐야 안다.
   */
  isolated = false

  /** 선을 타는 데 걸리는 시간. 사람이 늦출 수 있다 */
  slow = false
  /** 바이트를 몇 조각으로 쪼개 보낼까. 실제 소켓이 이렇게 준다 */
  chop = 1

  /** 지금 이어진 선. 거는 쪽(아이폰)이 잇는다 */
  private readonly wired: Record<DemoLinkKind, boolean> = { wifi: false, ble: false }
  private readonly endpoints = new Map<string, Endpoint>()
  /** 방향마다 마지막 바이트가 닿는 시각. 앞선 것을 추월하지 않게 한다 */
  private readonly busyUntil = new Map<string, number>()

  readonly log: WorldEvent[] = []
  onLog: ((event: WorldEvent) => void) | null = null
  onChange: (() => void) | null = null

  note(
    side: Side | 'net',
    text: string,
    kind: WorldEvent['kind'] = 'info',
    link: DemoLinkKind | null = null,
  ): void {
    const event = { at: Date.now(), side, link, text, kind }
    this.log.push(event)
    if (this.log.length > 300) this.log.shift()
    this.onLog?.(event)
  }

  /** 앱의 각 길이 선 끝을 꽂는다 */
  plug(side: Side, link: DemoLinkKind, endpoint: Endpoint): void {
    this.endpoints.set(`${side}:${link}`, endpoint)
  }

  // --- 닿나 ---

  /** 지금 이 길로 두 폰이 닿을 수 있나 */
  reachable(link: DemoLinkKind): boolean {
    if (link === 'ble') {
      return this.bluetoothOn.host && this.bluetoothOn.guest && this.seatsNear
    }
    return this.wifiJoined.host && this.wifiJoined.guest && !this.isolated
  }

  isWired(link: DemoLinkKind): boolean {
    return this.wired[link]
  }

  /** 거는 쪽이 선을 잇는다. 닿지 않으면 실패한다 */
  wire(link: DemoLinkKind): boolean {
    if (!this.reachable(link)) return false
    if (this.wired[link]) return true

    this.wired[link] = true
    this.note('net', link === 'ble' ? '블루투스 선이 이어졌어요' : '기내 Wi-Fi 위로 TCP 51704 가 이어졌어요', 'info', link)
    this.onChange?.()
    return true
  }

  /** 선을 끊는다. 양쪽 끝이 다 안다 */
  cut(link: DemoLinkKind, why: string): void {
    if (!this.wired[link]) return
    this.wired[link] = false
    this.note('net', `선이 끊겼어요 · ${why}`, 'warn', link)

    for (const side of ['host', 'guest'] as const) {
      this.endpoints.get(`${side}:${link}`)?.onCut()
    }
    this.onChange?.()
  }

  // --- 사람이 하는 일 ---

  setBluetooth(side: Side, on: boolean): void {
    if (this.bluetoothOn[side] === on) return
    this.bluetoothOn[side] = on
    this.note(side, on ? '블루투스를 켰어요' : '블루투스를 껐어요', on ? 'info' : 'warn', 'ble')
    this.recheck()
  }

  setWifi(side: Side, joined: boolean): void {
    if (this.wifiJoined[side] === joined) return
    this.wifiJoined[side] = joined
    this.note(
      side,
      joined ? `기내 Wi-Fi 에 붙었어요 · ${CABIN_ADDRESS[side]}` : '기내 Wi-Fi 에서 나왔어요',
      joined ? 'info' : 'warn',
      'wifi',
    )
    this.recheck()
  }

  setSeatsNear(near: boolean): void {
    if (this.seatsNear === near) return
    this.seatsNear = near
    this.note('net', near ? '가까이 앉았어요' : '멀리 떨어져 앉았어요. 블루투스가 안 닿아요', near ? 'info' : 'warn')
    this.recheck()
  }

  setIsolated(on: boolean): void {
    if (this.isolated === on) return
    this.isolated = on
    this.note('net', on ? '기내 Wi-Fi 가 손님끼리 막았어요' : '기내 Wi-Fi 가 손님끼리 닿게 해요', on ? 'warn' : 'info', 'wifi')
    this.recheck()
  }

  /** 닿지 않게 된 선은 끊는다 */
  private recheck(): void {
    for (const link of ['ble', 'wifi'] as const) {
      if (this.wired[link] && !this.reachable(link)) {
        this.cut(link, link === 'ble' ? '블루투스가 안 닿아요' : 'Wi-Fi 로 안 닿아요')
      }
    }
    this.onChange?.()
  }

  // --- 바이트 나르기 ---

  /**
   * 바이트를 보낸다.
   *
   * **길마다 빠르기가 다르다.** 블루투스는 초당 몇 KB 라 큰 봉투일수록
   * 오래 걸린다. Wi-Fi 는 거의 순식간이다. (docs/04-transport-spec.md 1장)
   */
  send(from: Side, link: DemoLinkKind, bytes: Uint8Array): boolean {
    if (!this.wired[link]) return false

    const to: Side = from === 'host' ? 'guest' : 'host'
    const endpoint = this.endpoints.get(`${to}:${link}`)
    if (endpoint === undefined) return false

    // **보낸 순서대로 닿는다.** TCP 도, 응답 받는 블루투스 쓰기도 그렇다.
    // 크기만큼 늦게 닿게 하면서 앞선 것을 기다리지 않으면 큰 봉투가 작은
    // 봉투에 추월당해 실제로 없는 순서 뒤바뀜이 생긴다.
    const lane = `${from}:${link}`
    const now = Date.now()
    const arrives = Math.max(now + this.delayFor(link, bytes.byteLength), this.busyUntil.get(lane) ?? 0)
    this.busyUntil.set(lane, arrives)

    for (const piece of this.chopUp(bytes)) {
      setTimeout(() => {
        if (!this.wired[link]) return
        endpoint.onBytes(piece)
      }, arrives - now)
    }
    return true
  }

  private delayFor(link: DemoLinkKind, size: number): number {
    const base = link === 'ble' ? 60 : 15
    // 블루투스는 초당 3KB 쯤 간다
    const carry = link === 'ble' ? (size / 3000) * 1000 : 0
    return Math.round((base + carry) * (this.slow ? 8 : 1))
  }

  private chopUp(bytes: Uint8Array): Uint8Array[] {
    if (this.chop <= 1 || bytes.byteLength <= 1) return [bytes]

    const size = Math.max(1, Math.ceil(bytes.byteLength / this.chop))
    const pieces: Uint8Array[] = []
    for (let at = 0; at < bytes.byteLength; at += size) {
      pieces.push(bytes.subarray(at, Math.min(at + size, bytes.byteLength)))
    }
    return pieces
  }
}
