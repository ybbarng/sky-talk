import { FakeClock } from '@test/fakes/FakeClock'
import { FakeIdGenerator } from '@test/fakes/FakeIdGenerator'
import { NodeSqlDatabase } from '@test/fakes/NodeSqlDatabase'
import { ConversationSync } from '@/application/messaging/ConversationSync'
import { FlushPendingMessages } from '@/application/messaging/FlushPendingMessages'
import { MarkAsRead } from '@/application/messaging/MarkAsRead'
import { ReceiveMessage } from '@/application/messaging/ReceiveMessage'
import { SendMessage } from '@/application/messaging/SendMessage'
import type { Envelope } from '@/application/ports/Envelope'

import { SerialQueue } from '@/application/shared/SerialQueue'
import { Conversation } from '@/domain/message/Conversation'
import type { Message } from '@/domain/message/Message'
import type { MessageContent } from '@/domain/message/MessageContent'
import type { PeerId } from '@/domain/peer/PeerId'
import { migrate } from '@/infrastructure/persistence/migrations'
import { SqliteConversationRepository } from '@/infrastructure/persistence/SqliteConversationRepository'
import type { WiredTransport } from './WiredTransportPair'

/**
 * 진짜에 가장 가까운 폰 한 대.
 *
 * **가짜 저장소를 안 쓴다.** 실제 SQLite 를 열고, 실제 SQL 로 읽고 쓴다.
 * 오가는 것도 실제 봉투 형식과 바이트 자르기를 거친다.
 *
 * 기존 `two-devices` 시험은 가짜 저장소와 봉투를 그대로 넘기는 연결을
 * 쓴다. 그건 **절차**를 보는 데는 맞지만, SQL 이나 형식 검사가 어긋난
 * 것은 못 잡는다. 여기는 그걸 잡으려고 만든다.
 *
 * (docs/09-testing.md 3장)
 */
export class WiredDevice {
  conversation: Conversation
  readonly repository: SqliteConversationRepository
  readonly clock = new FakeClock()
  readonly ids: FakeIdGenerator

  /** 대화 상태를 건드리는 일은 전부 줄을 세운다. 실제 앱과 같은 구조다 */
  private readonly queue = new SerialQueue()

  private readonly sendMessage: SendMessage
  private readonly receiveMessage: ReceiveMessage
  private readonly flush: FlushPendingMessages
  private readonly markAsRead: MarkAsRead
  private readonly sync: ConversationSync

  /** 받은 봉투 중 우리가 안 다루는 것. 버려졌는지 보려고 센다 */
  readonly ignored: Envelope[] = []

  private constructor(
    readonly me: PeerId,
    readonly transport: WiredTransport,
    readonly db: NodeSqlDatabase,
    idSeed: number,
    readonly name: string,
  ) {
    this.ids = new FakeIdGenerator(idSeed)
    this.conversation = Conversation.start(me)
    this.repository = new SqliteConversationRepository(db)

    this.sendMessage = new SendMessage(transport, this.repository, this.clock, this.ids)
    this.receiveMessage = new ReceiveMessage(
      this.repository,
      transport,
      this.clock,
      this.ids,
    )
    this.flush = new FlushPendingMessages(
      this.repository,
      transport,
      this.clock,
      this.ids,
    )
    this.markAsRead = new MarkAsRead(this.repository, transport, this.clock, this.ids)
    this.sync = new ConversationSync(this.repository, transport, this.clock, this.ids)

    transport.onReceive(envelope => {
      void this.onEnvelope(envelope)
    })
  }

  static async start(
    me: PeerId,
    transport: WiredTransport,
    idSeed: number,
    name = '나',
  ): Promise<WiredDevice> {
    const db = new NodeSqlDatabase()
    const migrated = await migrate(db)
    if (!migrated.ok) throw new Error('표를 만들지 못했다')

    return new WiredDevice(me, transport, db, idSeed, name)
  }

  async close(): Promise<void> {
    await this.db.close()
  }

  async send(content: MessageContent): Promise<Message | null> {
    return this.queue.run(async () => {
      const result = await this.sendMessage.execute({
        author: this.me,
        content,
        conversation: this.conversation,
      })

      if (!result.ok) return null
      this.conversation = result.value.conversation
      return result.value.message
    })
  }

  /** 끊긴 동안 쌓인 것을 내보낸다 */
  async flushPending(): Promise<number> {
    return this.queue.run(async () => {
      const result = await this.flush.execute()
      return result.ok ? result.value.sent : 0
    })
  }

  /** 화면에 보이는 것을 읽음으로 친다 */
  async readAll(): Promise<void> {
    await this.queue.run(async () => {
      const messages = await this.repository.loadPage({ limit: 1000 })
      if (!messages.ok) return

      const result = await this.markAsRead.execute({
        me: this.me,
        messages: messages.value,
        conversation: this.conversation,
      })
      if (result.ok) this.conversation = result.value.conversation
    })
  }

  /**
   * 다시 붙었다. 인사하고 놓친 것을 되찾는다.
   *
   * **여기가 끊겼다 붙었을 때 말이 안 사라지게 하는 자리다.**
   */
  async greet(): Promise<void> {
    await this.queue.run(async () => {
      await this.sync.greet({
        me: this.me,
        displayName: this.name,
        character: 'aria',
        appVersion: '0.1.0',
        conversation: this.conversation,
        ...(this.knownPeer === null ? {} : { peerId: this.knownPeer }),
      })
    })
  }

  /** 지금까지 저장된 것 전부. 시각순 */
  async stored(): Promise<Message[]> {
    const page = await this.repository.loadPage({ limit: 10_000 })
    if (!page.ok) throw new Error('읽지 못했다')
    return page.value
  }

  async count(): Promise<number> {
    const result = await this.repository.count()
    return result.ok ? result.value : -1
  }

  /** 상대 식별자. 받은 메시지나 인사에서 알아낸다 */
  private knownPeer: PeerId | null = null

  private async onEnvelope(envelope: Envelope): Promise<void> {
    if (envelope.t === 'message') {
      this.knownPeer = envelope.p.author as PeerId

      await this.queue.run(async () => {
        const result = await this.receiveMessage.execute({
          payload: envelope.p,
          conversation: this.conversation,
        })
        if (result.ok) this.conversation = result.value.conversation
      })
      return
    }

    if (envelope.t === 'hello') {
      this.knownPeer = envelope.p.peerId as PeerId

      await this.queue.run(async () => {
        const outcome = await this.sync.onHello({
          me: this.me,
          displayName: this.name,
          character: 'aria',
          appVersion: '0.1.0',
          hello: envelope.p,
          conversation: this.conversation,
        })
        // 인사는 대화 상태를 바꾸지 않는다. 다시 보내기만 한다.
        void outcome
      })
      return
    }

    if (envelope.t === 'hello_ack') {
      this.knownPeer = envelope.p.peerId as PeerId
      return
    }

    if (envelope.t === 'sync_request') {
      // 상대가 못 받은 것을 달라고 한다
      await this.queue.run(async () => {
        await this.sync.onSyncRequest({ me: this.me, payload: envelope.p })
      })
      return
    }

    if (envelope.t === 'sync_response') {
      // **되찾은 것이 여기로 온다.** 이걸 안 다루면 다시 붙어도
      // 놓친 말이 영영 안 들어온다.
      await this.queue.run(async () => {
        const outcome = await this.sync.onSyncResponse({
          payload: envelope.p,
          conversation: this.conversation,
        })
        if (outcome.ok) this.conversation = outcome.value.conversation
      })
      return
    }

    if (envelope.t === 'ack' || envelope.t === 'read') {
      // 상태만 바뀐다. 대화 내용은 그대로다.
      return
    }

    this.ignored.push(envelope)
  }
}
