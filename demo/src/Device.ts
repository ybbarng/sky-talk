import { ConversationSync } from '@/application/messaging/ConversationSync'
import { FlushPendingMessages } from '@/application/messaging/FlushPendingMessages'
import { MarkAsRead } from '@/application/messaging/MarkAsRead'
import { ReceiveMessage } from '@/application/messaging/ReceiveMessage'
import { SendMessage } from '@/application/messaging/SendMessage'
import type { Envelope } from '@/application/ports/Envelope'
import { PROTOCOL_VERSION } from '@/application/ports/Envelope'
import { SerialQueue } from '@/application/shared/SerialQueue'
import type { ConnectionState } from '@/domain/connection/ConnectionState'
import { startFlight } from '@/domain/flight/FlightTimer'
import { Conversation } from '@/domain/message/Conversation'
import type { Message } from '@/domain/message/Message'
import {
  type MessageContent,
  type StickerPose,
  nudgeContent,
  stickerContent,
  textContent,
} from '@/domain/message/MessageContent'
import type { CharacterId } from '@/domain/peer/Character'
import type { PeerId } from '@/domain/peer/PeerId'
import { systemClock } from '@/domain/shared/Clock'
import type { IdGenerator } from '@/domain/shared/IdGenerator'
import { DemoTransport } from './DemoTransport'
import { MemoryRepository } from './MemoryRepository'
import type { Side, VirtualNetwork } from './network'

/**
 * 폰 한 대.
 *
 * **여기 있는 것은 전부 진짜 앱 코드다.** 보내기·받기·읽음 표시·
 * 놓친 말 되찾기 모두 `src/application` 의 것을 그대로 쓴다.
 * 흉내 내는 것은 저장소와 선뿐이다.
 *
 * 실제 앱의 `useChatStore` 와 같은 자리에 있다.
 */

export interface DeviceProfile {
  readonly me: PeerId
  readonly displayName: string
  readonly character: CharacterId
  /** 이 폰의 주인이 상대를 뭐라고 부르는가. 첫 실행 안내에서 적는다 */
  readonly peerNickname: string
}

export class Device {
  conversation: Conversation
  readonly repository = new MemoryRepository()
  readonly transport: DemoTransport

  /** 화면에 뿌릴 것들 */
  messages: Message[] = []
  connection: ConnectionState
  peerTyping = false
  /** 목적지 도착 시각. 이 폰의 시계로 잰 것 */
  arrivesAt: number | null = null
  flightTotalMs: number | null = null
  peerId: PeerId | null = null
  peerName: string | null = null
  peerCharacter: CharacterId | null = null

  private readonly queue = new SerialQueue()
  private readonly sendMessage: SendMessage
  private readonly receiveMessage: ReceiveMessage
  private readonly flush: FlushPendingMessages
  private readonly markAsRead: MarkAsRead
  private readonly sync: ConversationSync

  private typingTimer: ReturnType<typeof setTimeout> | null = null
  private lastTypingAt = 0

  onChange: (() => void) | null = null

  constructor(
    readonly side: Side,
    readonly profile: DeviceProfile,
    net: VirtualNetwork,
    private readonly ids: IdGenerator,
  ) {
    this.conversation = Conversation.start(profile.me)
    this.transport = new DemoTransport(side, net)
    this.connection = this.transport.currentState()

    this.sendMessage = new SendMessage(
      this.transport,
      this.repository,
      systemClock,
      ids,
    )
    this.receiveMessage = new ReceiveMessage(
      this.repository,
      this.transport,
      systemClock,
      ids,
    )
    this.flush = new FlushPendingMessages(
      this.repository,
      this.transport,
      systemClock,
      ids,
    )
    this.markAsRead = new MarkAsRead(
      this.repository,
      this.transport,
      systemClock,
      ids,
    )
    this.sync = new ConversationSync(
      this.repository,
      this.transport,
      systemClock,
      ids,
    )

    this.transport.onReceive(envelope => {
      void this.queue.run(() => this.handle(envelope))
    })

    this.transport.onStateChange(state => {
      this.connection = state
      this.onChange?.()

      // **이어지면 곧바로 인사한다.** 이걸 해야 놓친 말을 채울 수 있다.
      if (state.isUsable()) {
        void (async () => {
          await this.greet()
          await this.flushPending()
        })()
      }
    })
  }

  /** 붙어본다. 붙는 쪽은 먼저 찾는다 */
  async connect(): Promise<string | null> {
    const result = await this.transport.connect()
    return result.ok ? null : result.error.detail
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect()
  }

  /** 상대가 붙어왔다. 여는 쪽이 쓴다 */
  acceptIncoming(): void {
    this.transport.acceptIncoming()
  }

  async sendText(raw: string): Promise<void> {
    const content = textContent(raw)
    if (!content.ok) return
    await this.send(content.value)
  }

  async sendSticker(pose: StickerPose): Promise<void> {
    const content = stickerContent(this.profile.character, pose)
    if (!content.ok) return
    await this.send(content.value)
  }

  /** 남은 비행 시간을 정하고 상대에게도 알린다 */
  async shareFlight(remainingMs: number): Promise<void> {
    const timer = startFlight(remainingMs, Date.now())
    this.arrivesAt = timer?.arrivesAt ?? null
    this.flightTotalMs = timer === null ? null : remainingMs

    await this.transport.send({
      v: PROTOCOL_VERSION,
      id: this.ids.next(),
      seq: 0,
      ts: Date.now(),
      t: 'flight',
      p: { remainingMs: Math.max(0, Math.round(remainingMs)) },
    })

    this.onChange?.()
  }

  async sendNudge(): Promise<void> {
    await this.send(nudgeContent())
  }

  private async send(content: MessageContent): Promise<void> {
    await this.queue.run(async () => {
      const result = await this.sendMessage.execute({
        author: this.profile.me,
        content,
        conversation: this.conversation,
      })

      if (result.ok) this.conversation = result.value.conversation
    })

    // 보내고 나면 입력 중 표시를 끈다
    this.tellTyping(false)
    await this.refresh()
  }

  /** 끊긴 동안 쌓인 것을 내보낸다 */
  async flushPending(): Promise<number> {
    const sent = await this.queue.run(async () => {
      const result = await this.flush.execute()
      return result.ok ? result.value.sent : 0
    })

    await this.refresh()
    return sent
  }

  /** 화면에 보이는 것을 읽음으로 친다 */
  async readAll(): Promise<void> {
    await this.queue.run(async () => {
      const result = await this.markAsRead.execute({
        me: this.profile.me,
        messages: this.messages,
        conversation: this.conversation,
      })
      if (result.ok) this.conversation = result.value.conversation
    })

    await this.refresh()
  }

  /** 다시 붙었다. 인사하고 놓친 것을 되찾는다 */
  async greet(): Promise<void> {
    await this.queue.run(async () => {
      await this.sync.greet({
        me: this.profile.me,
        displayName: this.profile.displayName,
        character: this.profile.character,
        appVersion: '0.1.0',
        conversation: this.conversation,
        ...(this.peerId === null ? {} : { peerId: this.peerId }),
      })
    })
  }

  /**
   * 글자를 치고 있다고 알린다.
   *
   * **3초에 한 번만 보낸다.** 한 글자마다 보내면 좁은 길이 막힌다.
   */
  tellTyping(typing: boolean): void {
    const now = Date.now()
    if (typing && now - this.lastTypingAt < 3000) return
    this.lastTypingAt = typing ? now : 0

    void this.transport.send({
      v: PROTOCOL_VERSION,
      id: this.ids.next(),
      seq: 0,
      ts: now,
      t: 'typing',
      p: { typing },
    })
  }

  async refresh(): Promise<void> {
    const page = await this.repository.loadPage({ limit: 200 })
    if (page.ok) this.messages = page.value
    this.onChange?.()
  }

  /** 대화를 처음부터 다시 읽는다. 창을 새로 연 것과 같다 */
  async reload(): Promise<void> {
    const loaded = await this.repository.load(this.profile.me)
    if (loaded.ok) this.conversation = loaded.value
    await this.refresh()
  }

  private async handle(envelope: Envelope): Promise<void> {
    if (envelope.t === 'message') {
      this.peerId = envelope.p.author as PeerId

      const result = await this.receiveMessage.execute({
        payload: envelope.p,
        conversation: this.conversation,
      })
      if (result.ok) this.conversation = result.value.conversation

      this.peerTyping = false
      await this.refresh()
      return
    }

    if (envelope.t === 'hello') {
      this.peerId = envelope.p.peerId as PeerId
      this.peerName = envelope.p.displayName
      this.peerCharacter = envelope.p.character

      const outcome = await this.sync.onHello({
        me: this.profile.me,
        displayName: this.profile.displayName,
        character: this.profile.character,
        appVersion: '0.1.0',
        hello: envelope.p,
        conversation: this.conversation,
      })

      void outcome
      await this.refresh()
      return
    }

    if (envelope.t === 'hello_ack') {
      this.peerId = envelope.p.peerId as PeerId
      this.peerName = envelope.p.displayName
      this.peerCharacter = envelope.p.character
      this.onChange?.()
      return
    }

    if (envelope.t === 'sync_request') {
      await this.sync.onSyncRequest({ me: this.profile.me, payload: envelope.p })
      return
    }

    if (envelope.t === 'sync_response') {
      const outcome = await this.sync.onSyncResponse({
        payload: envelope.p,
        conversation: this.conversation,
      })
      if (outcome.ok) this.conversation = outcome.value.conversation
      await this.refresh()
      return
    }

    if (envelope.t === 'flight') {
      // **내 시계로 다시 센다.** 상대 시계를 그대로 쓰면 시차를
      // 넘을 때 엉뚱해진다.
      const timer = startFlight(envelope.p.remainingMs, Date.now())
      this.arrivesAt = timer?.arrivesAt ?? null
      this.flightTotalMs = timer === null ? null : envelope.p.remainingMs
      this.onChange?.()
      return
    }

    if (envelope.t === 'typing') {
      this.peerTyping = envelope.p.typing

      // 5초 동안 새 신호가 없으면 지운다. 상대가 앱을 닫으면
      // "입력 중" 이 영원히 남는다.
      if (this.typingTimer !== null) clearTimeout(this.typingTimer)
      this.typingTimer = setTimeout(() => {
        this.peerTyping = false
        this.onChange?.()
      }, 5000)

      this.onChange?.()
      return
    }

    if (envelope.t === 'ack' || envelope.t === 'read') {
      // 상태가 바뀐다. 화면의 체크 표시가 달라진다.
      await this.refresh()
      return
    }
  }
}
