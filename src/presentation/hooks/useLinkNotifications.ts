import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { notifier } from '@/composition/services'
import type { Role } from '../copy/connecting'
import { alertFor } from '../copy/link'
import { decideNotice } from '../stores/linkNotice'

/**
 * 연결이 끊긴 채로 오래 있으면 잠금 화면에 알린다.
 *
 * **폰을 주머니에 넣어두면 끊긴 줄도 모른다.** 세 시간 내내 화면을
 * 보고 있을 수는 없는데, 그동안 상대는 내 말을 못 받는다.
 *
 * ## 뒤로 가면 오래 못 산다
 *
 * 아이폰은 앱이 뒤로 가면 몇십 초 안에 잠재운다. 그때부터는 우리
 * 코드가 아예 안 돈다. 안드로이드도 화면이 오래 꺼져 있으면 비슷하다.
 * **그래서 이 알림은 "앱이 아직 살아 있는 동안" 만 뜬다.**
 *
 * 잠든 뒤에 끊긴 것은 알릴 방법이 없다. 대신 앱이 앞으로 돌아오면
 * `useReconnectOnForeground` 가 곧바로 다시 붙는다.
 *
 * ## 얼마나 자주 보나
 *
 * 5초마다 본다. 판단은 `linkNotice.ts` 가 하고 여기서는 시계를 보고
 * 띄우기만 한다.
 */

const TICK_MS = 5_000

export interface LinkNotificationsInput {
  readonly enabled: boolean
  readonly role: Role
  readonly connected: boolean
  readonly bluetoothOn: boolean | null
  readonly everConnected: boolean
  readonly peerName: string | null
}

export function useLinkNotifications(input: LinkNotificationsInput): void {
  /** 언제부터 끊겨 있나. 붙어 있으면 null */
  const downSince = useRef<number | null>(null)
  const toldLost = useRef(false)

  const latest = useRef(input)
  latest.current = input

  useEffect(() => {
    if (!input.enabled) return

    const timer = setInterval(() => {
      const now = latest.current

      if (now.connected) {
        downSince.current = null
      } else if (downSince.current === null) {
        downSince.current = Date.now()
      }

      const notice = decideNotice({
        role: now.role,
        connected: now.connected,
        bluetoothOn: now.bluetoothOn,
        downForMs: downSince.current === null ? 0 : Date.now() - downSince.current,
        appActive: AppState.currentState === 'active',
        everConnected: now.everConnected,
        toldLost: toldLost.current,
      })

      if (notice.kind === 'none') return

      // 다음 판단이 달라지도록 먼저 적어둔다.
      // 안 그러면 5초마다 같은 알림이 쌓인다.
      toldLost.current = notice.kind !== 'back'

      const alert = alertFor(notice.kind, now.role, now.peerName)
      if (alert === null) return

      void notifier.show(alert.title, alert.body, { kind: 'link' })
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [input.enabled])
}
