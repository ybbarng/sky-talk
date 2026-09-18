import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { notifier, type Preferences, vibration } from '@/composition/services'
import type { Message } from '@/domain/message/Message'
import type { PeerId } from '@/domain/peer/PeerId'
import { notificationBody, reactionTo } from '../copy/notify'

/**
 * 상대가 말을 걸면 잠금 화면에 띄운다.
 *
 * **앱이 뒤에 있을 때만 띄운다.** 보고 있는 화면에 이미 떠 있는데
 * 또 울리면 시끄럽다.
 *
 * 처음 켤 때 쌓여 있던 것은 안 띄운다. 앱을 여는 순간 예전 대화가
 * 통째로 알림으로 쏟아지면 못 쓴다.
 */

export interface MessageNotificationsInput {
  readonly enabled: boolean
  readonly me: PeerId | null
  readonly peerName: string
  readonly messages: readonly Message[]
  /** 앱을 **안 보고 있을 때** 소리로 알릴까 진동으로 알릴까 */
  readonly alertMode: Preferences['alertMode']
  /** 앱을 **보고 있을 때** 짧게 떨까 */
  readonly tapWhileWatching: boolean
  /** 상대가 콕 찌르면 떨까. 보고 있든 아니든 */
  readonly nudgeVibration: boolean
}

export function useMessageNotifications(input: MessageNotificationsInput): void {
  /** 이미 알린 것. 같은 메시지를 두 번 띄우지 않는다 */
  const announced = useRef<Set<string>>(new Set())
  const primed = useRef(false)

  useEffect(() => {
    if (!input.enabled) return
    void notifier.prepare()
  }, [input.enabled])

  useEffect(() => {
    if (!input.enabled || input.me === null) return

    // 처음 한 번은 쌓인 것을 전부 "이미 알린 것"으로 친다.
    // 안 그러면 앱을 여는 순간 예전 대화가 알림으로 쏟아진다.
    if (!primed.current) {
      primed.current = true
      for (const message of input.messages) announced.current.add(message.id)
      return
    }

    const active = AppState.currentState === 'active'

    for (const message of input.messages) {
      if (announced.current.has(message.id)) continue
      announced.current.add(message.id)

      // 내가 쓴 것은 안 띄운다
      if (message.isMine(input.me)) continue

      /**
       * 무엇을 할지는 `reactionTo` 가 정한다.
       *
       * 보고 있으면 알림 대신 짧게 떤다. 화면에는 이미 떴으니 잠금 화면
       * 알림은 시끄럽기만 하다. 그래도 **다른 곳을 보고 있었을 수
       * 있어서** 손끝으로는 알린다. 설정 화면이나 통화 화면에 있으면
       * 새 말이 온 줄 모른다.
       *
       * **콕 찌르기는 보고 있든 아니든 떤다.** 진동이 곧 내용이다.
       *
       * 둘 다 거슬리면 따로 끌 수 있다. 하나는 보고 있을 때, 하나는
       * 콕 찔릴 때라 서로 다른 일이다.
       */
      const reaction = reactionTo(message.content, {
        active,
        tapWhileWatching: input.tapWhileWatching,
        nudgeVibration: input.nudgeVibration,
      })

      if (reaction.vibrate === 'nudge') void vibration.nudge()
      if (reaction.vibrate === 'tap') void vibration.tap()

      if (!reaction.notify) continue

      void notifier.show(input.peerName, notificationBody(message.content), {
        kind: 'message',
        alertMode: input.alertMode,
      })
    }
  }, [
    input.enabled,
    input.me,
    input.peerName,
    input.messages,
    input.alertMode,
    input.tapWhileWatching,
    input.nudgeVibration,
  ])

  // 앱을 열면 쌓인 알림을 치운다. 이미 다 본 것이다.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') void notifier.clear()
    })
    return () => subscription.remove()
  }, [])
}
