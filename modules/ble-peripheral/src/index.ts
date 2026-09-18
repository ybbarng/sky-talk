/**
 * 블루투스로 자기를 알린다.
 *
 * **두 운영체제에 같은 이름으로 있다.** 아이폰은 Swift(CoreBluetooth),
 * 안드로이드는 Kotlin(`BluetoothLeAdvertiser` + `BluetoothGattServer`)로
 * 따로 만들었지만 부르는 법은 하나다. 그래서 여기 적힌 약속만 지키면
 * JS 는 어느 폰인지 신경 쓰지 않는다.
 *
 * **없을 수 있다는 전제로 쓴다.** 빌드가 어긋나면 안 들어오고, 알리는
 * 장치가 없는 기기도 있다. 그때는 "못 한다"고만 답해야 하고,
 * **여기서 앱이 죽으면 안 된다.**
 *
 * (docs/04-transport-spec.md 4장 · T20)
 */

export interface BlePeripheralEvents {
  /** 상대가 보낸 조각 (base64) */
  onReceive: (event: { data: string }) => void
  /** 블루투스가 켜졌나 꺼졌나 */
  onStateChange: (event: { state: BleState }) => void
  /** 상대가 듣기 시작했나 그만뒀나 */
  onSubscribe: (event: { subscribed: boolean; mtu: number }) => void
}

export type BleState = 'on' | 'off' | 'denied' | 'unsupported' | 'failed' | 'unknown'

export interface BlePeripheralModule {
  isSupported(): boolean
  start(localName: string): Promise<boolean>
  stop(): Promise<boolean>
  /** 조각 하나를 보낸다. 자리가 없으면 false. **거기서 멈춰야 한다** */
  send(base64: string): Promise<boolean>
  isAdvertising(): boolean
  /** 아직 안 나간 조각 수. 사진 조각을 밀어 넣는 속도를 여기에 맞춘다 */
  queued(): number
  addListener<K extends keyof BlePeripheralEvents>(
    event: K,
    handler: BlePeripheralEvents[K],
  ): { remove(): void }
}

type LoadResult =
  | { readonly available: true; readonly module: BlePeripheralModule }
  | { readonly available: false; readonly why: string }

let cached: LoadResult | null = null

/**
 * 모듈을 안전하게 들여온다.
 *
 * 맨 위에서 `import` 하면 빌드가 어긋났을 때 앱이 통째로 안 켜진다.
 * 알리기 하나 때문에 대화를 못 하게 되면 앞뒤가 안 맞는다.
 */
export function loadBlePeripheral(): LoadResult {
  if (cached !== null) return cached

  try {
    const { requireNativeModule } = require('expo-modules-core')
    const loaded = requireNativeModule('BlePeripheral')

    if (loaded === null || typeof loaded.start !== 'function') {
      cached = {
        available: false,
        why: '알리는 모듈이 제대로 안 들어 있다',
      }
      return cached
    }

    cached = { available: true, module: loaded as BlePeripheralModule }
    return cached
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    cached = {
      available: false,
      why: `알리는 모듈이 없다: ${detail}`,
    }
    return cached
  }
}

/** 이 기기에서 알릴 수 있나 */
export function canAdvertise(): boolean {
  return loadBlePeripheral().available
}
