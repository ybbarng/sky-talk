import { useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { readBluetooth } from '@/composition/services'

/**
 * 블루투스가 켜져 있는지 지켜본다.
 *
 * **꺼진 것은 사람이 켜야 풀린다.** 그래서 끊겨 있는 동안 몇 초마다
 * 보면서 "켜주세요" 를 띄울지 정한다. 이어져 있는 동안은 볼 필요가 없다.
 * 꺼지면 어차피 끊긴다.
 *
 * 아직 못 읽었으면 `null`. 모르는 것을 "꺼졌다" 로 바꾸지 않는다.
 */
export interface BluetoothWatch {
  readonly on: boolean | null
}

const CHECK_INTERVAL_MS = 3000

export function useBluetoothWatch(enabled = true): BluetoothWatch {
  const [watch, setWatch] = useState<BluetoothWatch>({ on: null })

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    async function check(): Promise<void> {
      const power = await readBluetooth()
      if (cancelled) return
      setWatch({ on: power === 'unknown' ? null : power === 'on' })
    }

    void check()
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS)

    // 설정에서 블루투스를 켜고 돌아온 순간 바로 알아챈다.
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') void check()
    })

    return () => {
      cancelled = true
      clearInterval(timer)
      subscription.remove()
    }
  }, [enabled])

  return watch
}
