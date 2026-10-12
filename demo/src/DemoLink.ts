import type { Envelope } from '@/application/ports/Envelope'
import type { MessageTransport, Unsubscribe } from '@/application/ports/MessageTransport'
import { ConnectionState, retryDelayMillis } from '@/domain/connection/ConnectionState'
import { LinkQuality } from '@/domain/connection/LinkQuality'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'
import {
  decodeEnvelope,
  encodeEnvelope,
} from '@/infrastructure/transport/protocol/EnvelopeSchema'
import { encodeFrame, HEARTBEAT } from '@/infrastructure/transport/protocol/FrameCodec'
import { FrameDecoder } from '@/infrastructure/transport/protocol/FrameDecoder'
import {
  batchTargets,
  planDiscovery,
  SCAN_BATCH_SIZE,
} from '@/infrastructure/transport/wifi/DiscoveryPlan'
import { parseIpv4 } from '@/infrastructure/transport/wifi/NetworkAddress'
import { CABIN_ADDRESS, type DemoLinkKind, type Side, type World } from './world'

/**
 * 가상 비행기 위에서 도는 길 하나. 블루투스이거나 Wi-Fi 다.
 *
 * 실제 앱의 `BleMessageTransport` · `WifiLink` 와 같은 자리에 들어가
 * 진짜 `CompositeTransport` 에 꽂힌다. 그래서 **두 길 사이를 옮겨 타는
 * 것은 앱 코드가 한다.** 봉투를 글로 바꾸고 길이를 붙이고 다시 읽는 것도
 * 진짜 코드다. 여기서 흉내 내는 것은 상대를 찾는 데 드는 시간과 선뿐이다.
 *
 * 앱과 같게 둔 것
 *
 *   · 찾는 것은 아이폰(거는 쪽)만 한다. 안드로이드는 알리고 기다린다
 *   · 블루투스는 못 찾아도 접지 않고 계속 찾는다
 *   · Wi-Fi 는 지난 주소 → 게이트웨이 → 가까운 곳부터 훑기 순으로 찾고,
 *     못 찾으면 1, 2, 4 … 30초 쉬었다 다시 찾는다(`retryDelayMillis`)
 *   · 받는 쪽 Wi-Fi 는 **첫 봉투가 와야** 상대로 친다
 *   · 이어져 있으면 5초마다 심장박동을 보낸다
 */

/** 블루투스로 상대를 찾아 붙는 데 드는 시간 */
const BLE_CONNECT_MS = 1400
/** 블루투스가 꺼져 있거나 상대가 없을 때 다시 볼 간격 */
const BLE_SCAN_TICK_MS = 1000
const HEARTBEAT_MS = 5000
/**
 * 끝까지 훑는 데 실제로는 몇 분이 든다. 데모에서는 이만큼만 기다리고
 * 실제 시간은 기록에 적는다.
 */
const DEMO_SCAN_CAP_MS = 4000

export class DemoLink implements MessageTransport {
  private state = ConnectionState.idle()
  private readonly decoder = new FrameDecoder()
  private readonly receivers = new Set<(envelope: Envelope) => void>()
  private readonly watchers = new Set<(state: ConnectionState) => void>()

  private stopped = true
  private busy = false
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  /** 받는 쪽 Wi-Fi: 봉투가 와서 상대로 쳤나 */
  private confirmed = false
  /** 거는 쪽 Wi-Fi: 지난번에 붙었던 주소 */
  private lastKnown: string | null = null

  /** 실제로 선을 탄 바이트. 화면에 얼마나 오갔는지 보여준다 */
  bytesOut = 0
  bytesIn = 0
  /** 형식 검사에 걸려 버린 것 */
  rejected = 0

  constructor(
    private readonly side: Side,
    readonly kind: DemoLinkKind,
    private readonly world: World,
  ) {
    world.plug(side, kind, {
      onBytes: bytes => this.onBytes(bytes),
      onCut: () => this.onCut(),
    })
  }

  private get finder(): boolean {
    return this.side === 'guest'
  }

  // --- MessageTransport ---

  async connect(): Promise<Result<void, DomainError>> {
    this.stopped = false
    this.moveTo(this.state.startSearching())

    if (this.kind === 'ble') {
      this.scheduleTick(0)
      // 꺼져 있어도 접지 않는다. 켜질 때까지 기다린다 (04 문서 4.1.3)
      return this.world.bluetoothOn[this.side]
        ? ok(undefined)
        : err(domainError('not-found', '블루투스가 꺼져 있어요', 'bluetooth'))
    }

    // 받는 쪽은 번호 51704 를 열고 기다린다
    if (!this.finder) return ok(undefined)

    this.scheduleTick(0)
    return ok(undefined)
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    this.clearTimers()
    this.moveTo(this.state.stop())
  }

  async send(envelope: Envelope): Promise<Result<void, DomainError>> {
    if (!this.state.isUsable()) {
      return err(domainError('not-found', '연결이 없다', 'transport'))
    }

    const encoded = encodeEnvelope(envelope)
    if (!encoded.ok) return encoded
    const framed = encodeFrame(encoded.value)
    if (!framed.ok) return framed

    if (!this.world.send(this.side, this.kind, framed.value)) {
      return err(domainError('not-found', '끊겨 있어요', 'transport'))
    }

    this.bytesOut += framed.value.byteLength
    this.world.note(this.side, `${envelope.t} 보냄 · ${framed.value.byteLength}B`, 'send', this.kind)
    return ok(undefined)
  }

  onReceive(handler: (envelope: Envelope) => void): Unsubscribe {
    this.receivers.add(handler)
    return () => this.receivers.delete(handler)
  }

  onStateChange(handler: (state: ConnectionState) => void): Unsubscribe {
    this.watchers.add(handler)
    return () => this.watchers.delete(handler)
  }

  currentState(): ConnectionState {
    return this.state
  }

  quality(): LinkQuality {
    return LinkQuality.unknown(this.kind)
  }

  /** 사람이 "다시 연결하기" 를 눌렀다. 기다리지 않고 지금 찾는다 */
  async retryNow(): Promise<Result<void, DomainError>> {
    this.attempt = 0
    this.scheduleTick(0)
    return ok(undefined)
  }

  // --- 찾기 ---

  private scheduleTick(delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, delay)
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.busy || this.state.isUsable()) return
    this.busy = true
    try {
      if (this.kind === 'ble') await this.tickBluetooth()
      else await this.tickWifi()
    } finally {
      this.busy = false
    }
  }

  /**
   * 블루투스. 알리는 쪽은 기다리고, 찾는 쪽은 계속 찾는다.
   *
   * 못 찾아도 접지 않는다. 끊겨도 다시 찾는다. **찾는 쪽만 움직인다.**
   */
  private async tickBluetooth(): Promise<void> {
    if (!this.finder) return

    if (!this.world.bluetoothOn.guest || !this.world.reachable('ble')) {
      this.scheduleTick(BLE_SCAN_TICK_MS)
      return
    }

    this.world.note('guest', '알리는 기기를 찾았어요. 붙어볼게요', 'info', 'ble')
    await sleep(BLE_CONNECT_MS)
    if (this.stopped) return

    if (!this.world.wire('ble')) {
      this.world.note('guest', '붙기 전에 멀어졌어요. 계속 찾을게요', 'warn', 'ble')
      this.scheduleTick(BLE_SCAN_TICK_MS)
      return
    }
    this.establish()
  }

  /**
   * Wi-Fi. **앱과 같은 순서로 찾는다.** 지난 주소 → 게이트웨이 → 가까운
   * 곳부터 훑기. 순서는 진짜 `planDiscovery` 가 정하고, 몇 번째 묶음에서
   * 찾았는지도 진짜 `scanTargets` 순서로 센다. (04 문서 2.3)
   */
  private async tickWifi(): Promise<void> {
    if (!this.world.wifiJoined.guest) {
      // 아직 Wi-Fi 주소가 없다. 실패로 세지 않고 조용히 다시 본다
      this.attempt = 0
      this.scheduleTick(BLE_SCAN_TICK_MS)
      return
    }

    const self = parseIpv4(CABIN_ADDRESS.guest)
    if (!self.ok) return
    const peer = CABIN_ADDRESS.host
    const steps = planDiscovery(self.value, this.lastKnown)

    for (const step of steps) {
      if (this.stopped || !this.world.wifiJoined.guest) break

      const index = step.targets.indexOf(peer)
      const answers = index >= 0 && this.world.reachable('wifi')

      if (step.method === 'scan') {
        const batches = batchTargets(step.targets).length
        if (answers) {
          const nth = Math.floor(index / SCAN_BATCH_SIZE) + 1
          this.world.note('guest', `내 주소 가까운 곳부터 훑는 중 · ${nth}번째 묶음에서 찾았어요`, 'info', 'wifi')
          await sleep(nth * step.timeoutMs)
          return this.dial(peer)
        }

        const realMs = batches * step.timeoutMs
        this.world.note(
          'guest',
          `가까운 곳부터 ${step.targets.length.toLocaleString()}곳을 훑는 중 (실제로는 약 ${Math.round(realMs / 60000)}분)`,
          'info',
          'wifi',
        )
        await sleep(Math.min(realMs, DEMO_SCAN_CAP_MS))
        this.world.note('guest', '끝까지 훑었지만 아무도 답하지 않아요', 'warn', 'wifi')
        continue
      }

      const where = step.method === 'gateway' ? '게이트웨이' : '지난번 주소'
      const target = step.targets[0] ?? ''
      if (answers) {
        await sleep(120)
        this.world.note('guest', `${where}(${target})에 걸었더니 답했어요`, 'info', 'wifi')
        return this.dial(peer)
      }

      await sleep(step.timeoutMs)
      this.world.note('guest', `${where}(${target})는 답이 없어요`, 'info', 'wifi')
    }

    if (this.stopped) return
    this.attempt += 1
    const delay = retryDelayMillis(this.attempt)
    this.world.note('guest', `${Math.round(delay / 1000)}초 뒤에 다시 찾아볼게요`, 'info', 'wifi')
    this.scheduleTick(delay)
  }

  private dial(peer: string): void {
    if (!this.world.wire('wifi')) {
      this.scheduleTick(retryDelayMillis(++this.attempt))
      return
    }
    this.lastKnown = peer
    this.attempt = 0
    // 거는 쪽은 내가 고른 주소에 걸었으니 붙는 순간 상대다
    this.establish()
  }

  // --- 선 ---

  /** 선이 이어졌다는 것은 거는 쪽이 `wire` 할 때 안다. 받는 쪽은 봉투로 안다 */
  private establish(): void {
    if (this.state.isUsable()) return
    if (this.state.phase !== 'searching') this.moveTo(this.state.startSearching())
    this.moveTo(this.state.startHandshake(this.kind))
    this.moveTo(this.state.establish())
    this.startHeartbeat()
  }

  private onBytes(bytes: Uint8Array): void {
    // 알리는 쪽 블루투스와 받는 쪽 Wi-Fi 는 첫 바이트로 상대를 안다
    if (!this.state.isUsable()) {
      if (this.kind === 'wifi' && !this.finder && !this.confirmed) {
        this.confirmed = true
        this.world.note('host', '첫 봉투가 왔어요. 상대로 칠게요', 'info', 'wifi')
      }
      this.establish()
    }

    this.bytesIn += bytes.byteLength
    const frames = this.decoder.push(bytes)
    if (!frames.ok) {
      this.world.cut(this.kind, '바이트가 망가졌어요')
      return
    }

    for (const payload of frames.value.payloads) {
      const outcome = decodeEnvelope(payload)
      if (outcome.kind !== 'ok') {
        // **모르는 봉투가 와도 끊지 않는다.** 상대가 다른 버전일 수 있다.
        this.rejected += 1
        this.world.note(this.side, `모르는 봉투를 버렸어요 (${outcome.kind})`, 'warn', this.kind)
        continue
      }
      this.world.note(this.side, `${outcome.envelope.t} 받음`, 'recv', this.kind)
      for (const handler of this.receivers) handler(outcome.envelope)
    }
  }

  private onCut(): void {
    this.confirmed = false
    this.decoder.reset()
    this.stopHeartbeat()
    if (this.state.isUsable() || this.state.phase === 'handshaking') {
      this.moveTo(this.state.lose())
    }
    // 찾는 쪽만 다시 찾는다. 알리는 쪽·받는 쪽은 그대로 기다린다
    if (this.finder && !this.stopped) {
      this.attempt = 0
      this.scheduleTick(this.kind === 'ble' ? BLE_SCAN_TICK_MS : retryDelayMillis(1))
    }
  }

  /**
   * 살아 있다는 신호. 받는 쪽은 이걸로 상대를 알아보기도 한다.
   *
   * 블루투스는 붙자마자 알리는 쪽이 안다(구독). 그래서 곧장 한 번 보낸다.
   * Wi-Fi 는 TCP 라 받는 쪽은 봉투가 와야 안다. 거는 쪽이 이 길을 쓰지
   * 않으면(블루투스로 이야기 중이면) 첫 심장박동까지 5초쯤 걸린다.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    const beat = () => this.world.send(this.side, this.kind, HEARTBEAT)
    if (this.kind === 'ble') beat()
    this.heartbeat = setInterval(beat, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private clearTimers(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.stopHeartbeat()
  }

  private moveTo(next: Result<ConnectionState, DomainError>): void {
    if (!next.ok) return
    this.state = next.value
    for (const watcher of this.watchers) watcher(next.value)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
