import type { ConnectionState } from '@/domain/connection/ConnectionState'
import type { ConnectPhase, Role } from '../copy/connecting'

/**
 * 지금 사람에게 무엇을 보여줄지 정한다.
 *
 * 기술 상태(찾는 중, 인사 중, 끊김)를 **사람이 이해하는 단계**로 옮긴다.
 * 순수한 계산이라 전부 시험할 수 있다.
 */

export interface PhaseInput {
  readonly role: Role
  readonly connection: ConnectionState | null
  /** 블루투스가 켜져 있나. 모르면 null */
  readonly bluetoothOn: boolean | null
  /** 상대를 찾았나 */
  readonly peerFound: boolean
  /** 한 번이라도 붙은 적 있나. 있으면 "다시 붙는 중"으로 말한다 */
  readonly everConnected: boolean
}

export function decidePhase(input: PhaseInput): ConnectPhase {
  const { role, connection, bluetoothOn, peerFound, everConnected } = input

  // 붙는 중이거나 인사 중
  if (connection?.phase === 'handshaking') return 'joining'

  // **블루투스가 꺼진 것을 가장 먼저 본다.**
  //
  // 한 번 이어진 뒤라도 마찬가지다. 꺼졌으면 아무리 기다려도
  // 저절로 돌아오지 않는데, 여기서 "알아서 다시 이어드릴게요" 라고 하면
  // 사람은 손을 놓고 기다리게 된다. **사람이 켜야 풀리는 일은 사람에게
  // 말해야 한다.**
  //
  // 아직 모를 때(null)는 넘어간다. 켜져 있는데 껐다고 할 수는 없다.
  if (bluetoothOn === false) {
    return role === 'host' ? 'need-hotspot' : 'need-wifi'
  }

  // 한 번 붙었다가 끊긴 것과, 처음부터 못 붙은 것은 다르게 말한다.
  // "잠깐 멀어졌어요" 와 "찾는 중" 은 사람에게 전혀 다른 느낌이다.
  if (everConnected) return 'recovering'

  if (peerFound) return 'found'

  // 망에는 붙었다. 이제 앱이 알아서 한다.
  return role === 'host' ? 'waiting-for-peer' : 'looking'
}

/**
 * 도움말을 언제 보여줄까.
 *
 * 처음부터 보여주면 "안 되나 보다" 싶어진다. 한참 지난 뒤에만 띄운다.
 * 그리고 **사람이 할 일이 남아 있을 때는 안 띄운다** — 이미 버튼이
 * 있는데 도움말까지 띄우면 화면이 시끄럽다.
 */
export function shouldShowHint(phase: ConnectPhase, elapsedMs: number): boolean {
  if (phase === 'found' || phase === 'joining') return false
  if (phase === 'need-hotspot' || phase === 'need-wifi') return false

  return elapsedMs >= HINT_AFTER_MS
}

export const HINT_AFTER_MS = 20_000

/**
 * 끊긴 것을 화면에 알릴까.
 *
 * 짧은 끊김은 알리지 않는다. 비행기에서는 신호가 자주 흔들리는데
 * 그때마다 빨간 띠가 뜨면 사람이 불안해진다. **알아서 다시 붙을
 * 시간을 주고, 그래도 안 되면 그때 알린다.**
 */
export function shouldAnnounceDisconnect(disconnectedForMs: number): boolean {
  return disconnectedForMs >= ANNOUNCE_DISCONNECT_AFTER_MS
}

export const ANNOUNCE_DISCONNECT_AFTER_MS = 4000
