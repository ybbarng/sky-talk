import type { Clock } from '@/domain/shared/Clock'
import type { IdGenerator } from '@/domain/shared/IdGenerator'
import type { AssetStore } from '../ports/AssetTransfer'
import type { MessageTransport } from '../ports/MessageTransport'
import { chunkCountFor } from './AssetChunks'

/**
 * 기기에 둔 것을 조각내어 보낸다.
 *
 * **무엇인지 묻지 않는다.** 사진이든 음성이든 `assetId` 로 찾아
 * 바이트만 나른다. 그래서 새로운 종류를 더할 때 여기는 안 고쳐도 된다.
 *
 * (docs/05-messaging-spec.md 사진 항목 · T22)
 */

export interface ChunkSenderDeps {
  readonly transport: MessageTransport
  readonly assets: AssetStore
  readonly clock: Clock
  readonly ids: IdGenerator
}

export class ChunkSender {
  constructor(private readonly deps: ChunkSenderDeps) {}

  /**
   * 조각을 차례로 보낸다.
   *
   * **하나가 실패하면 거기서 멈춘다.** 끊긴 상태에서 나머지를 계속
   * 밀어 넣어봐야 다 실패하고, 그동안 글이 밀린다. 다시 붙으면
   * 상대가 못 받은 것만 달라고 한다.
   */
  async send(
    assetId: string,
    byteLength: number,
    onProgress?: (sent: number, total: number, assetId: string) => void,
    only?: readonly number[],
  ): Promise<boolean> {
    const total = chunkCountFor(byteLength)
    const indexes = only ?? range(total)

    for (const [position, index] of indexes.entries()) {
      const chunk = await this.deps.assets.readChunk(assetId, index)
      if (!chunk.ok) return false

      const sent = await this.deps.transport.send(
        {
          v: 1,
          id: this.deps.ids.next(),
          seq: 0,
          ts: this.deps.clock.epochMillis(),
          t: 'asset_chunk',
          p: { assetId, index, data: chunk.value },
        },
        // 좁은 길은 조각 하나를 몇십 초에 걸쳐 보낸다. 그 사이도 알린다.
        fraction =>
          onProgress?.(position + Math.min(1, fraction), indexes.length, assetId),
      )

      if (!sent.ok) return false
      onProgress?.(position + 1, indexes.length, assetId)
    }

    return true
  }
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index)
}
