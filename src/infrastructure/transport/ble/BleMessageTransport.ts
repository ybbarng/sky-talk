import { loadBlePeripheral } from '@ble/index'
import type { Envelope } from '@/application/ports/Envelope'
import { worthSendingOnNarrowLink } from '@/application/ports/Envelope'
import type { MessageTransport, Unsubscribe } from '@/application/ports/MessageTransport'
import { ConnectionState, retryDelayMillis } from '@/domain/connection/ConnectionState'
import { LinkQuality } from '@/domain/connection/LinkQuality'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'
import { decodeEnvelope, encodeEnvelope } from '../protocol/EnvelopeSchema'
import type { ConnectionRole } from '../wifi/DiscoveryPlan'
import { base64ToBytes, bytesToBase64 } from './base64'
import { BLE_UUIDS, loadBle } from './bleModule'
import { askForBluetooth } from './blePermission'
import { CONSERVATIVE_MTU, chunk, decodeChunk, encodeChunk } from './chunk/Chunker'
import { Reassembler } from './chunk/Reassembler'

/**
 * 블루투스로 글을 나른다.
 *
 * **비행기 안에서는 이것이 유일한 길이다.** 갤럭시는 비행기 모드에서
 * Wi-Fi 를 손으로 켜도 핫스팟 메뉴가 잠긴다(2026-09-18 실제 기기 확인).
 * 블루투스 테더링만 열리는데 아이폰은 거기 들어갈 방법이 없다.
 * 그래서 **앱끼리 직접 잇는 이 길** 말고는 남는 것이 없다.
 *
 * Wi-Fi 는 집에서 준비하고 시험할 때 쓴다.
 *
 * 역할은 **여는 쪽이 알리고 붙는 쪽이 찾는다.** 운영체제로 가르지 않는다.
 * 왜 그런지는 `preferredRole` 에 적어뒀다.
 * 그쪽이 안 되면 **반대로 돌아선다**(`connect`).
 *
 * ## 열렸다는 것과 이어졌다는 것은 다르다
 *
 * `connect()` 가 성공하면 **무전기가 켜진 것**이다. 알리는 쪽은 알리기
 * 시작했고, 찾는 쪽은 찾기 시작했다. 상대가 나타나 실제로 이어지면
 * `onStateChange` 로 알린다. 그때까지는 "찾는 중" 이다.
 *
 * 한 번 켜지면 **스스로 계속 찾고, 끊기면 다시 찾는다.** 비행기에서는
 * 사용자가 뭘 눌러야 한다면 그건 실패한 설계다.
 *
 * ## 글만 간다
 *
 * 사진과 낙서는 안 보낸다. 한 번에 185바이트씩 가는 길로 몇백 KB 를
 * 밀어 넣으면 **글이 몇 분 동안 막힌다.** Wi-Fi 가 열릴 때까지 기다린다.
 *
 * ## 없으면 없는 대로 둔다
 *
 * 모듈이 없거나 빌드가 어긋났으면 `connect()` 가 실패할 뿐이다.
 * 여기서 앱이 죽으면 Wi-Fi 로도 못 쓰게 된다.
 *
 * (docs/04-transport-spec.md 4장 · T20)
 */
export class BleMessageTransport implements MessageTransport {
  readonly kind = 'ble' as const

  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 타입이다
  private manager: any = null
  // biome-ignore lint/suspicious/noExplicitAny: 위와 같다
  private device: any = null

  private state = ConnectionState.idle()
  private readonly receivers = new Set<(envelope: Envelope) => void>()
  private readonly watchers = new Set<(state: ConnectionState) => void>()
  private readonly receiveProgressWatchers = new Set<(fraction: number) => void>()
  private readonly reassembler = new Reassembler()
  private readonly subscriptions: Array<{ remove(): void }> = []

  private bundle = 0
  private mtu = CONSERVATIVE_MTU

  /** 무전기가 켜져 있나. 켜져 있으면 `connect()` 를 다시 불러도 아무것도 안 한다 */
  private opened = false

  /**
   * 몇 번째로 켠 것인가.
   *
   * 찾기는 뒤에서 계속 도는 고리다. 닫았다가 다시 켜면 옛 고리가 아직
   * 돌고 있을 수 있는데, 그것이 새 무전기를 건드리면 안 된다. 고리마다
   * 자기 번호를 들고 있다가 번호가 바뀌면 조용히 빠진다.
   */
  private epoch = 0

  /**
   * 지금 맡고 있는 쪽. 붙고 나서 끊을 때 어느 쪽을 정리할지 가른다.
   *
   * 처음에는 제자리(`preferredRole`)로 시작하지만 **안 되면 반대로
   * 돌아선다.** 그래서 고정값이 아니다.
   */
  private role: 'advertiser' | 'scanner'

  /**
   * 핫스팟을 열던 쪽(안드로이드)이 알리고, 들어가던 쪽(아이폰)이 찾는다.
   *
   * **운영체제로 정하지 않는다.** 예전에는 `Platform.OS` 로 갈라서
   * 아이폰이 늘 알리는 쪽이었는데, 그러면 두 가지가 막힌다.
   *
   * 하나, 아이폰 앱이 뒤로 가면 안드로이드가 다시 못 찾는다(4.1.1).
   * 둘, 안드로이드 두 대면 **둘 다 찾기만 하다 영영 못 만난다.**
   *
   * 맡은 역할로 가르면 둘 다 풀린다. 여는 쪽은 뒤에서도 계속 알릴 수
   * 있고(앞쪽 알림), 붙는 쪽은 뒤에서도 정해둔 서비스 번호로 찾을 수 있다.
   */
  private get preferredRole(): 'advertiser' | 'scanner' {
    return this.linkRole === 'host' ? 'advertiser' : 'scanner'
  }

  constructor(private readonly linkRole: ConnectionRole) {
    this.role = this.preferredRole
  }

  /**
   * 무전기를 켠다. 제자리로 먼저, 안 되면 반대로.
   *
   * ## 왜 둘을 동시에 하지 않나
   *
   * 양쪽이 동시에 알리고 동시에 찾으면 **연결이 두 개 생길 수 있다.**
   * 내 쪽에서 상대로 하나, 상대 쪽에서 나로 하나. 그러면 같은 말이 두 번
   * 오가고 어느 쪽을 끊어야 할지도 애매해진다. 비행기에서 이런 것이
   * 꼬이면 손쓸 수 없다.
   *
   * 차례로 하면 얻는 것은 같다. 길이 둘이고, 한 번에 하나만 산다.
   *
   * ## 반대로 돌아서는 것이 언제 쓸모 있나
   *
   * 알리는 장치가 없는 안드로이드가 있다. 아이폰도 다른 앱이 이미
   * 알리고 있으면 자리를 못 잡는다. 그때 **가만히 있는 대신 반대쪽을
   * 해본다.** 상대가 마침 그 반대를 하고 있으면 만난다.
   *
   * ## 돌아서면 안 되는 때
   *
   * **블루투스가 꺼져 있거나 권한이 없으면 돌아서지 않는다.** 반대쪽도
   * 똑같이 안 되기 때문이다. 그런데도 돌아서면 아이폰은 알리기가
   * "됐다" 고 답해서(켜지기 전에도 받아준다) 알리는 쪽으로 굳어버리고,
   * 나중에 블루투스를 켜도 **둘 다 알리기만 하고 아무도 안 찾는다.**
   * 실제로 그렇게 두 폰이 영영 못 만났다(2026-09-19).
   */
  async connect(): Promise<Result<void, DomainError>> {
    // 이미 켜져 있다. 다시 켜면 듣는 귀가 두 개가 되어 같은 말을 두 번 듣는다.
    if (this.opened) return ok(undefined)

    this.moveTo(this.state.startSearching())

    const first = await this.open(this.preferredRole)
    if (first.ok) return first
    if (first.error.code === 'not-allowed') return first

    const other = this.preferredRole === 'advertiser' ? 'scanner' : 'advertiser'
    const second = await this.open(other)

    // 둘 다 안 되면 **먼저 시도한 쪽의 까닭**을 올린다. 그쪽이 제자리라
    // 화면에 띄울 말로도 맞다.
    return second.ok ? second : first
  }

  private async open(as: 'advertiser' | 'scanner'): Promise<Result<void, DomainError>> {
    this.role = as
    const opened = as === 'advertiser' ? await this.advertise() : await this.scan()

    // **실패하면 반쯤 열린 것을 반드시 닫는다.** 안 닫고 반대쪽을
    // 시작하면 두 역할이 겹쳐서 무전기가 서로를 방해한다.
    if (!opened.ok) await this.teardown()
    else this.opened = true

    return opened
  }

  async disconnect(): Promise<void> {
    await this.teardown()
    this.moveTo(this.state.stop())
  }

  /**
   * 열어둔 것을 전부 닫는다. **상태는 안 건드린다.**
   *
   * 끊을 때도 쓰고, 한쪽으로 붙어보다 실패해서 반대쪽으로 돌아설 때도
   * 쓴다. 뒤엣경우에는 아직 "끊김" 이 아니라 "찾는 중" 이라 상태를
   * 바꾸면 화면이 깜빡인다.
   */
  private async teardown(): Promise<void> {
    // 뒤에서 도는 찾기 고리를 멈춘다. 번호가 바뀌면 고리가 알아서 빠진다.
    this.epoch += 1
    this.opened = false

    this.dropSubscriptions()
    this.reassembler.clear()

    try {
      if (this.role === 'advertiser') {
        const peripheral = loadBlePeripheral()
        if (peripheral.available) await peripheral.module.stop()
      } else {
        try {
          this.manager?.stopDeviceScan?.()
        } catch {
          // 이미 멈췄다
        }
        await this.device?.cancelConnection?.()
        // 관리자는 부수지 않는다. 앱에 하나뿐이라 화면의 블루투스 상태
        // 읽기(`bluetoothState.ts`)와 같은 것을 쓴다. 부수면 그쪽도 죽는다.
      }
    } catch {
      // 이미 끊겼다
    }

    this.device = null
    this.manager = null
  }

  private dropSubscriptions(): void {
    for (const subscription of this.subscriptions) {
      try {
        subscription.remove()
      } catch {
        // 이미 떨어졌다
      }
    }
    this.subscriptions.length = 0
  }

  async send(
    envelope: Envelope,
    onProgress?: (fraction: number) => void,
  ): Promise<Result<void, DomainError>> {
    // **좁은 길을 실제 대화에 양보한다.** 입력 중 표시와 사진 조각은
    // 여기로 안 보낸다.
    if (!worthSendingOnNarrowLink(envelope.t)) return ok(undefined)

    const encoded = encodeEnvelope(envelope)
    if (!encoded.ok) return encoded

    const payload = new TextEncoder().encode(encoded.value)
    const parts = chunk(payload, this.bundle, this.mtu)
    if (!parts.ok) return parts

    this.bundle = (this.bundle + 1) % 256

    // **사진·음성 조각은 글에 양보한다.** 알리는 쪽은 조각을 줄에 세우기만
    // 하면 되므로 360조각을 한꺼번에 밀어 넣을 수 있는데, 그러면 그 뒤에
    // 보낸 글이 몇십 초 동안 줄 뒤에서 기다린다. 줄이 짧을 때만 다음
    // 조각을 넣으면 글은 몇 조각 뒤에 바로 끼어든다.
    const gentle = envelope.t === 'asset_chunk'

    for (const part of parts.value) {
      if (gentle) await this.waitForShortQueue()
      const sent = await this.writeRaw(encodeChunk(part))
      // **하나가 실패하면 멈춘다.** 계속 밀어 넣으면 조용히 버려지고,
      // 상대는 반쪽짜리 묶음을 5초 들고 있다 버린다.
      if (!sent) {
        return err(domainError('not-found', '블루투스로 보내지 못했다', 'ble'))
      }
      // 사진 조각 하나가 몇백 조각이라 이걸 안 알리면 화면이 한참 멈춘다
      onProgress?.((part.index + 1) / part.total)
    }

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

  onReceiveProgress(handler: (fraction: number) => void): Unsubscribe {
    this.receiveProgressWatchers.add(handler)
    return () => this.receiveProgressWatchers.delete(handler)
  }

  currentState(): ConnectionState {
    return this.state
  }

  quality(): LinkQuality {
    // 블루투스는 늘 좁다. 재보지 않아도 안다.
    return LinkQuality.unknown('ble')
  }

  /** 알리는 쪽을 맡는다. 상대가 찾아오기를 기다린다 */
  private async advertise(): Promise<Result<void, DomainError>> {
    // **묻는 것이 먼저다.** 알리기도 찾기와 똑같이 권한이 있어야 한다.
    // 없으면 예외도 안 나고 그냥 아무도 우리를 못 본다.
    const allowed = await askForBluetooth()
    if (!allowed.ok) return allowed

    const peripheral = loadBlePeripheral()
    if (!peripheral.available) {
      return err(domainError('not-found', peripheral.why, 'ble'))
    }

    try {
      this.subscriptions.push(
        peripheral.module.addListener('onReceive', event => {
          this.onRaw(base64ToBytes(event.data))
        }),
      )

      this.subscriptions.push(
        peripheral.module.addListener('onSubscribe', event => {
          if (event.subscribed) {
            // 상대가 알려준 크기에 맞춘다. 넘기면 조용히 잘린다.
            if (event.mtu > 0) this.mtu = Math.min(event.mtu, CONSERVATIVE_MTU)
            this.moveTo(this.state.startHandshake('ble'))
            this.moveTo(this.state.establish())
          } else {
            // 상대가 떨어졌다. 알리기는 계속되므로 다시 찾아오면 붙는다.
            this.reassembler.clear()
            this.moveTo(this.state.lose())
          }
        }),
      )

      // **돌려주는 값을 본다.** 안 보면 알리기가 실패했는데도 열린
      // 것으로 치고, 아무도 우리를 못 보는 채로 기다리게 된다.
      const started = await peripheral.module.start('Skywalkie')
      if (started !== true) {
        return err(domainError('not-found', '블루투스로 알리지 못했다', 'ble'))
      }

      return ok(undefined)
    } catch (cause) {
      return err(wrap(cause, '블루투스로 알리지 못했다'))
    }
  }

  /**
   * 찾는 쪽을 맡는다. 알리고 있는 상대를 뒤진다.
   *
   * **켜질 때까지 기다렸다가 찾는다.** 아이폰은 무전기를 만든 직후
   * 상태가 "모름" 인데, 그때 찾기를 시작하면 **즉시 오류로 끝난다.**
   * 예전에는 그 오류를 "찾기가 안 된다" 로 보고 알리는 쪽으로 돌아섰고,
   * 그래서 두 폰이 다 알리기만 했다(2026-09-19).
   *
   * 켜진 것을 보면 찾기 고리를 돌리고 바로 돌아온다. 이어지는 것은
   * 고리가 `onStateChange` 로 알린다.
   */
  private async scan(): Promise<Result<void, DomainError>> {
    // **묻는 것이 먼저다.** 권한 없이 찾기를 시작하면 오류도 안 나고
    // 결과만 영영 안 온다. 그러면 "상대를 못 찾았다" 로만 보인다.
    const allowed = await askForBluetooth()
    if (!allowed.ok) return allowed

    const ble = loadBle()
    if (!ble.available) return err(domainError('not-found', ble.why, 'ble'))

    try {
      this.manager = new ble.module.BleManager()
    } catch (cause) {
      return err(wrap(cause, '블루투스를 열지 못했다'))
    }

    const ready = await this.waitUntilPoweredOn()
    if (!ready.ok) return ready

    void this.keepLooking(this.epoch)
    return ok(undefined)
  }

  /**
   * 블루투스가 켜질 때까지 기다린다.
   *
   * "모름" 과 "다시 켜는 중" 은 곧 답이 오므로 기다린다. 꺼져 있거나
   * 권한이 없거나 아예 못 쓰면 **무엇을 누르면 되는지** 적어서 돌려준다.
   * 이 셋은 반대쪽으로 돌아서도 똑같이 안 되므로 `not-allowed` 로 알린다.
   */
  private waitUntilPoweredOn(): Promise<Result<void, DomainError>> {
    return new Promise(resolve => {
      let settled = false
      let subscription: { remove(): void } | null = null

      const finish = (result: Result<void, DomainError>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          subscription?.remove()
        } catch {
          // 이미 떨어졌다
        }
        resolve(result)
      }

      const timer = setTimeout(() => {
        finish(err(domainError('not-allowed', BLUETOOTH_NOT_READY, 'ble')))
      }, POWER_ON_TIMEOUT_MS)

      try {
        subscription = this.manager.onStateChange((state: string) => {
          if (state === 'PoweredOn') {
            finish(ok(undefined))
            return
          }

          const blocked = BLUETOOTH_BLOCKED[state]
          if (blocked !== undefined) {
            finish(err(domainError('not-allowed', blocked, 'ble')))
          }
          // 모름 · 다시 켜는 중 → 곧 답이 온다. 기다린다.
        }, true)
      } catch (cause) {
        finish(err(wrap(cause, '블루투스 상태를 못 읽었다')))
      }
    })
  }

  /**
   * 찾고, 붙고, 끊기면 다시 찾는다. 무전기를 끌 때까지 돈다.
   *
   * 한 바퀴에 얼마 동안 찾다가 잠깐 쉬고 다시 찾는다. **못 찾았다고
   * 접지 않는다.** 상대가 아직 앱을 안 켰을 수도 있고, 화장실에 갔을
   * 수도 있다. 접으면 사용자가 뭔가를 눌러야 하는데, 비행기에서는
   * 그걸 알 길이 없다.
   *
   * 오류가 나면(블루투스가 꺼졌다든가) 점점 길게 쉰다. 안드로이드는
   * 30초에 다섯 번 넘게 찾기를 시작하면 한동안 아무것도 안 준다.
   */
  private async keepLooking(epoch: number): Promise<void> {
    let failures = 0

    while (this.alive(epoch)) {
      const round = await this.scanOnce()
      if (!this.alive(epoch)) return

      if (round.kind === 'found') {
        const attached = await this.attach(round.device, epoch)
        if (attached) return
        failures += 1
      } else if (round.kind === 'error') {
        failures += 1
      } else {
        failures = 0
      }

      await pause(failures === 0 ? SCAN_PAUSE_MS : retryDelayMillis(failures))
    }
  }

  private alive(epoch: number): boolean {
    return this.epoch === epoch && this.manager !== null && this.role === 'scanner'
  }

  /** 한 바퀴 찾는다. 찾으면 그 기기를, 시간이 다 되면 아무것도, 오류면 오류를 */
  private scanOnce(): Promise<ScanRound> {
    return new Promise(resolve => {
      let settled = false

      const finish = (round: ScanRound) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          this.manager?.stopDeviceScan?.()
        } catch {
          // 이미 멈췄다
        }
        resolve(round)
      }

      // 한참 못 찾으면 한 바퀴 접고 잠깐 쉰다. 계속 붙들고 있으면 배터리만 준다.
      const timer = setTimeout(() => finish({ kind: 'nobody' }), SCAN_TIMEOUT_MS)

      try {
        this.manager.startDeviceScan(
          [BLE_UUIDS.service],
          null,
          // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 타입이다
          (error: any, device: any) => {
            if (error !== null && error !== undefined) {
              finish({ kind: 'error', why: describe(error) })
              return
            }
            if (device === null || device === undefined) return
            finish({ kind: 'found', device })
          },
        )
      } catch (cause) {
        finish({ kind: 'error', why: describe(cause) })
      }
    })
  }

  /** 찾은 상대에게 붙는다. 붙었으면 true */
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 타입이다
  private async attach(found: any, epoch: number): Promise<boolean> {
    try {
      this.moveTo(this.state.startHandshake('ble'))

      const device = await found.connect()
      await device.discoverAllServicesAndCharacteristics()

      // 붙는 동안 무전기를 껐을 수 있다. 그러면 놓아준다.
      if (!this.alive(epoch)) {
        await device.cancelConnection?.()
        return false
      }

      this.device = device

      const negotiated = await device.requestMTU?.(CONSERVATIVE_MTU)
      if (typeof negotiated?.mtu === 'number') {
        this.mtu = Math.min(negotiated.mtu, CONSERVATIVE_MTU)
      }

      this.subscriptions.push(
        device.monitorCharacteristicForService(
          BLE_UUIDS.service,
          BLE_UUIDS.outbox,
          // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 타입이다
          (error: any, characteristic: any) => {
            if (error !== null || characteristic?.value == null) return
            this.onRaw(base64ToBytes(characteristic.value))
          },
        ),
      )

      // **끊기면 다시 찾는다.** 엘리베이터에서 내리면 몇 초 안에 다시 붙어야 한다.
      if (typeof device.onDisconnected === 'function') {
        this.subscriptions.push(
          device.onDisconnected(() => {
            if (!this.alive(epoch) || this.device !== device) return
            this.dropSubscriptions()
            this.reassembler.clear()
            this.device = null
            this.moveTo(this.state.lose())
            void this.keepLooking(epoch)
          }),
        )
      }

      this.moveTo(this.state.establish())
      return true
    } catch {
      // 붙다가 놓쳤다. 고리가 다시 찾는다.
      this.device = null
      this.moveTo(this.state.lose())
      return false
    }
  }

  /** 알리는 쪽의 줄이 짧아질 때까지 기다린다. 찾는 쪽은 쓰기마다 답을 받아 줄이 없다 */
  private async waitForShortQueue(): Promise<void> {
    if (this.role !== 'advertiser') return
    const peripheral = loadBlePeripheral()
    if (!peripheral.available || typeof peripheral.module.queued !== 'function') return

    for (let waited = 0; waited < QUEUE_WAIT_MAX_MS; waited += QUEUE_POLL_MS) {
      let queued = 0
      try {
        queued = peripheral.module.queued()
      } catch {
        return
      }
      if (queued <= QUEUE_HIGH_WATER) return
      await pause(QUEUE_POLL_MS)
    }
  }

  private async writeRaw(raw: Uint8Array): Promise<boolean> {
    const base64 = bytesToBase64(raw)

    try {
      if (this.role === 'advertiser') {
        const peripheral = loadBlePeripheral()
        if (!peripheral.available) return false
        return await peripheral.module.send(base64)
      }

      if (this.device === null) return false
      // **응답을 받는 쓰기다.** 응답 없는 쓰기는 상대 버퍼가 차면 조용히
      // 버려지는데, 조각 하나가 빠지면 봉투가 통째로 안 모인다. 사진을
      // 나르기 시작하면서 바꿨다. 느려도 빠지지 않는 쪽이 낫다.
      await this.device.writeCharacteristicWithResponseForService(
        BLE_UUIDS.service,
        BLE_UUIDS.inbox,
        base64,
      )
      return true
    } catch {
      return false
    }
  }

  /** 조각이 왔다. 다 모이면 봉투로 바꿔 올린다 */
  private onRaw(raw: Uint8Array): void {
    const part = decodeChunk(raw)
    // 이상한 조각은 버리되 **연결은 끊지 않는다.** 같은 방의 다른
    // 기기가 보낸 것일 수 있다.
    if (!part.ok) return

    const joined = this.reassembler.accept(part.value, Date.now())
    if (joined === null) {
      // 아직 모으는 중. 받는 쪽 화면이 퍼센트를 그릴 수 있게 알린다.
      const fill = this.reassembler.fill(part.value.bundle)
      if (fill !== null) {
        for (const watcher of this.receiveProgressWatchers) {
          try {
            watcher(fill)
          } catch {
            // 듣는 쪽 잘못이다
          }
        }
      }
      return
    }

    const outcome = decodeEnvelope(new TextDecoder().decode(joined))
    // 모르는 봉투가 와도 끊지 않는다. 상대가 새 버전일 수 있다.
    if (outcome.kind !== 'ok') return

    for (const handler of this.receivers) {
      try {
        handler(outcome.envelope)
      } catch {
        // 듣는 쪽 잘못이다. 나머지에게는 계속 알린다.
      }
    }
  }

  private moveTo(result: Result<ConnectionState, DomainError>): void {
    if (!result.ok) return
    this.state = result.value

    for (const watcher of this.watchers) {
      try {
        watcher(result.value)
      } catch {
        // 위와 같다
      }
    }
  }
}

type ScanRound =
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 타입이다
  | { readonly kind: 'found'; readonly device: any }
  | { readonly kind: 'nobody' }
  | { readonly kind: 'error'; readonly why: string }

/** 한 바퀴에 이만큼 찾는다. 그 뒤 잠깐 쉬고 다시 찾는다 */
export const SCAN_TIMEOUT_MS = 20_000

/** 한 바퀴 돌고 쉬는 시간 */
export const SCAN_PAUSE_MS = 1_000

/** 알리는 쪽 줄에 이만큼 넘게 밀려 있으면 사진 조각을 더 안 넣는다 */
export const QUEUE_HIGH_WATER = 12
const QUEUE_POLL_MS = 25
/** 줄이 안 줄어도 이만큼 지나면 그냥 넣는다. 영영 멈추지는 않는다 */
const QUEUE_WAIT_MAX_MS = 10_000

/**
 * 켜지기를 이만큼 기다린다.
 *
 * 처음 쓸 때는 아이폰이 "블루투스를 써도 되나요" 창을 띄우고, 사용자가
 * 답할 때까지 상태가 "모름" 에 머문다. 그래서 넉넉히 둔다.
 */
export const POWER_ON_TIMEOUT_MS = 60_000

/** 화면에 띄울 말. **무엇을 누르면 되는지** 적는다 */
const BLUETOOTH_BLOCKED: Readonly<Record<string, string>> = {
  PoweredOff: '블루투스가 꺼져 있어요.\n제어 센터나 설정에서 블루투스를 켜주세요.',
  Unauthorized: '블루투스를 쓸 수 없어요.\n설정 → Skywalkie → 블루투스를 켜주세요.',
  Unsupported: '이 기기는 블루투스로 상대를 찾을 수 없어요.',
}

const BLUETOOTH_NOT_READY =
  '블루투스가 아직 준비되지 않았어요.\n블루투스를 껐다 켜고 다시 연결하기를 눌러주세요.'

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function wrap(cause: unknown, what: string): DomainError {
  return domainError('not-found', `${what}: ${describe(cause)}`, 'ble')
}
