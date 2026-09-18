import type { Conversation } from '@/domain/message/Conversation'
import { Message } from '@/domain/message/Message'
import { messageId } from '@/domain/message/MessageId'
import type { CharacterId } from '@/domain/peer/Character'
import { type PeerId, peerId } from '@/domain/peer/PeerId'
import type { Clock } from '@/domain/shared/Clock'
import type { DomainError } from '@/domain/shared/DomainError'
import type { IdGenerator } from '@/domain/shared/IdGenerator'
import { ok, type Result } from '@/domain/shared/Result'
import type { ConversationRepository } from '../ports/ConversationRepository'
import {
  type HelloPayload,
  type MessagePayload,
  PROTOCOL_VERSION,
  type SyncRequestPayload,
  type SyncResponsePayload,
} from '../ports/Envelope'
import type { MessageTransport } from '../ports/MessageTransport'

/**
 * 다시 붙었을 때 놓친 것을 채운다.
 *
 * **이게 없으면 메시지가 조용히 사라진다.**
 *
 * 이런 일이 벌어진다.
 *
 *   1. 안드로이드가 메시지 다섯 개를 보낸다
 *   2. 아이폰이 그 사이 끊겨 있어 못 받는다
 *   3. 안드로이드는 이미 보냈다고 여겨 다시 보내지 않는다
 *   4. 다시 붙어도 아이폰은 그 다섯 개를 영영 모른다
 *
 * 그래서 인사할 때 **"나는 네 것을 몇 번까지 받았다"** 를 서로 알려주고,
 * 빠진 것을 골라 다시 받는다. (docs/04-transport-spec.md 2.5)
 */
export class ConversationSync {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly transport: MessageTransport,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** 연결되면 곧바로 인사한다 */
  async greet(input: GreetInput): Promise<Result<void, DomainError>> {
    // 상대를 아직 모르면 0 을 보낸다. 그러면 상대가 자기 것을 전부
    // 다시 보내는데, 이미 있는 건 저장소가 걸러내므로 안전하다.
    const peer = input.peerId === undefined ? null : peerId(input.peerId)
    const lastSeenSeq =
      peer?.ok === true ? input.conversation.highestSeqFrom(peer.value) : 0

    return this.transport.send({
      v: PROTOCOL_VERSION,
      t: 'hello',
      id: this.ids.next(),
      seq: 0,
      ts: this.clock.epochMillis(),
      p: {
        peerId: input.me,
        displayName: input.displayName,
        character: input.character,
        lastSeenSeq,
        appVersion: input.appVersion,
      },
    })
  }

  /**
   * 상대가 인사했다.
   *
   * 답을 보내고, 내가 놓친 게 있으면 달라고 한다.
   */
  async onHello(input: OnHelloInput): Promise<Result<HelloOutcome, DomainError>> {
    const theirs = peerId(input.hello.peerId)
    if (!theirs.ok) return theirs

    await this.transport.send({
      v: PROTOCOL_VERSION,
      t: 'hello_ack',
      id: this.ids.next(),
      seq: 0,
      ts: this.clock.epochMillis(),
      p: {
        peerId: input.me,
        displayName: input.displayName,
        character: input.character,
        lastSeenSeq: input.conversation.highestSeqFrom(theirs.value),
        appVersion: input.appVersion,
      },
    })

    // **여기가 핵심이다.** 상대가 "네 것을 3번까지 받았다"고 알려줬다.
    // 내가 5번까지 보냈다면 4, 5를 다시 보내야 한다.
    //
    // 놓친 쪽은 자기가 뭘 놓쳤는지 모른다. 하나도 못 받았으면 빈틈조차
    // 안 보이기 때문이다. 그래서 **보낸 쪽이 책임진다.**
    const resent = await this.resendSince(
      input.me,
      input.hello.lastSeenSeq,
      input.conversation.nextOutgoingSeq,
    )

    // 내 쪽에 빈틈이 있으면 그것도 달라고 한다.
    // (중간만 놓친 경우는 이걸로 잡힌다)
    const requested = await this.requestMissing(input.conversation, theirs.value)

    return ok({
      peer: {
        peerId: input.hello.peerId,
        displayName: input.hello.displayName,
        character: input.hello.character,
      },
      requestedSeqs: requested,
      resent,
    })
  }

  /**
   * 상대가 못 받은 내 메시지를 다시 보낸다.
   *
   * 상대가 인사하며 알려준 "네 것을 몇 번까지 받았다"를 기준으로,
   * 그 뒤에 내가 보낸 것을 전부 찾아 다시 보낸다.
   */
  private async resendSince(
    me: string,
    peerLastSeenSeq: number,
    myNextSeq: number,
  ): Promise<number> {
    const mine = peerId(me)
    if (!mine.ok) return 0

    const found: MessagePayload[] = []

    for (let seq = peerLastSeenSeq + 1; seq < myNextSeq; seq += 1) {
      const message = await this.repository.findBySeq(mine.value, seq)
      if (!message.ok || message.value === null) continue

      found.push({
        messageId: message.value.id,
        author: message.value.author,
        content: message.value.content,
        sentAt: message.value.sentAt.getTime(),
        messageSeq: message.value.seq,
      })
    }

    if (found.length === 0) return 0

    for (let start = 0; start < found.length; start += SYNC_BATCH) {
      await this.transport.send({
        v: PROTOCOL_VERSION,
        t: 'sync_response',
        id: this.ids.next(),
        seq: 0,
        ts: this.clock.epochMillis(),
        p: { messages: found.slice(start, start + SYNC_BATCH), unavailableSeqs: [] },
      })
    }

    return found.length
  }

  /**
   * 내가 못 받은 것을 달라고 한다.
   *
   * 두 가지를 합쳐 본다.
   *   · 순번 사이에 빈 자리 (3, 4, 6 이 왔으면 5)
   *   · 상대가 "나는 7번까지 보냈다"고 했는데 내가 5번까지만 받은 경우
   */
  private async requestMissing(
    conversation: Conversation,
    peer: PeerId,
  ): Promise<number[]> {
    const missing = conversation.missingSeqs(peer)
    if (missing.length === 0) return []

    await this.transport.send({
      v: PROTOCOL_VERSION,
      t: 'sync_request',
      id: this.ids.next(),
      seq: 0,
      ts: this.clock.epochMillis(),
      p: { missingSeqs: missing.slice(0, 500) },
    })

    return missing
  }

  /**
   * 상대가 놓친 것을 달라고 한다.
   *
   * 없는 것은 없다고 알려준다. 그래야 상대가 영원히 요청하지 않는다.
   */
  async onSyncRequest(input: SyncRequestInput): Promise<Result<number, DomainError>> {
    const found: MessagePayload[] = []
    const unavailable: number[] = []

    for (const seq of input.payload.missingSeqs) {
      const message = await this.repository.findBySeq(input.me, seq)
      if (!message.ok) return message

      if (message.value === null) {
        unavailable.push(seq)
        continue
      }

      found.push({
        messageId: message.value.id,
        author: message.value.author,
        content: message.value.content,
        sentAt: message.value.sentAt.getTime(),
        messageSeq: message.value.seq,
      })
    }

    // 한 번에 너무 많이 보내면 좁은 길이 막힌다. 200건씩 나눠 보낸다.
    for (let start = 0; start < found.length; start += SYNC_BATCH) {
      const batch = found.slice(start, start + SYNC_BATCH)

      const sent = await this.transport.send({
        v: PROTOCOL_VERSION,
        t: 'sync_response',
        id: this.ids.next(),
        seq: 0,
        ts: this.clock.epochMillis(),
        p: {
          messages: batch,
          unavailableSeqs: start === 0 ? unavailable : [],
        },
      })
      if (!sent.ok) return sent
    }

    // 보낼 게 하나도 없어도 "없다"는 답은 해야 한다
    if (found.length === 0 && unavailable.length > 0) {
      const sent = await this.transport.send({
        v: PROTOCOL_VERSION,
        t: 'sync_response',
        id: this.ids.next(),
        seq: 0,
        ts: this.clock.epochMillis(),
        p: { messages: [], unavailableSeqs: unavailable },
      })
      if (!sent.ok) return sent
    }

    return ok(found.length)
  }

  /**
   * 놓쳤던 것이 왔다.
   *
   * 이미 있는 것은 저장소가 걸러낸다.
   */
  async onSyncResponse(
    input: SyncResponseInput,
  ): Promise<Result<SyncOutcome, DomainError>> {
    let conversation = input.conversation
    let restored = 0

    for (const payload of input.payload.messages) {
      const rebuilt = this.rebuild(payload)
      if (!rebuilt.ok) continue

      const accepted = conversation.accept(rebuilt.value)
      if (!accepted.accepted) continue

      const saved = await this.repository.save(rebuilt.value)
      if (!saved.ok) {
        if (saved.error.code === 'duplicate') continue
        return saved
      }

      conversation = accepted.conversation
      restored += 1
    }

    return ok({ conversation, restored })
  }

  private rebuild(payload: MessagePayload): Result<Message, DomainError> {
    const id = messageId(payload.messageId)
    if (!id.ok) return id

    const author = peerId(payload.author)
    if (!author.ok) return author

    return Message.received({
      id: id.value,
      author: author.value,
      content: payload.content,
      seq: payload.messageSeq,
      sentAt: new Date(payload.sentAt),
      now: this.clock.now(),
    })
  }
}

/** 한 번에 보내는 개수 */
const SYNC_BATCH = 200

export interface GreetInput {
  readonly me: string
  readonly displayName: string
  readonly character: CharacterId
  readonly appVersion: string
  readonly conversation: Conversation
  /** 상대 식별자. 아직 모르면 없다 */
  readonly peerId?: string
}

export interface OnHelloInput extends Omit<GreetInput, 'peerId'> {
  readonly hello: HelloPayload
}

export interface HelloOutcome {
  readonly peer: {
    readonly peerId: string
    readonly displayName: string
    readonly character: CharacterId
  }
  /** 내가 못 받아서 달라고 한 순번들 */
  readonly requestedSeqs: readonly number[]
  /** 상대가 못 받아서 내가 다시 보낸 개수 */
  readonly resent: number
}

export interface SyncRequestInput {
  /** 내 식별자. 상대가 요청한 것은 내가 보낸 메시지다 */
  readonly me: PeerId
  readonly payload: SyncRequestPayload
}

export interface SyncResponseInput {
  readonly payload: SyncResponsePayload
  readonly conversation: Conversation
}

export interface SyncOutcome {
  readonly conversation: Conversation
  /** 되살린 개수 */
  readonly restored: number
}
