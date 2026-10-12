import type { LinkKind } from '@/domain/connection/LinkKind'
import type { DomainError } from '@/domain/shared/DomainError'
import type { Result } from '@/domain/shared/Result'
import type { Unsubscribe } from './MessageTransport'

/**
 * 상대를 찾는 무언가.
 *
 * 손으로 주소를 입력하는 일이 없어야 한다. 말을 나눌 수 없는 두 사람이
 * 각자 화면만 보고 연결에 성공해야 하기 때문이다.
 * (docs/04-transport-spec.md 2.3)
 */
export interface PeerDiscovery {
  readonly kind: LinkKind

  /** 찾기 시작한다 */
  start(): Promise<Result<void, DomainError>>

  stop(): Promise<void>

  /** 상대를 찾으면 알려준다 */
  onFound(handler: (found: FoundPeer) => void): Unsubscribe

  /**
   * 어디까지 해봤는지 알려준다.
   *
   * 빙글빙글 도는 표시만 두면 사용자는 앱이 멈춘 줄 안다.
   * 무슨 일이 일어나는 중인지 보여주려고 이 신호를 낸다.
   */
  onProgress(handler: (progress: DiscoveryProgress) => void): Unsubscribe
}

export interface FoundPeer {
  /** 어디로 걸면 되는지. Wi-Fi 면 주소와 번호, 블루투스면 기기 식별자 */
  readonly address: string
  readonly peerId?: string
  readonly foundBy: DiscoveryMethod
}

/**
 * 찾는 방법. 순서대로 시도하고 하나라도 성공하면 멈춘다.
 * (docs/04-transport-spec.md 2.3)
 */
export type DiscoveryMethod =
  /** 지난번에 붙었던 주소에 다시 걸기 */
  | 'last-known'
  /** 게이트웨이에 바로 걸기. 대개 1초 안에 끝난다 */
  | 'gateway'
  /** 사설망 전체에 대고 외치기. 지금은 쓰지 않는다 */
  | 'broadcast'
  /** 주소를 하나씩 훑어보기 */
  | 'scan'
  /** 사람이 코드를 읽어주기 */
  | 'manual'
  /** 블루투스로 찾기 */
  | 'ble-scan'

export interface DiscoveryProgress {
  readonly method: DiscoveryMethod
  readonly phase: 'started' | 'failed' | 'succeeded'
  /** 훑어보는 중일 때 얼마나 봤는지 */
  readonly checked?: number
  readonly total?: number
  /** 내 주소. 화면에 띄워 상대에게 보여줄 때 쓴다 */
  readonly selfAddress?: string
}
