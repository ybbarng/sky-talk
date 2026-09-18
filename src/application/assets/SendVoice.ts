import type { Conversation } from '@/domain/message/Conversation'
import { voiceContent } from '@/domain/message/MessageContent'
import type { PeerId } from '@/domain/peer/PeerId'
import type { Clock } from '@/domain/shared/Clock'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import type { IdGenerator } from '@/domain/shared/IdGenerator'
import { err, ok, type Result } from '@/domain/shared/Result'
import { SendMessage } from '../messaging/SendMessage'
import type { AssetStore } from '../ports/AssetTransfer'
import type { ConversationRepository } from '../ports/ConversationRepository'
import type { MessageTransport } from '../ports/MessageTransport'
import { isSendable } from './AssetChunks'
import { ChunkSender } from './ChunkSender'

/**
 * 음성 메시지를 보낸다.
 *
 * ## 사진과 같은 길로 간다
 *
 * ```
 * 녹음해둔 파일 → 기기에 두기 → 메시지 저장 → 메시지 보내기 → 조각 보내기
 * ```
 *
 * **메시지가 먼저 간다.** 그래야 상대 화면에 "23초짜리 음성" 이 바로
 * 뜬다. 조각을 다 보낸 뒤에 메시지를 보내면 그동안 상대는 아무것도
 * 모른 채 기다린다.
 *
 * 조각을 보내다 끊겨도 메시지는 남는다. 다시 붙으면 못 받은 조각만
 * 다시 보낸다. 조각을 나르는 일은 사진과 똑같아서 `SendPhoto` 의
 * 것을 그대로 쓴다.
 *
 * ## 통화와 무엇이 다른가
 *
 * 통화는 **둘 다 지금 듣고 있어야** 한다. 음성 메시지는 아니다.
 * 상대가 자고 있으면 나중에 들으면 되고, 끊겨 있어도 보내둘 수 있다.
 * 세 시간 비행에서 이쪽이 더 자주 쓰인다.
 *
 * (docs/05-messaging-spec.md 음성 항목)
 */

export interface SendVoiceDeps {
  readonly transport: MessageTransport
  readonly repository: ConversationRepository
  readonly assets: AssetStore
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface SendVoiceInput {
  readonly author: PeerId
  readonly conversation: Conversation
  /** 녹음이 끝난 파일 (base64) */
  readonly base64: string
  readonly durationMs: number
  readonly byteLength: number
  /** 몇 조각 중 몇 조각이 갔나. 좁은 길에서는 소수도 온다 */
  onProgress?: (sent: number, total: number, assetId: string) => void
}

export interface SendVoiceOutcome {
  readonly assetId: string
  readonly conversation: Conversation
  /** 조각이 다 나갔나. 끊겨 있으면 false */
  readonly chunksSent: boolean
}

export class SendVoice {
  constructor(private readonly deps: SendVoiceDeps) {}

  async execute(input: SendVoiceInput): Promise<Result<SendVoiceOutcome, DomainError>> {
    if (!isSendable(input.byteLength)) {
      return err(domainError('too-long', '음성이 너무 커서 보낼 수 없어요', 'voice'))
    }

    const assetId = this.deps.ids.next()

    // 1. 기기에 둔다. 보내기 전에 둬야 도중에 앱이 죽어도 남는다.
    const stored = await this.deps.assets.write(assetId, input.base64)
    if (!stored.ok) return stored

    const content = voiceContent({
      assetId,
      durationMs: input.durationMs,
      byteLength: input.byteLength,
    })
    if (!content.ok) return content

    // 2. 메시지를 저장하고 보낸다. **조각보다 먼저다.**
    const sender = new SendMessage(
      this.deps.transport,
      this.deps.repository,
      this.deps.clock,
      this.deps.ids,
    )

    const sent = await sender.execute({
      author: input.author,
      content: content.value,
      conversation: input.conversation,
    })
    if (!sent.ok) return sent

    // 3. 조각을 보낸다. 실패해도 메시지는 이미 남아 있다.
    //    나르는 일은 사진과 똑같아서 같은 것을 쓴다.
    const carrier = new ChunkSender({
      transport: this.deps.transport,
      assets: this.deps.assets,
      clock: this.deps.clock,
      ids: this.deps.ids,
    })

    const chunksSent = await carrier.send(assetId, input.byteLength, input.onProgress)

    return ok({ assetId, conversation: sent.value.conversation, chunksSent })
  }
}
