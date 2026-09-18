import type { Envelope } from '@/application/ports/Envelope'
import type { MessageTransport, Unsubscribe } from '@/application/ports/MessageTransport'
import { SerialQueue } from '@/application/shared/SerialQueue'
import { ConnectionState } from '@/domain/connection/ConnectionState'
import type { LinkKind } from '@/domain/connection/LinkKind'
import { LinkQuality, shouldSwitch } from '@/domain/connection/LinkQuality'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'

/**
 * 여러 길을 하나처럼 보이게 한다.
 *
 * 이것도 `MessageTransport` 약속을 지키므로 **위층은 이게 여러 길을 묶은
 * 것인지 모른다.** 나중에 길을 하나 더 붙여도 조립하는 곳 한 줄만 고친다.
 *
 * ```ts
 * new CompositeTransport([
 *   new TcpMessageTransport(role),   // 먼저
 *   new BleMessageTransport(),       // 안 되면 이것
 * ])
 * ```
 *
 * **갈아탈 때 지키는 순서가 이 파일의 핵심이다.**
 *
 *   1. 새 길을 연다           (옛 길은 아직 살아 있다)
 *   2. 보낼 것을 새 길로 돌린다
 *   3. 그제서야 옛 길을 놓는다
 *
 * 순서를 어기면 갈아타는 순간의 메시지가 사라진다.
 * (docs/04-transport-spec.md 6장)
 */
export class CompositeTransport implements MessageTransport {
  private active: MessageTransport | null = null
  private state = ConnectionState.idle()

  private readonly receiveHandlers = new Set<(envelope: Envelope) => void>()
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>()
  private readonly subscriptions = new Map<MessageTransport, Unsubscribe[]>()

  /** 갈아타는 동안 쌓아두는 것들 */
  private readonly outbox: Envelope[] = []

  /** 연결을 건드리는 일은 한 줄에 세운다. 갈아타기가 겹치면 양쪽을 다 놓친다 */
  private readonly queue = new SerialQueue()

  constructor(private readonly candidates: readonly MessageTransport[]) {
    if (candidates.length === 0) {
      throw new Error('길이 하나도 없이 만들 수 없다')
    }
  }

  /** 지금 쓰는 길. 아직 안 붙었으면 첫 후보의 종류를 말한다 */
  get kind(): LinkKind {
    return this.active?.kind ?? this.candidates[0]?.kind ?? 'wifi'
  }

  /**
   * 모든 길을 **같이 연다.**
   *
   * 전에는 순서대로 하나씩 해보고 먼저 되는 것에서 멈췄다. 그런데
   * **Wi-Fi 는 여는 쪽에서 늘 성공한다.** 상대가 없어도 서버를 띄우는
   * 것만으로 되기 때문이다. 그래서 블루투스는 시도조차 안 됐다.
   *
   * 비행기에서는 Wi-Fi 가 안 되므로 그 상태로 영영 안 이어진다.
   * 실제로 두 폰이 서로 못 찾았다.
   *
   * 그래서 열 수 있는 것은 다 열어두고 **먼저 진짜로 이어지는 쪽**을
   * 쓴다. "열렸다" 와 "이어졌다" 는 다르다.
   */
  async connect(): Promise<Result<void, DomainError>> {
    return this.queue.run(async () => {
      // **이미 이어져 있으면 건드리지 않는다.** 설정에서 이름을 바꾸면 화면이
      // 여기를 다시 부르는데, 그때마다 "찾는 중" 으로 돌아가 Wi-Fi 찾기가
      // 끝날 때까지 몇십 초 동안 끊긴 것처럼 보였다(2026-09-19).
      if (this.state.isUsable()) return ok(undefined)

      const searching = this.state.startSearching()
      if (searching.ok) this.setState(searching.value)

      const opened: MessageTransport[] = []

      for (const candidate of this.candidates) {
        const result = await candidate.connect()
        if (result.ok) opened.push(candidate)
        // **못 연 길도 지켜본다.** 길마다 스스로 다시 붙는 고리가 있어서
        // 지금 안 열렸어도 나중에 이어질 수 있다. 안 보고 있으면 그때
        // 아무도 모른다.
        this.watch(candidate)
      }

      if (opened.length === 0) {
        return err(domainError('not-found', '열 수 있는 길이 없다', 'transport'))
      }

      // 이미 이어진 것이 있으면 그것을, 없으면 가장 나은 것을 쓴다.
      // 나머지도 열린 채로 둔다. 그쪽이 먼저 이어지면 그때 갈아탄다.
      const live = opened.find(one => one.currentState().isUsable())
      const chosen = live ?? opened[0]
      if (chosen === undefined) {
        return err(domainError('not-found', '열 수 있는 길이 없다', 'transport'))
      }

      this.adopt(chosen)

      await this.drainOutbox()
      return ok(undefined)
    })
  }

  /**
   * 아직 안 고른 길도 지켜본다.
   *
   * 골라둔 길이 아직 안 이어졌는데 **다른 길이 먼저 이어지면 그리로
   * 옮긴다.** 비행기에서는 Wi-Fi 가 영영 안 이어지므로 이 갈아타기가
   * 곧 유일한 길이 된다.
   */
  private watch(candidate: MessageTransport): void {
    if (this.subscriptions.has(candidate)) return

    const off = candidate.onStateChange(state => {
      if (!state.isUsable()) return
      if (this.active === candidate) return
      // 이미 이어져 있는 길이 있으면 굳이 옮기지 않는다
      if (this.active?.currentState().isUsable() === true) return

      // **옛 길의 말을 더 듣지 않는다.** 붙는 쪽 Wi-Fi 는 상대를 못 찾는
      // 동안 몇 초마다 "찾는 중" 을 되뇌는데, 그대로 두면 블루투스로
      // 멀쩡히 이어진 뒤에도 그 소리에 "끊겼다" 로 바뀌어 말이 안 나간다.
      // 대신 지켜보기만 한다. 이쪽이 끊기고 그쪽이 이어지면 그때 옮긴다.
      const previous = this.active
      if (previous !== null) {
        this.unsubscribe(previous)
        this.watch(previous)
      }

      this.adopt(candidate)
      void this.drainOutbox()
    })

    this.subscriptions.set(candidate, [off])
  }

  async disconnect(): Promise<void> {
    await this.queue.run(async () => {
      for (const candidate of this.candidates) {
        this.unsubscribe(candidate)
        await candidate.disconnect()
      }

      this.active = null
      const stopped = this.state.stop()
      if (stopped.ok) this.setState(stopped.value)
    })
  }

  async send(
    envelope: Envelope,
    onProgress?: (fraction: number) => void,
  ): Promise<Result<void, DomainError>> {
    const active = this.active

    if (active === null || !this.state.isUsable()) {
      // 갈아타는 중이거나 아직 안 붙었다. 잃어버리지 않고 쌓아둔다.
      this.outbox.push(envelope)
      return err(domainError('not-found', '연결이 없어 대기 줄에 넣었다', 'transport'))
    }

    return active.send(envelope, onProgress)
  }

  onReceive(handler: (envelope: Envelope) => void): Unsubscribe {
    this.receiveHandlers.add(handler)
    return () => this.receiveHandlers.delete(handler)
  }

  /** 들어오는 봉투의 진행. 어느 길에서 오든 그대로 올린다 */
  onReceiveProgress(handler: (fraction: number) => void): Unsubscribe {
    const stops = this.candidates.map(
      one => one.onReceiveProgress?.(handler) ?? (() => undefined),
    )
    return () => {
      for (const stop of stops) stop()
    }
  }

  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }

  currentState(): ConnectionState {
    return this.state
  }

  quality(): LinkQuality {
    return this.active?.quality() ?? LinkQuality.unknown(this.kind)
  }

  /**
   * 더 좋은 길이 있는지 보고, 있으면 옮긴다.
   *
   * 점수가 충분히 높아야 옮긴다. 안 그러면 두 길 사이를 계속 오간다.
   */
  async considerSwitching(): Promise<Result<SwitchOutcome, DomainError>> {
    return this.queue.run(async () => {
      const current = this.active
      if (current === null) return ok({ switched: false, reason: 'no-active' } as const)

      const better = this.findBetter(current)
      if (better === null)
        return ok({ switched: false, reason: 'current-is-best' } as const)

      const switching = this.state.startSwitching(better.kind)
      if (!switching.ok) return switching
      this.setState(switching.value)

      // 1. 새 길을 먼저 연다. 옛 길은 아직 살아 있다.
      const opened = await better.connect()
      if (!opened.ok) {
        const back = this.state.abandonSwitch()
        if (back.ok) this.setState(back.value)
        return ok({ switched: false, reason: 'new-link-failed' } as const)
      }

      // 2. 보낼 것을 새 길로 돌린다.
      const previous = current
      this.adopt(better)

      // 3. 그제서야 옛 길을 놓는다.
      this.unsubscribe(previous)
      await previous.disconnect()

      await this.drainOutbox()

      return ok({ switched: true, from: previous.kind, to: better.kind } as const)
    })
  }

  private findBetter(current: MessageTransport): MessageTransport | null {
    for (const candidate of this.candidates) {
      if (candidate === current) continue
      if (shouldSwitch(current.quality(), candidate.quality())) return candidate
    }
    return null
  }

  private adopt(next: MessageTransport): void {
    // 지켜보기만 하던 귀를 뗀다. 안 떼면 같은 길을 두 귀로 듣는다.
    this.unsubscribe(next)
    this.active = next

    const unsubscribes: Unsubscribe[] = [
      next.onReceive(envelope => {
        for (const handler of this.receiveHandlers) handler(envelope)
      }),
      next.onStateChange(state => {
        // 갈아타는 중에는 아래쪽 상태를 그대로 따르지 않는다.
        // 옛 길이 끊기는 것은 우리가 일부러 한 일이다.
        if (this.state.phase === 'switching') return

        if (!state.isUsable() && this.state.isUsable()) {
          const lost = this.state.lose()
          if (lost.ok) this.setState(lost.value)
          return
        }

        if (state.isSettled() && !this.state.isSettled()) {
          const established = this.toConnected(next.kind)
          if (established.ok) this.setState(established.value)
        }
      }),
    ]

    this.subscriptions.set(next, unsubscribes)

    /*
      **고른 것만으로 이어진 게 아니다.**

      전에는 고르는 순간 "연결됨" 으로 바꿨다. 그런데 여는 쪽의 Wi-Fi 는
      상대가 없어도 서버를 띄우는 것만으로 열린다. 그래서 아무도 없는데
      화면에는 "이어져 있어요" 가 떴고, 말을 보내면 안 갔다.
      **거짓말하는 화면이 안 되는 화면보다 나쁘다.**

      진짜로 이어졌을 때만 바꾼다. 아직이면 찾는 중 그대로 두고,
      이어지는 순간 위의 `onStateChange` 가 바꿔준다.
    */
    if (!next.currentState().isUsable()) return

    const established = this.toConnected(next.kind)
    if (established.ok) this.setState(established.value)
  }

  private toConnected(kind: LinkKind): Result<ConnectionState, DomainError> {
    if (this.state.phase === 'switching') return this.state.establish()

    if (this.state.phase === 'searching') {
      const handshaking = this.state.startHandshake(kind)
      if (!handshaking.ok) return handshaking
      return handshaking.value.establish()
    }

    if (this.state.phase === 'handshaking') return this.state.establish()

    return ok(ConnectionState.connected(kind))
  }

  private unsubscribe(transport: MessageTransport): void {
    for (const stop of this.subscriptions.get(transport) ?? []) stop()
    this.subscriptions.delete(transport)
  }

  private setState(next: ConnectionState): void {
    this.state = next
    for (const handler of this.stateHandlers) handler(next)
  }

  /** 쌓아둔 것을 내보낸다. 순서 그대로 하나씩 */
  private async drainOutbox(): Promise<void> {
    while (this.outbox.length > 0) {
      const next = this.outbox[0]
      if (next === undefined) break

      const sent = await this.active?.send(next)
      if (sent === undefined || !sent.ok) break

      this.outbox.shift()
    }
  }

  /** 아직 못 보낸 것이 몇 개인가. 화면에 표시할 때 쓴다 */
  pendingCount(): number {
    return this.outbox.length
  }

  /**
   * 지금 당장 다시 붙는다.
   *
   * 앱이 앞으로 돌아왔거나 사용자가 "다시 연결하기"를 눌렀을 때 쓴다.
   * 기다리는 간격을 건너뛴다.
   */
  async reconnectNow(): Promise<Result<void, DomainError>> {
    if (this.state.isUsable()) return ok(undefined)

    for (const candidate of this.candidates) {
      const retryable = candidate as {
        retryNow?: () => Promise<Result<void, DomainError>>
      }
      if (typeof retryable.retryNow === 'function') {
        const result = await retryable.retryNow()
        if (result.ok) return result
      }
    }

    return this.connect()
  }
}

export type SwitchOutcome =
  | { readonly switched: true; readonly from: LinkKind; readonly to: LinkKind }
  | {
      readonly switched: false
      readonly reason: 'no-active' | 'current-is-best' | 'new-link-failed'
    }
