import type { Envelope } from '@/application/ports/Envelope'
import type { MessageTransport, Unsubscribe } from '@/application/ports/MessageTransport'
import type { DiscoveryProgress } from '@/application/ports/PeerDiscovery'
import { ConnectionState, retryDelayMillis } from '@/domain/connection/ConnectionState'
import type { LinkKind } from '@/domain/connection/LinkKind'
import type { LinkQuality } from '@/domain/connection/LinkQuality'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'
import type { ConnectionRole } from './DiscoveryPlan'
import { TcpMessageTransport } from './TcpMessageTransport'
import { WifiPeerDiscovery } from './WifiPeerDiscovery'

/**
 * 상대를 찾고, 붙고, 끊기면 다시 붙는다.
 *
 * **이게 없으면 메시지가 오가지 않는다.**
 *
 *   · 붙는 쪽은 상대 주소를 모른다. 찾아야 한다
 *   · 한 번 끊기면 스스로 다시 붙어야 한다. 비행 중에 사용자가
 *     뭘 눌러야 한다면 그건 실패한 설계다
 *
 * `TcpMessageTransport` 는 "이미 아는 주소에 붙는" 일만 한다.
 * 찾기와 다시 붙기를 여기서 얹는다.
 */
export class WifiLink implements MessageTransport {
  readonly kind: LinkKind = 'wifi'

  private inner: TcpMessageTransport
  private innerSubscriptions: Unsubscribe[] = []

  private readonly receiveHandlers = new Set<(envelope: Envelope) => void>()
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>()
  private readonly progressHandlers = new Set<(progress: DiscoveryProgress) => void>()

  private state = ConnectionState.idle()
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** 사용자가 껐는가. 껐으면 다시 붙지 않는다 */
  private stopped = false
  private connecting = false

  constructor(
    private readonly role: ConnectionRole,
    private readonly options: WifiLinkOptions = {},
  ) {
    this.inner = new TcpMessageTransport(role)
  }

  async connect(): Promise<Result<void, DomainError>> {
    this.stopped = false
    return this.attemptConnect()
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    this.cancelRetry()
    this.detachInner()
    await this.inner.disconnect()

    const stopped = this.state.stop()
    if (stopped.ok) this.setState(stopped.value)
  }

  async send(envelope: Envelope): Promise<Result<void, DomainError>> {
    // Wi-Fi 는 봉투 하나가 순식간이라 진행을 알릴 것이 없다
    return this.inner.send(envelope)
  }

  onReceive(handler: (envelope: Envelope) => void): Unsubscribe {
    this.receiveHandlers.add(handler)
    return () => this.receiveHandlers.delete(handler)
  }

  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }

  /** 찾는 동안 무엇을 하는 중인지. 화면에 보여준다 */
  onProgress(handler: (progress: DiscoveryProgress) => void): Unsubscribe {
    this.progressHandlers.add(handler)
    return () => this.progressHandlers.delete(handler)
  }

  currentState(): ConnectionState {
    return this.state
  }

  quality(): LinkQuality {
    return this.inner.quality()
  }

  /** 사용자가 "다시 연결하기"를 눌렀다. 기다리지 않고 지금 시도한다 */
  async retryNow(): Promise<Result<void, DomainError>> {
    this.cancelRetry()
    this.attempt = 0
    return this.connect()
  }

  // --- 안쪽 ---

  private async attemptConnect(): Promise<Result<void, DomainError>> {
    if (this.stopped || this.connecting) return ok(undefined)
    this.connecting = true

    try {
      const searching = this.state.startSearching()
      if (searching.ok) this.setState(searching.value)

      // 받는 쪽은 찾을 필요가 없다. 그냥 기다린다.
      const address = this.role === 'host' ? null : await this.findPeer()

      if (this.role === 'guest' && address === null) {
        this.scheduleRetry()
        return err(domainError('not-found', '상대를 찾지 못했다', 'discovery'))
      }

      this.detachInner()
      this.inner = new TcpMessageTransport(this.role, {
        peerAddress: address ?? undefined,
      })
      this.attachInner()

      const opened = await this.inner.connect()
      if (!opened.ok) {
        this.scheduleRetry()
        return opened
      }

      this.attempt = 0
      return ok(undefined)
    } finally {
      this.connecting = false
    }
  }

  /** 상대를 찾는다. 못 찾으면 null */
  private async findPeer(): Promise<string | null> {
    if (this.options.peerAddress !== undefined) return this.options.peerAddress

    let found: string | null = null

    const discovery = new WifiPeerDiscovery()

    const stopFound = discovery.onFound(peer => {
      found = peer.address
    })
    const stopProgress = discovery.onProgress(progress => {
      for (const handler of this.progressHandlers) handler(progress)
    })

    await discovery.start()
    await discovery.stop()

    stopFound()
    stopProgress()

    return found
  }

  private attachInner(): void {
    this.innerSubscriptions = [
      this.inner.onReceive(envelope => {
        for (const handler of this.receiveHandlers) handler(envelope)
      }),
      this.inner.onStateChange(state => {
        this.setState(state)

        // 끊겼다. 스스로 다시 붙는다.
        if (!state.isUsable() && state.phase !== 'idle' && !this.stopped) {
          this.scheduleRetry()
        }
      }),
    ]
  }

  private detachInner(): void {
    for (const stop of this.innerSubscriptions) stop()
    this.innerSubscriptions = []
  }

  /**
   * 다음 시도까지 기다린다.
   *
   * 1, 2, 4, 8, 16, 30초로 늘린다. 계속 시도하면 배터리가 준다.
   * 비행 시간 내내 켜둬야 하므로 이게 중요하다.
   */
  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null) return

    this.attempt += 1
    const delay = retryDelayMillis(this.attempt)

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.attemptConnect()
    }, delay)
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private setState(next: ConnectionState): void {
    this.state = next
    for (const handler of this.stateHandlers) handler(next)
  }
}

export interface WifiLinkOptions {
  /** 이미 아는 주소. 시험할 때 넘긴다 */
  readonly peerAddress?: string
}
