import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 무전기 자체는 시험할 수 없지만 **어느 쪽을 어떤 차례로 해보는지**,
 * **켜질 때까지 기다리는지**, **못 찾아도 계속 찾는지**는 여기서 확인할
 * 수 있다.
 *
 * 이 셋이 전부 실제로 깨졌던 것들이다(2026-09-19). 아이폰이 켜지기 전에
 * 찾기를 시작해 즉시 실패했고, 그 실패를 "찾기가 안 된다" 로 보고
 * 알리는 쪽으로 돌아서서 두 폰이 다 알리기만 했다.
 */

const peripheral = vi.hoisted(() => ({ available: false, why: '알리는 장치가 없다' }))
const central = vi.hoisted(() => ({ available: false, why: '찾는 모듈이 없다' }))
const asked = vi.hoisted(() => ({ allowed: true }))

vi.mock('@ble/index', () => ({
  loadBlePeripheral: () => peripheral,
}))

vi.mock('./bleModule', () => ({
  loadBle: () => central,
  BLE_UUIDS: {
    service: 'F7D5061F-298D-46DB-BE86-D1E0C757AB23',
    inbox: '0F52C6B6-FDDA-4E0C-886A-0BB1CA261494',
    outbox: '8966097A-CE16-4B4B-99C4-5DD2409FC9F7',
    status: 'F9F2387C-9014-4C34-AB13-EC01330DB314',
    control: '57998665-F536-4E22-BBE8-0302580269C6',
  },
}))

vi.mock('./blePermission', () => ({
  askForBluetooth: async () =>
    asked.allowed
      ? { ok: true as const, value: undefined }
      : {
          ok: false as const,
          error: { code: 'not-allowed', detail: '근처 기기를 못 쓴다', field: 'ble' },
        },
}))

const {
  BleMessageTransport,
  HEARTBEAT_DEAD_MS,
  HEARTBEAT_INTERVAL_MS,
  SCAN_PAUSE_MS,
  SCAN_TIMEOUT_MS,
} = await import('./BleMessageTransport')

/** 알리기가 되는 척한다. 붙었다는 신호까지 흉내 낸다 */
function peripheralWorks(): void {
  peripheral.available = true
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 흉내다
  ;(peripheral as any).module = {
    addListener: () => ({ remove: () => undefined }),
    start: async () => true,
    stop: async () => true,
    send: async () => true,
  }
}

/**
 * 찾는 무전기 흉내.
 *
 * 상태를 순서대로 흘려주고, 찾기를 시작하면 기록한다. 시험이 상대를
 * "나타나게" 할 수도 있다.
 */
class FakeManager {
  static latest: FakeManager | null = null

  readonly started = vi.fn()
  readonly stopped = vi.fn()
  private scanCallback: ScanCallback | null = null
  private stateListener: ((state: string) => void) | null = null

  constructor(private readonly states: string[] = ['PoweredOn']) {
    FakeManager.latest = this
  }

  onStateChange(listener: (state: string) => void, emitCurrent: boolean) {
    this.stateListener = listener
    if (emitCurrent) {
      for (const state of this.states) listener(state)
    }
    return { remove: () => undefined }
  }

  startDeviceScan(_uuids: string[], _options: unknown, callback: ScanCallback) {
    this.started()
    this.scanCallback = callback
  }

  stopDeviceScan() {
    this.stopped()
    this.scanCallback = null
  }

  destroy() {}

  /** 나중에 켜졌다 */
  powerOn(): void {
    this.stateListener?.('PoweredOn')
  }

  /** 상대가 나타났다 */
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 흉내다
  appear(device: any): void {
    this.scanCallback?.(null, device)
  }

  /** 찾다가 오류가 났다 */
  fail(message: string): void {
    this.scanCallback?.(new Error(message), null)
  }
}

function centralWorks(states: string[] = ['PoweredOn']): void {
  central.available = true
  // biome-ignore lint/suspicious/noExplicitAny: 위와 같다
  ;(central as any).module = {
    BleManager: class extends FakeManager {
      constructor() {
        super(states)
      }
    },
  }
}

// biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 흉내다
type ScanCallback = (error: any, device: any) => void

/** 붙을 수 있는 상대 흉내 */
function fakeDevice() {
  let onDisconnected: (() => void) | null = null

  const device = {
    connect: async () => device,
    discoverAllServicesAndCharacteristics: async () => device,
    requestMTU: async () => ({ mtu: 185 }),
    monitorCharacteristicForService: () => ({ remove: () => undefined }),
    onDisconnected: (listener: () => void) => {
      onDisconnected = listener
      return { remove: () => undefined }
    },
    cancelConnection: async () => undefined,
    writeCharacteristicWithResponseForService: async () => undefined,
    /** 시험이 끊는다 */
    drop: () => onDisconnected?.(),
  }

  return device
}

beforeEach(() => {
  peripheral.available = false
  central.available = false
  asked.allowed = true
  FakeManager.latest = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('여는 쪽은 알리기부터 해본다', () => {
  it('알리기가 되면 찾기는 안 해본다', async () => {
    peripheralWorks()
    centralWorks()

    const link = new BleMessageTransport('host')
    const opened = await link.connect()

    expect(opened.ok).toBe(true)
    // **첫 시도가 되면 거기서 멈춘다.** 둘 다 켜두면 연결이 두 개 생긴다.
    expect(FakeManager.latest).toBeNull()
  })

  it('알리기가 안 되면 찾기로 돌아선다', async () => {
    // 알리는 장치가 없는 안드로이드다
    centralWorks()

    const link = new BleMessageTransport('host')
    const opened = await link.connect()

    expect(opened.ok).toBe(true)
    expect(FakeManager.latest?.started).toHaveBeenCalled()
  })
})

describe('붙는 쪽은 찾기부터 해본다', () => {
  it('찾기가 안 되면 알리기로 돌아선다', async () => {
    peripheralWorks()

    const link = new BleMessageTransport('guest')
    const opened = await link.connect()

    // 찾는 모듈이 없어서 알리기로 넘어갔고, 그쪽은 된다
    expect(opened.ok).toBe(true)
  })

  it('켜질 때까지 기다렸다가 찾는다', async () => {
    // 아이폰은 무전기를 만든 직후 "모름" 이다. 그때 찾기를 시작하면 즉시 실패한다.
    centralWorks(['Unknown'])

    const link = new BleMessageTransport('guest')
    const connecting = link.connect()
    await Promise.resolve()

    const manager = FakeManager.latest
    expect(manager).not.toBeNull()
    expect(manager?.started).not.toHaveBeenCalled()

    manager?.powerOn()
    const opened = await connecting

    expect(opened.ok).toBe(true)
    expect(manager?.started).toHaveBeenCalledTimes(1)
  })

  it('꺼져 있으면 무엇을 누르면 되는지 알리고 돌아서지 않는다', async () => {
    // 돌아서면 아이폰은 알리기가 "됐다" 고 답해서 알리는 쪽으로 굳어버린다.
    // 나중에 블루투스를 켜도 둘 다 알리기만 하고 아무도 안 찾는다.
    peripheralWorks()
    centralWorks(['PoweredOff'])

    const link = new BleMessageTransport('guest')
    const opened = await link.connect()

    expect(opened.ok).toBe(false)
    if (opened.ok) return
    expect(opened.error.code).toBe('not-allowed')
    expect(opened.error.detail).toContain('블루투스를 켜주세요')
  })
})

describe('찾는 쪽은 접지 않는다', () => {
  it('한 바퀴 못 찾으면 잠깐 쉬고 다시 찾는다', async () => {
    vi.useFakeTimers()
    centralWorks()

    const link = new BleMessageTransport('guest')
    await link.connect()

    const manager = FakeManager.latest
    expect(manager?.started).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS + SCAN_PAUSE_MS)

    // **못 찾았다고 접으면 사용자가 뭔가를 눌러야 한다.** 비행기에서는 그걸 알 길이 없다.
    expect(manager?.started).toHaveBeenCalledTimes(2)
    expect(link.currentState().phase).toBe('searching')
  })

  it('찾다가 오류가 나면 점점 길게 쉬며 다시 찾는다', async () => {
    vi.useFakeTimers()
    centralWorks()

    const link = new BleMessageTransport('guest')
    await link.connect()
    const manager = FakeManager.latest

    manager?.fail('BluetoothLE is powered off')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(manager?.started).toHaveBeenCalledTimes(2)

    manager?.fail('BluetoothLE is powered off')
    await vi.advanceTimersByTimeAsync(1_000)
    // 두 번째는 2초를 쉰다. 안드로이드는 너무 자주 시작하면 한동안 아무것도 안 준다.
    expect(manager?.started).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(manager?.started).toHaveBeenCalledTimes(3)
  })

  it('상대가 나타나면 붙고, 끊기면 다시 찾는다', async () => {
    vi.useFakeTimers()
    centralWorks()

    const link = new BleMessageTransport('guest')
    await link.connect()
    const manager = FakeManager.latest
    const device = fakeDevice()

    manager?.appear(device)
    await vi.advanceTimersByTimeAsync(0)

    expect(link.currentState().isUsable()).toBe(true)

    device.drop()
    await vi.advanceTimersByTimeAsync(0)

    // 엘리베이터에서 내리면 몇 초 안에 다시 붙어야 한다
    expect(link.currentState().isUsable()).toBe(false)
    expect(manager?.started).toHaveBeenCalledTimes(2)
  })

  it('끈 뒤에는 더 찾지 않는다', async () => {
    vi.useFakeTimers()
    centralWorks()

    const link = new BleMessageTransport('guest')
    await link.connect()
    const manager = FakeManager.latest

    await link.disconnect()
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS + SCAN_PAUSE_MS)

    expect(manager?.started).toHaveBeenCalledTimes(1)
  })

  it('켜져 있는데 또 켜라고 하면 아무것도 안 한다', async () => {
    // 앞으로 돌아올 때마다 다시 켜는데, 그때마다 귀가 하나씩 늘면 같은 말을 여러 번 듣는다
    centralWorks()

    const link = new BleMessageTransport('guest')
    await link.connect()
    await link.connect()

    expect(FakeManager.latest?.started).toHaveBeenCalledTimes(1)
  })
})

describe('둘 다 안 될 때', () => {
  it('먼저 해본 쪽의 까닭을 올린다', async () => {
    // 제자리가 알리기인데 그것도 없고 찾기도 없다
    const link = new BleMessageTransport('host')
    const opened = await link.connect()

    expect(opened.ok).toBe(false)
    if (opened.ok) return

    // **화면에 띄울 말로는 제자리 쪽 까닭이 맞다.** 반대쪽은
    // 어차피 덤으로 해본 것이다.
    expect(opened.error.detail).toContain('알리는 장치가 없다')
  })

  it('권한을 안 주면 찾기를 시작하지도 않는다', async () => {
    asked.allowed = false
    centralWorks()

    const link = new BleMessageTransport('guest')
    const opened = await link.connect()

    expect(opened.ok).toBe(false)
    // 권한 없이 시작하면 오류도 안 나고 결과만 영영 안 온다
    expect(FakeManager.latest).toBeNull()
  })
})

describe('사진 조각은 글에 양보한다', () => {
  it('알리는 쪽은 줄이 짧아질 때까지 다음 조각을 안 넣는다', async () => {
    vi.useFakeTimers()
    peripheralWorks()
    // 처음 몇 번은 줄이 길다고 답하다가 짧아진다
    const queuedAnswers = [50, 50, 0]
    const sent = vi.fn(async () => true)
    // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 흉내다
    ;(peripheral as any).module.send = sent
    // biome-ignore lint/suspicious/noExplicitAny: 위와 같다
    ;(peripheral as any).module.queued = () => queuedAnswers.shift() ?? 0

    const link = new BleMessageTransport('host')
    await link.connect()

    const sending = link.send({
      v: 1,
      t: 'asset_chunk',
      id: '01K5F8ZPXQ0000000000000001',
      seq: 0,
      ts: 1758000000000,
      p: { assetId: '01K5F8ZPXQ0000000000000002', index: 0, data: 'QUJD' },
    })

    await vi.advanceTimersByTimeAsync(10)
    // 아직 줄이 길다. 첫 조각도 안 나갔다.
    expect(sent).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    const result = await sending

    expect(result.ok).toBe(true)
    expect(sent).toHaveBeenCalled()
  })

  it('글은 줄을 안 본다', async () => {
    peripheralWorks()
    const sent = vi.fn(async () => true)
    // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 흉내다
    ;(peripheral as any).module.send = sent
    // biome-ignore lint/suspicious/noExplicitAny: 위와 같다
    ;(peripheral as any).module.queued = () => 9_999

    const link = new BleMessageTransport('host')
    await link.connect()

    const result = await link.send({
      v: 1,
      t: 'ack',
      id: '01K5F8ZPXQ0000000000000001',
      seq: 1,
      ts: 1758000000000,
      p: { messageId: '01K5F8ZPXQ0000000000000003' },
    })

    expect(result.ok).toBe(true)
    expect(sent).toHaveBeenCalled()
  })
})

describe('심장박동', () => {
  it('상대가 한참 조용하면 끊긴 것으로 보고 다시 찾는다', async () => {
    vi.useFakeTimers()
    centralWorks()

    const link = new BleMessageTransport('guest')
    await link.connect()
    const manager = FakeManager.latest
    const device = fakeDevice()
    const cancelled = vi.fn(async () => undefined)
    device.cancelConnection = cancelled

    manager?.appear(device)
    await vi.advanceTimersByTimeAsync(0)
    expect(link.currentState().isUsable()).toBe(true)

    // 아무것도 안 오는 채로 박동 세 번이 넘게 지난다
    await vi.advanceTimersByTimeAsync(HEARTBEAT_DEAD_MS + HEARTBEAT_INTERVAL_MS)

    expect(link.currentState().isUsable()).toBe(false)
    expect(cancelled).toHaveBeenCalled()
    // 놓기만 하고 손을 놓지 않는다. 다시 찾는다.
    expect(manager?.started).toHaveBeenCalledTimes(2)
  })

  it('무엇이든 받고 있으면 끊긴 것으로 보지 않는다', async () => {
    vi.useFakeTimers()
    peripheralWorks()

    const listeners: Record<string, (event: unknown) => void> = {}
    // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈 흉내다
    ;(peripheral as any).module.addListener = (
      name: string,
      handler: (e: unknown) => void,
    ) => {
      listeners[name] = handler
      return { remove: () => undefined }
    }

    const link = new BleMessageTransport('host')
    await link.connect()
    listeners.onSubscribe?.({ subscribed: true, mtu: 180 })
    expect(link.currentState().isUsable()).toBe(true)

    // 빈 머리말(심장박동)이 계속 온다
    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS)
      listeners.onReceive?.({ data: 'AAAAAAA=' })
    }

    expect(link.currentState().isUsable()).toBe(true)
  })
})
