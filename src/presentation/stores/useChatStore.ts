import { create } from 'zustand'
import { chunkCountFor, type PhotoSize } from '@/application/assets/AssetChunks'
import { ReceiveAsset } from '@/application/assets/ReceiveAsset'
import { SendPhoto } from '@/application/assets/SendPhoto'
import { SendVoice } from '@/application/assets/SendVoice'
import { ConversationSync } from '@/application/messaging/ConversationSync'
import { FlushPendingMessages } from '@/application/messaging/FlushPendingMessages'
import { LoadConversation } from '@/application/messaging/LoadConversation'
import { MarkAsRead } from '@/application/messaging/MarkAsRead'
import { ReceiveMessage } from '@/application/messaging/ReceiveMessage'
import { SendMessage } from '@/application/messaging/SendMessage'
import type {
  AssetStore,
  ImagePicker,
  ImageResizer,
} from '@/application/ports/AssetTransfer'
import type { ConversationRepository } from '@/application/ports/ConversationRepository'
import type { CallSignalPayload, Envelope } from '@/application/ports/Envelope'
import { PROTOCOL_VERSION } from '@/application/ports/Envelope'
import type { MessageTransport } from '@/application/ports/MessageTransport'
import type { DiscoveryProgress } from '@/application/ports/PeerDiscovery'
import type { VoicePlayer, VoiceRecorder } from '@/application/ports/VoiceMemo'
import { SerialQueue } from '@/application/shared/SerialQueue'
import { ids } from '@/composition/services'
import type { ConnectionState } from '@/domain/connection/ConnectionState'
import type { Conversation } from '@/domain/message/Conversation'
import type { Message } from '@/domain/message/Message'
import {
  doodleContent,
  nudgeContent,
  type StickerPose,
  type Stroke,
  stickerContent,
  textContent,
} from '@/domain/message/MessageContent'
import type { CharacterId } from '@/domain/peer/Character'
import type { PeerId } from '@/domain/peer/PeerId'
import { systemClock } from '@/domain/shared/Clock'
import { ANNOUNCE_DISCONNECT_AFTER_MS, HINT_AFTER_MS } from './connectPhase'

/**
 * 대화 화면이 보는 상태.
 *
 * **대화 상태를 건드리는 일은 전부 `SerialQueue` 에 세운다.** 보내기와
 * 받기가 동시에 일어나면 둘 다 같은 옛 값을 읽고 덮어쓴다.
 * 두 기기 통합 테스트가 이 문제를 잡았다. (T09)
 */

interface ChatState {
  ready: boolean
  me: PeerId | null
  conversation: Conversation | null
  messages: Message[]
  hasMore: boolean
  connection: ConnectionState | null
  /** 상대가 입력 중인가 */
  peerTyping: boolean
  /**
   * 사진이 어디까지 왔나. `assetId` 로 찾는다.
   *
   * 0~1 이면 받는 중, 문자열이면 다 받아서 그 자리에 있다.
   */
  assetProgress: Record<string, number>
  assetPaths: Record<string, string>
  /** 사진을 보내는 중인가. 화면이 버튼을 잠글 때 쓴다 */
  sendingPhoto: boolean
  /** 지금 녹음 중인가. 화면이 빨갛게 바뀐다 */
  recording: boolean
  /**
   * 녹음은 끝났는데 아직 안 보낸 것.
   *
   * 블루투스로 이어져 있을 때만 생긴다. 좁은 길이라 얼마나 걸릴지
   * 알려주고 **사용자가 고른 뒤에** 보낸다.
   */
  pendingVoice: { readonly byteLength: number; readonly durationMs: number } | null
  /** 지금 듣고 있는 음성의 번호. 아무것도 아니면 null */
  playingVoice: string | null
  /**
   * 상대 배터리. 0에서 1 사이, 모르면 null.
   *
   * 갑자기 조용해졌을 때 **잠든 것인지 폰이 죽은 것인지** 알 수 있어야
   * 한다.
   */
  peerBattery: number | null
  /** 아직 못 보낸 것이 몇 개인가 */
  pendingCount: number
  /** 상대 식별자. 인사하면서 알게 된다 */
  peerId: string | null
  /** 코드가 안 맞는 상대가 붙었다 */
  /** 찾는 중에 무엇을 하고 있나. 화면에 보여준다 */
  discovery: DiscoveryProgress | null
  /** 오래 못 찾았다. 도움말을 보여줄 때가 됐다 */
  searchingTooLong: boolean
  /** 한 번이라도 붙은 적 있나. "찾는 중"과 "다시 잇는 중"을 가른다 */
  everConnected: boolean
  /** 끊긴 지 오래됐나. 짧은 끊김은 화면에 안 알린다 */
  announceDisconnect: boolean
  /** 상대를 찾았나 */
  peerFound: boolean

  start(deps: ChatDeps): Promise<void>
  send(text: string): Promise<void>
  sendTyping(typing: boolean): void
  sendNudge(): Promise<void>
  /** 내 배터리를 상대에게 알린다. 상대가 내 침묵을 이해하게 */
  shareBattery(level: number): Promise<void>
  /** 내 캐릭터가 자세를 취한다. 자세 이름만 나가서 몇십 바이트다 */
  sendSticker(pose: StickerPose): Promise<void>
  /** 앨범에서 고르거나 찍어 보낸다. 크기는 보내는 사람이 고른다 */
  sendPhoto(from: 'library' | 'camera', caption?: string, size?: PhotoSize): Promise<void>
  /** 목소리를 녹음하기 시작한다. 이미 녹음 중이면 아무 일도 안 한다 */
  startRecording(): Promise<void>
  /** 녹음을 마치고 보낸다. 블루투스면 바로 안 보내고 `pendingVoice` 에 둔다 */
  stopRecordingAndSend(): Promise<void>
  /** 좁은 길로 가도 좋다고 했다. 둬둔 녹음을 보낸다 */
  sendPendingVoice(): Promise<void>
  /** 둬둔 녹음을 버린다 */
  discardPendingVoice(): void
  /** 녹음을 버린다. 보내지 않는다 */
  cancelRecording(): Promise<void>
  /** 음성 메시지를 듣는다. 이미 듣고 있던 것은 멈춘다 */
  playVoice(assetId: string): Promise<void>
  stopVoice(): Promise<void>
  /**
   * 남은 비행 시간과 비행 전체 길이를 상대에게 알린다. 0 이면 끈 것이다.
   *
   * **시각이 아니라 남은 길이를 보낸다.** 두 폰의 시계가 다를 수 있고
   * 시차를 넘으면 한쪽이 먼저 시간대를 바꾼다. 전체 길이는 진행 막대의
   * 출발점이 된다. 안 주면 남은 것을 전체로 본다.
   */
  shareFlight(remainingMs: number, totalMs?: number): Promise<void>
  /** 손으로 그린 낙서. 그림 파일이 아니라 선의 좌표로 간다 */
  sendDoodle(strokes: readonly Stroke[]): Promise<void>
  loadOlder(): Promise<void>
  markVisibleAsRead(): Promise<void>
  stop(): void
}

export interface ChatDeps {
  readonly me: PeerId
  readonly transport: MessageTransport
  readonly repository: ConversationRepository
  /** 사진을 두고 꺼내는 곳 */
  readonly assets: AssetStore
  readonly picker: ImagePicker
  readonly resizer: ImageResizer
  readonly recorder: VoiceRecorder
  readonly voicePlayer: VoicePlayer
  /** 인사할 때 상대에게 알려줄 내 정보 */
  readonly profile: {
    readonly displayName: string
    readonly character: CharacterId
    readonly appVersion: string
  }
  /** 상대가 비행 시간을 정했다. 남은 것은 내 시계로 다시 센다 */
  onFlightShared?(remainingMs: number, totalMs: number): void
  /** 상대를 알게 되면 기억해 둔다 */
  onPeerKnown?(peer: {
    peerId: string
    displayName: string
    character: CharacterId
  }): void
  /**
   * 통화 봉투가 오면 넘긴다.
   *
   * 여기서 통화를 다루지 않는 이유는 **섞이면 안 되기 때문이다.**
   * 통화 쪽이 터져도 글은 그대로 오가야 한다.
   */
  onCallSignal?(payload: CallSignalPayload): Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => {
  const queue = new SerialQueue()
  let deps: ChatDeps | null = null
  /** 다 들었다는 신호를 끊는 것. 다음 재생 때 갈아 끼운다 */
  let stopListening: (() => void) | null = null
  let unsubscribes: Array<() => void> = []
  let typingTimer: ReturnType<typeof setTimeout> | null = null
  let receiver: ReceiveAsset | null = null

  /** 아직 안 보낸 녹음. 화면에는 크기와 길이만 알리고 내용은 여기 둔다 */
  let heldVoice: { base64: string; durationMs: number; byteLength: number } | null = null

  /** 녹음한 것을 실제로 보낸다 */
  async function sendRecorded(recorded: {
    base64: string
    durationMs: number
    byteLength: number
  }): Promise<void> {
    const active = deps
    if (active === null) return

    const conversation = get().conversation
    if (conversation === null) return

    const sender = new SendVoice({
      transport: active.transport,
      repository: active.repository,
      assets: active.assets,
      clock: systemClock,
      ids,
    })

    const result = await sender.execute({
      author: active.me,
      conversation,
      base64: recorded.base64,
      durationMs: recorded.durationMs,
      byteLength: recorded.byteLength,
      onProgress: (sent, total, assetId) => {
        set({
          assetProgress: {
            ...get().assetProgress,
            [assetId]: total === 0 ? 1 : sent / total,
          },
        })
      },
    })

    if (!result.ok) return

    // 내가 보낸 것은 이미 기기에 있다. 바로 들을 수 있다.
    const { [result.value.assetId]: _sent, ...rest } = get().assetProgress
    set({
      conversation: result.value.conversation,
      assetProgress: rest,
      assetPaths: {
        ...get().assetPaths,
        [result.value.assetId]: active.assets.pathOf(result.value.assetId),
      },
    })
    await refresh()
  }

  /**
   * 사진 조각을 받는 이.
   *
   * 하나만 두고 계속 쓴다. 매번 새로 만들면 **받던 조각을 잊어버려서**
   * 끊겼다 붙을 때마다 처음부터 다시 받는다.
   */
  function assetReceiver(active: ChatDeps | null): ReceiveAsset | null {
    if (active === null) return null
    if (receiver !== null) return receiver

    receiver = new ReceiveAsset(
      {
        assets: active.assets,
        transport: active.transport,
        clock: systemClock,
        ids,
      },
      {
        onProgress: (assetId, ratio) => {
          set({ assetProgress: { ...get().assetProgress, [assetId]: ratio } })
        },
        onComplete: assetId => {
          const { [assetId]: _done, ...rest } = get().assetProgress
          set({
            assetProgress: rest,
            assetPaths: {
              ...get().assetPaths,
              [assetId]: active.assets.pathOf(assetId),
            },
          })
        },
      },
    )
    return receiver
  }
  let lastTypingSentAt = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** 화면에 보이는 목록을 저장소에서 다시 읽는다 */
  async function refresh(): Promise<void> {
    if (deps === null) return

    const loader = new LoadConversation(deps.repository)
    const page = await loader.initial(deps.me)
    if (!page.ok) return

    set({
      conversation: page.value.conversation,
      messages: [...page.value.messages],
      hasMore: page.value.hasMore,
    })

    await trackAssets(page.value.messages)
  }

  /**
   * 사진·음성이 달린 메시지마다 파일이 있는지 본다.
   *
   * 있으면 바로 보여주고, **없으면 조각을 기다리기 시작한다.** 이걸 안
   * 하면 조각이 와도 "모르는 사진" 으로 버려져 영영 "기다리는 중" 이다
   * (2026-09-19 실제로 그랬다). 앱을 껐다 켜도 마찬가지라 불러올 때마다 본다.
   */
  async function trackAssets(messages: readonly Message[]): Promise<void> {
    const active = deps
    if (active === null) return

    for (const message of messages) {
      const content = message.content
      if (content.kind !== 'photo' && content.kind !== 'voice') continue
      if (get().assetPaths[content.assetId] !== undefined) continue

      if (await active.assets.exists(content.assetId)) {
        set({
          assetPaths: {
            ...get().assetPaths,
            [content.assetId]: active.assets.pathOf(content.assetId),
          },
        })
        continue
      }

      // 내 것인데 파일이 없으면 보내다 죽은 것이다. 상대에게 달라고 할 수 없다.
      if (message.isMine(active.me)) continue

      // **너무 오래된 것은 안 기다린다.** 며칠 전 시험하다 만 사진까지 인사할
      // 때마다 달라고 하면 좁은 길이 그것으로 꽉 차서 지금 대화가 밀린다.
      // 한 비행 안의 것만 챙긴다.
      if (
        systemClock.epochMillis() - message.orderedAt().getTime() >
        TRACK_ASSETS_WITHIN_MS
      ) {
        continue
      }

      assetReceiver(active)?.expect(content.assetId, content.byteLength)
    }
  }

  function syncOf(active: ChatDeps): ConversationSync {
    return new ConversationSync(active.repository, active.transport, systemClock, ids)
  }

  /** 연결되면 인사한다. 이걸 해야 놓친 것을 채울 수 있다 */
  async function greet(): Promise<void> {
    const active = deps
    if (active === null) return
    const conversation = get().conversation
    if (conversation === null) return

    await syncOf(active).greet({
      me: active.me,
      displayName: active.profile.displayName,
      character: active.profile.character,
      appVersion: active.profile.appVersion,
      conversation,
      peerId: get().peerId ?? undefined,
    })
  }

  async function handle(envelope: Envelope): Promise<void> {
    if (deps === null) return

    // --- 인사와 놓친 것 채우기 ---

    if (envelope.t === 'hello') {
      const conversation = get().conversation
      if (conversation === null) return

      const outcome = await syncOf(deps).onHello({
        me: deps.me,
        displayName: deps.profile.displayName,
        character: deps.profile.character,
        appVersion: deps.profile.appVersion,
        conversation,
        hello: envelope.p,
      })

      if (outcome.ok) {
        set({ peerId: outcome.value.peer.peerId })
        deps.onPeerKnown?.(outcome.value.peer)
      }
      // 끊긴 동안 못 받은 사진 조각을 달라고 한다
      await assetReceiver(deps)?.requestMissing()
      return
    }

    if (envelope.t === 'hello_ack') {
      set({ peerId: envelope.p.peerId })
      deps.onPeerKnown?.({
        peerId: envelope.p.peerId,
        displayName: envelope.p.displayName,
        character: envelope.p.character,
      })
      // 끊긴 동안 못 받은 사진 조각을 달라고 한다. 처음부터 다시 받지 않는다.
      await assetReceiver(deps)?.requestMissing()
      return
    }

    if (envelope.t === 'sync_request') {
      await syncOf(deps).onSyncRequest({ me: deps.me, payload: envelope.p })
      return
    }

    if (envelope.t === 'sync_response') {
      const conversation = get().conversation
      if (conversation === null) return

      const outcome = await syncOf(deps).onSyncResponse({
        payload: envelope.p,
        conversation,
      })
      if (outcome.ok) {
        set({ conversation: outcome.value.conversation })
        if (outcome.value.restored > 0) await refresh()
      }
      return
    }

    if (envelope.t === 'asset_chunk') {
      await assetReceiver(deps)?.onChunk(envelope.p)
      return
    }

    if (envelope.t === 'asset_request') {
      // 상대가 못 받은 조각을 달라고 한다. 그것만 다시 보낸다.
      const photo = deps
      if (photo === null) return
      const sender = new SendPhoto({
        transport: photo.transport,
        repository: photo.repository,
        assets: photo.assets,
        resizer: photo.resizer,
        clock: systemClock,
        ids,
      })
      await sender.sendChunks(envelope.p.assetId, 0, undefined, envelope.p.missing)
      return
    }

    if (envelope.t === 'call_signal') {
      // **통화 쪽으로 넘기고 여기서는 손을 뗀다.**
      // 통화에서 무슨 일이 나든 메시지 쪽이 흔들리면 안 된다.
      try {
        await deps.onCallSignal?.(envelope.p)
      } catch {
        // 통화 쪽이 터졌다. 글은 그대로 오간다.
      }
      return
    }

    if (envelope.t === 'presence') {
      set({
        peerTyping: false,
        peerBattery:
          typeof envelope.p.batteryLevel === 'number'
            ? envelope.p.batteryLevel
            : get().peerBattery,
      })
      return
    }

    if (envelope.t === 'flight') {
      /**
       * 상대가 남은 시간을 정했다.
       *
       * **내 시계로 도착 시각을 다시 센다.** 상대 시계를 그대로
       * 쓰면 시차를 넘을 때 엉뚱해진다. 건너오는 데 걸린 몇백
       * 밀리초만큼 어긋나는데, 비행 시간에 견주면 없는 것과 같다.
       */
      // 총 길이가 없으면 예전 앱이다. 남은 것을 총 길이로 본다.
      deps?.onFlightShared?.(
        envelope.p.remainingMs,
        envelope.p.totalMs ?? envelope.p.remainingMs,
      )
      return
    }

    if (envelope.t === 'typing') {
      set({ peerTyping: envelope.p.typing })

      // 5초 동안 새 신호가 없으면 표시를 지운다.
      // 상대가 앱을 닫으면 "입력 중"이 영원히 남는다.
      if (typingTimer !== null) clearTimeout(typingTimer)
      typingTimer = setTimeout(() => set({ peerTyping: false }), 5000)
      return
    }

    if (envelope.t !== 'message') return

    const conversation = get().conversation
    if (conversation === null) return

    // 메시지를 받았다는 건 상대를 안다는 뜻이다. 기억해 두어야
    // 다음 인사에서 "네 것을 몇 번까지 받았다"를 제대로 알려준다.
    if (get().peerId === null) set({ peerId: envelope.p.author })

    const receiver = new ReceiveMessage(deps.repository, deps.transport, systemClock, ids)

    const result = await receiver.execute({ payload: envelope.p, conversation })
    if (result.ok) {
      set({ conversation: result.value.conversation, peerTyping: false })
      await refresh()
    }
  }

  return {
    ready: false,
    me: null,
    conversation: null,
    messages: [],
    hasMore: false,
    connection: null,
    peerTyping: false,
    assetProgress: {},
    assetPaths: {},
    sendingPhoto: false,
    recording: false,
    pendingVoice: null,
    playingVoice: null,
    peerBattery: null,
    pendingCount: 0,
    peerId: null,
    discovery: null,
    searchingTooLong: false,
    everConnected: false,
    announceDisconnect: false,
    peerFound: false,

    async start(next) {
      deps = next
      set({ me: next.me, connection: next.transport.currentState() })

      unsubscribes = [
        next.transport.onReceive(envelope => {
          void queue.run(() => handle(envelope))
        }),
        // 좁은 길은 사진 조각 하나가 몇십 초 걸린다. 그 사이에도 퍼센트가
        // 움직여야 "멈췄나" 싶지 않다. 받는 중인 것이 하나일 때만 어디에
        // 보탤지 안다. 둘 이상이면 조각 단위로만 보인다.
        next.transport.onReceiveProgress?.(fraction => {
          const inFlight = assetReceiver(deps)?.inFlight() ?? []
          const only = inFlight.length === 1 ? inFlight[0] : undefined
          if (only === undefined) return
          const total = chunkCountFor(only.byteLength)
          if (total === 0) return
          const ratio = Math.min(1, (only.received + Math.min(1, fraction)) / total)
          set({ assetProgress: { ...get().assetProgress, [only.assetId]: ratio } })
        }) ?? (() => undefined),
        next.transport.onStateChange(state => {
          set({ connection: state })

          if (state.isUsable()) {
            if (disconnectTimer !== null) clearTimeout(disconnectTimer)
            disconnectTimer = null
            set({
              searchingTooLong: false,
              discovery: null,
              everConnected: true,
              announceDisconnect: false,
              peerFound: true,
            })
          } else if (get().everConnected && disconnectTimer === null) {
            // 짧은 끊김은 알리지 않는다. 비행기에서는 신호가 자주
            // 흔들리는데 그때마다 빨간 띠가 뜨면 사람이 불안해진다.
            disconnectTimer = setTimeout(() => {
              if (get().connection?.isUsable() !== true) {
                set({ announceDisconnect: true })
              }
            }, ANNOUNCE_DISCONNECT_AFTER_MS)
          }

          if (!state.isUsable()) return

          // 연결이 돌아왔다. 인사하고 쌓인 것을 내보낸다.
          //
          // 인사가 먼저다. 인사에서 "나는 몇 번까지 받았다"를 주고받아야
          // 끊긴 동안 상대가 보낸 것을 되찾을 수 있다.
          void queue.run(async () => {
            const active = deps
            if (active === null) return

            await greet()

            const flush = new FlushPendingMessages(
              active.repository,
              active.transport,
              systemClock,
              ids,
            )
            await flush.execute()
            await refresh()
          })
        }),
        next.repository.onChange(() => {
          void queue.run(refresh)
        }),
      ]

      // 찾는 동안 무엇을 하는 중인지 받아 화면에 보여준다.
      // 빙글빙글 도는 표시만 두면 사용자는 앱이 멈춘 줄 안다.
      const watchable = next.transport as {
        onProgress?: (handler: (progress: DiscoveryProgress) => void) => () => void
      }
      if (typeof watchable.onProgress === 'function') {
        unsubscribes.push(
          watchable.onProgress(progress => {
            set({ discovery: progress })
          }),
        )
      }

      // 오래 못 찾으면 코드 입력을 권한다
      if (searchTimer !== null) clearTimeout(searchTimer)
      searchTimer = setTimeout(() => {
        if (get().connection?.isUsable() !== true) set({ searchingTooLong: true })
      }, HINT_AFTER_MS)

      await queue.run(refresh)
      set({ ready: true })
    },

    async send(text) {
      const content = textContent(text)
      if (!content.ok) return

      await queue.run(async () => {
        if (deps === null) return
        const conversation = get().conversation
        if (conversation === null) return

        const sender = new SendMessage(deps.transport, deps.repository, systemClock, ids)

        const result = await sender.execute({
          author: deps.me,
          content: content.value,
          conversation,
        })

        if (result.ok) {
          set({
            conversation: result.value.conversation,
            pendingCount: result.value.sentNow
              ? get().pendingCount
              : get().pendingCount + 1,
          })
          await refresh()
        }
      })
    },

    /**
     * 입력 중이라고 알린다.
     *
     * 글자마다 보내면 낭비다. 3초에 한 번만 보낸다.
     * 좁은 길(블루투스)에서는 아예 안 보낸다.
     */
    sendTyping(typing: boolean) {
      const active = deps
      if (active === null) return
      if (!active.transport.currentState().isUsable()) return
      if (active.transport.kind !== 'wifi') return

      const now = Date.now()
      if (typing && now - lastTypingSentAt < 3000) return
      lastTypingSentAt = typing ? now : 0

      void active.transport.send({
        v: PROTOCOL_VERSION,
        t: 'typing',
        id: ids.next(),
        seq: 0,
        ts: now,
        p: { typing },
      })
    },

    /** 콕 찌르기. 상대 폰이 짧게 진동한다 */
    async sendNudge() {
      await queue.run(async () => {
        const active = deps
        if (active === null) return
        const conversation = get().conversation
        if (conversation === null) return

        const sender = new SendMessage(
          active.transport,
          active.repository,
          systemClock,
          ids,
        )

        const result = await sender.execute({
          author: active.me,
          content: nudgeContent(),
          conversation,
        })

        if (result.ok) {
          set({ conversation: result.value.conversation })
          await refresh()
        }
      })
    },

    /**
     * 내 배터리를 알린다.
     *
     * **못 보내도 그만이다.** 알림용이라 실패해도 되돌릴 것이 없다.
     */
    async shareBattery(level) {
      const active = deps
      if (active === null) return

      await active.transport
        .send({
          v: PROTOCOL_VERSION,
          id: ids.next(),
          seq: 0,
          ts: systemClock.epochMillis(),
          t: 'presence',
          p: { foreground: true, batteryLevel: level },
        })
        .catch(() => undefined)
    },

    async sendSticker(pose) {
      await queue.run(async () => {
        const active = deps
        if (active === null) return
        const conversation = get().conversation
        if (conversation === null) return

        const content = stickerContent(active.profile.character, pose)
        if (!content.ok) return

        const sender = new SendMessage(
          active.transport,
          active.repository,
          systemClock,
          ids,
        )

        const result = await sender.execute({
          author: active.me,
          content: content.value,
          conversation,
        })

        if (result.ok) {
          set({
            conversation: result.value.conversation,
            pendingCount: result.value.sentNow
              ? get().pendingCount
              : get().pendingCount + 1,
          })
          await refresh()
        }
      })
    },

    /**
     * 사진을 보낸다.
     *
     * **줄을 세우지 않는다.** 사진은 오래 걸리는데, 줄을 세우면 그동안
     * 글도 못 보낸다. 대신 한 번에 한 장만 보내게 막는다.
     */
    async sendPhoto(from, caption, size) {
      const active = deps
      if (active === null || get().sendingPhoto) return

      set({ sendingPhoto: true })

      try {
        const picked =
          from === 'camera'
            ? await active.picker.takePhoto()
            : await active.picker.pickFromLibrary()

        if (!picked.ok || picked.value === null) return

        // 고르는 동안만 잠근다. 보내는 동안까지 잠그면 사진을 하나씩만 보낼 수
        // 있는데, 블루투스에서는 한 장에 몇십 초라 답답하다. 여러 장을 같이
        // 보내도 조각마다 사진 번호가 있어 섞이지 않는다.
        set({ sendingPhoto: false })

        const conversation = get().conversation
        if (conversation === null) return

        const sender = new SendPhoto({
          transport: active.transport,
          repository: active.repository,
          assets: active.assets,
          resizer: active.resizer,
          clock: systemClock,
          ids,
        })

        const result = await sender.execute({
          author: active.me,
          conversation,
          uri: picked.value.uri,
          ...(caption === undefined ? {} : { caption }),
          ...(size === undefined ? {} : { size }),
          onProgress: (sent, total, assetId) => {
            set({
              assetProgress: {
                ...get().assetProgress,
                [assetId]: total === 0 ? 1 : sent / total,
              },
            })
          },
        })

        if (result.ok) {
          // 내가 보낸 사진은 이미 기기에 있다. 바로 보여준다.
          const { [result.value.assetId]: _sent, ...rest } = get().assetProgress
          set({
            conversation: result.value.conversation,
            assetProgress: rest,
            assetPaths: {
              ...get().assetPaths,
              [result.value.assetId]: active.assets.pathOf(result.value.assetId),
            },
          })
          await refresh()
        }
      } finally {
        set({ sendingPhoto: false })
      }
    },

    async startRecording() {
      const active = deps
      if (active === null || get().recording) return

      const started = await active.recorder.start()
      if (started.ok) set({ recording: true })
    },

    async stopRecordingAndSend() {
      const active = deps
      if (active === null || !get().recording) return

      set({ recording: false })

      const recorded = await active.recorder.stop()
      // 너무 짧거나 못 읽었다. 조용히 넘어간다.
      if (!recorded.ok) return

      // **블루투스면 바로 안 보낸다.** 좁은 길이라 10초 녹음이 15초쯤
      // 걸린다. 얼마나 걸릴지 알려주고 사용자가 고른 뒤에 보낸다.
      if (get().connection?.link === 'ble') {
        heldVoice = recorded.value
        set({
          pendingVoice: {
            byteLength: recorded.value.byteLength,
            durationMs: recorded.value.durationMs,
          },
        })
        return
      }

      await sendRecorded(recorded.value)
    },

    async sendPendingVoice() {
      const held = heldVoice
      heldVoice = null
      set({ pendingVoice: null })
      if (held === null) return
      await sendRecorded(held)
    },

    discardPendingVoice() {
      heldVoice = null
      set({ pendingVoice: null })
    },

    async cancelRecording() {
      const active = deps
      if (active === null) return

      set({ recording: false })
      await active.recorder.cancel()
    },

    async playVoice(assetId) {
      const active = deps
      if (active === null) return

      const path = get().assetPaths[assetId]
      // 아직 다 안 왔다. 조각이 도착하면 그때 들을 수 있다.
      if (path === undefined) return

      /**
       * 다 들으면 표시를 지운다.
       *
       * **이게 있어야 다음 것이 이어진다.** 안 지우면 "지금 나오는
       * 중" 으로 남아서 저절로 들려주기가 한 번에 멎는다.
       */
      stopListening?.()
      stopListening = active.voicePlayer.onFinished(() => {
        set({ playingVoice: null })
      })

      const played = await active.voicePlayer.play(path)
      set({ playingVoice: played.ok ? assetId : null })
    },

    async stopVoice() {
      const active = deps
      if (active === null) return

      stopListening?.()
      stopListening = null

      await active.voicePlayer.stop()
      set({ playingVoice: null })
    },

    async shareFlight(remainingMs, totalMs) {
      const active = deps
      if (active === null) return

      const remaining = Math.max(0, Math.round(remainingMs))
      const total = totalMs === undefined ? undefined : Math.max(1, Math.round(totalMs))

      // 못 보내도 내 화면에는 뜬다. 상대는 다음에 붙을 때 다시 알린다.
      await active.transport.send({
        v: PROTOCOL_VERSION,
        id: ids.next(),
        seq: 0,
        ts: systemClock.epochMillis(),
        t: 'flight',
        // 끌 때(0)는 총 길이를 안 보낸다. 규약이 양수만 받는다.
        p:
          remaining === 0 || total === undefined
            ? { remainingMs: remaining }
            : { remainingMs: remaining, totalMs: total },
      })
    },

    async sendDoodle(strokes) {
      await queue.run(async () => {
        const active = deps
        if (active === null) return
        const conversation = get().conversation
        if (conversation === null) return

        const content = doodleContent(strokes)
        // 도메인이 거절하면 그냥 안 보낸다. 빈 낙서이거나 너무 크다.
        if (!content.ok) return

        const sender = new SendMessage(
          active.transport,
          active.repository,
          systemClock,
          ids,
        )

        const result = await sender.execute({
          author: active.me,
          content: content.value,
          conversation,
        })

        if (result.ok) {
          set({
            conversation: result.value.conversation,
            pendingCount: result.value.sentNow
              ? get().pendingCount
              : get().pendingCount + 1,
          })
          await refresh()
        }
      })
    },

    async loadOlder() {
      await queue.run(async () => {
        if (deps === null) return
        const oldest = get().messages[0]
        if (oldest === undefined) return

        const loader = new LoadConversation(deps.repository)
        const older = await loader.older(oldest)
        if (!older.ok) return

        set({
          messages: [...older.value.messages, ...get().messages],
          hasMore: older.value.hasMore,
        })
      })
    },

    async markVisibleAsRead() {
      await queue.run(async () => {
        if (deps === null) return
        const conversation = get().conversation
        if (conversation === null) return

        const marker = new MarkAsRead(deps.repository, deps.transport, systemClock, ids)

        const result = await marker.execute({
          me: deps.me,
          messages: get().messages,
          conversation,
        })

        if (result.ok && result.value.readCount > 0) {
          set({ conversation: result.value.conversation })
          await refresh()
        }
      })
    },

    stop() {
      for (const stop of unsubscribes) stop()
      unsubscribes = []
      if (typingTimer !== null) clearTimeout(typingTimer)
      typingTimer = null
      if (searchTimer !== null) clearTimeout(searchTimer)
      searchTimer = null
      if (disconnectTimer !== null) clearTimeout(disconnectTimer)
      disconnectTimer = null
      deps = null
      set({ ready: false, messages: [], conversation: null })
    },
  }
})

/** 이보다 오래된 사진·음성은 다시 달라고 하지 않는다. 비행 하나 길이다 */
const TRACK_ASSETS_WITHIN_MS = 12 * 60 * 60 * 1000
