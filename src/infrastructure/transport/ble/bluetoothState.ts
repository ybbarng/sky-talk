import { loadBle } from './bleModule'

/**
 * 블루투스가 켜져 있나.
 *
 * **화면이 "블루투스를 켜주세요" 를 띄울지 정하는 데 쓴다.** 예전에는
 * Wi-Fi 사설망에 있는지로 판단했는데, 비행기에서는 Wi-Fi 가 없는 것이
 * 정상이라 멀쩡한 사람에게 켜라고 하게 됐다.
 *
 * `react-native-ble-plx` 의 관리자는 앱에 하나뿐이다(같은 것을 돌려준다).
 * 그래서 여기서 만들어도 찾는 쪽 무전기와 같은 것을 쓴다. **부수지
 * 않는다.** 부수면 무전기까지 같이 죽는다.
 *
 * 못 읽으면 `unknown` 이다. 모르는 것을 "꺼졌다" 로 바꾸면 멀쩡한 사람에게
 * 설정을 열라고 하게 된다.
 */
export type BluetoothPower = 'on' | 'off' | 'unknown'

export async function readBluetooth(): Promise<BluetoothPower> {
  const ble = loadBle()
  if (!ble.available) return 'unknown'

  try {
    const manager = new ble.module.BleManager()
    const state: string = await manager.state()
    return describe(state)
  } catch {
    return 'unknown'
  }
}

/** ble-plx 가 주는 상태 이름을 셋으로 줄인다 */
export function describe(state: string): BluetoothPower {
  switch (state) {
    case 'PoweredOn':
      return 'on'
    case 'PoweredOff':
    case 'Unauthorized':
    case 'Unsupported':
      return 'off'
    default:
      // Unknown · Resetting → 곧 답이 온다
      return 'unknown'
  }
}
