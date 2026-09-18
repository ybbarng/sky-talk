import { create } from 'zustand'
import { CallSession } from '@/application/call/CallSession'
import type { CallSignalPayload } from '@/application/ports/Envelope'
import type { MessageTransport } from '@/application/ports/MessageTransport'
import type { AudioMode, AudioSession, VoiceLink } from '@/application/ports/VoiceLink'
import { ids } from '@/composition/services'
import { type CallKind, CallState } from '@/domain/call/CallState'
import { systemClock } from '@/domain/shared/Clock'

/**
 * 통화 화면이 보는 상태.
 *
 * **통화가 무슨 일을 겪든 메시지 쪽은 건드리지 않는다.** 이 저장소는
 * 자기 것만 본다. `useChatStore` 가 통화 봉투를 받으면 여기로 넘긴다.
 */

interface CallStore {
  readonly state: CallState
  readonly available: boolean
  /** 누르고 말하기에서 지금 말하는 중인가 */
  readonly talking: boolean
  /** 버튼을 밀어 잠갔나 */
  readonly locked: boolean
  readonly muted: boolean
  readonly cameraOn: boolean
  readonly notice: string | null
  readonly localUrl: string | null
  readonly remoteUrl: string | null

  attach(deps: AttachInput): void
  detach(): void

  call(kind: CallKind): Promise<void>
  accept(): Promise<void>
  decline(): Promise<void>
  hangUp(): Promise<void>

  /** 상대에게서 온 통화 봉투 */
  handleSignal(payload: CallSignalPayload): Promise<void>

  startTalking(): void
  stopTalking(): void
  toggleLock(): void
  toggleMute(): void
  toggleCamera(): void
  switchCamera(): Promise<void>
  setAudioMode(mode: AudioMode): void
  dismissNotice(): void
  /**
   * 끝난 통화 화면을 치운다.
   *
   * 끝난 뒤에는 "끊기" 가 할 일이 없다. 그래서 닫기가 끊기를 부르면
   * 아무 일도 안 일어나고 화면이 그대로 남는다(실제로 그랬다).
   */
  dismissEnded(): void
}

interface AttachInput {
  readonly transport: MessageTransport
  readonly voice: VoiceLink
  readonly audio: AudioSession
  readonly audioMode: AudioMode
}

export const useCallStore = create<CallStore>((set, get) => {
  let session: CallSession | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let stopRouteWatch: (() => void) | null = null
  let link: VoiceLink | null = null

  function refreshStreams(): void {
    if (link === null) return
    const streams = link.streams()
    set({ localUrl: streams.localUrl, remoteUrl: streams.remoteUrl })
  }

  return {
    state: CallState.idle(),
    available: false,
    talking: false,
    locked: false,
    muted: false,
    cameraOn: false,
    notice: null,
    localUrl: null,
    remoteUrl: null,

    attach(input) {
      get().detach()
      link = input.voice

      session = new CallSession(
        {
          transport: input.transport,
          voice: input.voice,
          audio: input.audio,
          clock: systemClock,
          nextId: () => ids.next(),
        },
        {
          onStateChange: state => {
            set({ state })
            refreshStreams()

            // 통화가 끝나면 누르고 말하던 것도 푼다
            if (!state.isLive()) {
              set({ talking: false, locked: false, muted: false })
            }
          },
        },
      )

      session.setAudioMode(input.audioMode)
      set({ available: input.voice.isAvailable(), state: CallState.idle() })

      // 기다리다 포기할 때가 됐는지 살핀다
      timer = setInterval(() => {
        void session?.checkTimeout()
      }, 1000)

      // 이어폰이 빠지면 마이크를 즉시 끈다
      stopRouteWatch = input.audio.onRouteChange(route => {
        if (route.headphonesConnected) return
        if (!get().state.isLive()) return

        session?.onHeadphonesUnplugged()
        set({
          talking: false,
          locked: false,
          notice: '이어폰이 빠져서 마이크를 껐어요',
        })
      })
    },

    detach() {
      if (timer !== null) clearInterval(timer)
      timer = null
      stopRouteWatch?.()
      stopRouteWatch = null
      void session?.end()
      session = null
      link = null
    },

    async call(kind) {
      // 실패해도 여기서 알리지 않는다. 왜 안 됐는지는 상태에 남고,
      // 화면이 그걸 보고 사람 말로 옮긴다.
      await session?.start(kind)
      set({ cameraOn: kind === 'video' })
      refreshStreams()
    },

    async accept() {
      await session?.accept()
      refreshStreams()
    },

    async decline() {
      await session?.end('hung-up')
    },

    async hangUp() {
      await session?.end('hung-up')
    },

    async handleSignal(payload) {
      if (session === null) return

      switch (payload.kind) {
        case 'offer':
          await session.receiveOffer(payload)
          break
        case 'answer':
          await session.receiveAnswer(payload)
          break
        case 'candidate':
          await session.receiveCandidate(payload)
          break
        case 'hangup':
          await session.receiveHangup(false)
          break
        case 'decline':
          await session.receiveHangup(true)
          break
      }
    },

    startTalking() {
      if (get().locked) return
      const result = session?.setMicrophoneEnabled(true)
      if (result?.ok === true) set({ talking: true })
    },

    stopTalking() {
      // 잠겨 있으면 손을 떼도 계속 켜둔다
      if (get().locked) return
      session?.setMicrophoneEnabled(false)
      set({ talking: false })
    },

    toggleLock() {
      const next = !get().locked
      const result = session?.setMicrophoneEnabled(next)
      if (result?.ok === true || !next) {
        set({ locked: next, talking: next })
      }
    },

    toggleMute() {
      const next = !get().muted
      session?.setMicrophoneEnabled(!next)
      set({ muted: next, talking: !next })
    },

    toggleCamera() {
      const next = !get().cameraOn
      const result = session?.setCameraEnabled(next)
      if (result?.ok === true) {
        set({ cameraOn: next })
        refreshStreams()
      }
    },

    async switchCamera() {
      // 실패해도 화면은 그대로다. 앞뒤가 안 바뀔 뿐이다.
      await link?.switchCamera()
      refreshStreams()
    },

    setAudioMode(mode) {
      session?.setAudioMode(mode)
    },

    dismissNotice() {
      set({ notice: null })
    },

    dismissEnded() {
      if (get().state.phase !== 'ended') return
      set({ state: CallState.idle(), notice: null })
    },
  }
})
