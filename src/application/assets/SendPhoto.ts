import type { Conversation } from '@/domain/message/Conversation'
import { photoContent } from '@/domain/message/MessageContent'
import type { PeerId } from '@/domain/peer/PeerId'
import type { Clock } from '@/domain/shared/Clock'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import type { IdGenerator } from '@/domain/shared/IdGenerator'
import { err, ok, type Result } from '@/domain/shared/Result'
import { SendMessage } from '../messaging/SendMessage'
import type { AssetStore, ImageResizer } from '../ports/AssetTransfer'
import type { ConversationRepository } from '../ports/ConversationRepository'
import type { MessageTransport } from '../ports/MessageTransport'
import {
  CHUNK_BYTES,
  isSendable,
  JPEG_QUALITY,
  NARROW_JPEG_QUALITY,
  NARROW_LONG_EDGE,
  RESIZE_LONG_EDGE,
} from './AssetChunks'
import { ChunkSender } from './ChunkSender'

/**
 * 사진을 보낸다.
 *
 * ## 순서가 중요하다
 *
 * ```
 * 줄이기 → 기기에 두기 → 메시지 저장 → 메시지 보내기 → 조각 보내기
 * ```
 *
 * **메시지가 먼저 간다.** 그래야 상대 화면에 흐릿한 미리보기라도 바로
 * 뜬다. 조각을 다 보낸 뒤에 메시지를 보내면, 그동안 상대는 아무것도
 * 모른 채 기다린다.
 *
 * 조각을 보내다 끊겨도 메시지는 남는다. 다시 붙으면 못 받은 조각만
 * 다시 보낸다.
 *
 * (docs/05-messaging-spec.md 사진 항목 · T22)
 */

export interface SendPhotoDeps {
  readonly transport: MessageTransport
  readonly repository: ConversationRepository
  readonly assets: AssetStore
  readonly resizer: ImageResizer
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface SendPhotoInput {
  readonly author: PeerId
  readonly conversation: Conversation
  readonly uri: string
  readonly caption?: string
  /** 좁은 길(블루투스)로 간다. 훨씬 작게 줄인다 */
  readonly narrow?: boolean
  /** 몇 조각 중 몇 조각이 갔나. 좁은 길에서는 소수도 온다 */
  onProgress?: (sent: number, total: number, assetId: string) => void
}

export interface SendPhotoOutcome {
  readonly assetId: string
  readonly conversation: Conversation
  /** 조각이 다 나갔나. 끊겨 있으면 false */
  readonly chunksSent: boolean
}

export class SendPhoto {
  constructor(private readonly deps: SendPhotoDeps) {}

  async execute(input: SendPhotoInput): Promise<Result<SendPhotoOutcome, DomainError>> {
    // 1. 줄인다. 원본을 그대로 보내면 사설망이 막혀 글까지 못 간다.
    //    좁은 길이면 훨씬 더 줄인다. 안 그러면 몇 분이 걸린다.
    const resized = await this.deps.resizer.resize(
      input.uri,
      input.narrow === true ? NARROW_LONG_EDGE : RESIZE_LONG_EDGE,
      input.narrow === true ? NARROW_JPEG_QUALITY : JPEG_QUALITY,
    )
    if (!resized.ok) return resized

    if (!isSendable(resized.value.byteLength)) {
      return err(domainError('too-long', '사진이 너무 커서 보낼 수 없어요', 'photo'))
    }

    const assetId = this.deps.ids.next()

    // 2. 기기에 둔다. 보내기 전에 둬야 도중에 앱이 죽어도 남는다.
    const stored = await this.deps.assets.write(assetId, resized.value.base64)
    if (!stored.ok) return stored

    // 3. 흐릿한 미리보기를 만든다. 실패해도 넘어간다.
    //    미리보기가 없으면 빈 네모가 뜰 뿐, 사진은 그대로 간다.
    const preview = await this.deps.resizer.makePreview(resized.value.uri)

    const content = photoContent({
      assetId,
      width: resized.value.width,
      height: resized.value.height,
      byteLength: resized.value.byteLength,
      ...(preview.ok ? { preview: preview.value } : {}),
      ...(input.caption === undefined ? {} : { caption: input.caption }),
    })
    if (!content.ok) return content

    // 4. 메시지를 저장하고 보낸다. **조각보다 먼저다.**
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

    // 5. 조각을 보낸다. 실패해도 메시지는 이미 남아 있다.
    const chunksSent = await this.sendChunks(
      assetId,
      resized.value.byteLength,
      input.onProgress,
    )

    return ok({
      assetId,
      conversation: sent.value.conversation,
      chunksSent,
    })
  }

  /** 조각을 차례로 보낸다. 나르는 일은 `ChunkSender` 가 한다 */
  async sendChunks(
    assetId: string,
    byteLength: number,
    /** 몇 조각 중 몇 조각이 갔나. 좁은 길에서는 소수도 온다 */
    onProgress?: (sent: number, total: number, assetId: string) => void,
    only?: readonly number[],
  ): Promise<boolean> {
    const sender = new ChunkSender({
      transport: this.deps.transport,
      assets: this.deps.assets,
      clock: this.deps.clock,
      ids: this.deps.ids,
    })

    return sender.send(assetId, byteLength, onProgress, only)
  }
}

/** 한 조각이 몇 바이트인지 바깥에서도 쓴다 */
export { CHUNK_BYTES }
