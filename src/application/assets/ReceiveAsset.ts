import type { AssetChunkPayload } from '@/application/ports/Envelope'
import type { Clock } from '@/domain/shared/Clock'
import type { DomainError } from '@/domain/shared/DomainError'
import type { IdGenerator } from '@/domain/shared/IdGenerator'
import { ok, type Result } from '@/domain/shared/Result'
import type { AssetStore } from '../ports/AssetTransfer'
import type { MessageTransport } from '../ports/MessageTransport'
import { AssetAssembly } from './AssetChunks'

/**
 * 사진 조각을 받아 모은다.
 *
 * **순서가 뒤바뀌어 와도 되고, 겹쳐 와도 된다.** 끊겼다 붙으면
 * 상대가 겹쳐 보내는 일이 흔하다.
 *
 * 다 모이면 하나로 합치고 알려준다. 그때 화면의 흐릿한 미리보기가
 * 진짜 사진으로 바뀐다.
 *
 * (docs/05-messaging-spec.md 사진 항목 · T22)
 */

export interface ReceiveAssetDeps {
  readonly assets: AssetStore
  readonly transport: MessageTransport
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface ReceiveAssetListeners {
  /** 얼마나 왔나. 화면에 진행률을 보여준다 */
  onProgress?: (assetId: string, ratio: number) => void
  /** 다 모였다 */
  onComplete?: (assetId: string) => void
}

export class ReceiveAsset {
  private readonly pending = new Map<string, AssetAssembly>()

  constructor(
    private readonly deps: ReceiveAssetDeps,
    private readonly listeners: ReceiveAssetListeners = {},
  ) {}

  /**
   * 사진이 온다는 것을 미리 안다.
   *
   * 메시지가 조각보다 먼저 온다. 그때 판을 깔아두면 조각이 도착하는
   * 대로 바로 담을 수 있다.
   */
  expect(assetId: string, byteLength: number): void {
    if (this.pending.has(assetId)) return
    this.pending.set(assetId, new AssetAssembly(assetId, byteLength))
  }

  async onChunk(payload: AssetChunkPayload): Promise<Result<void, DomainError>> {
    const assembly = this.pending.get(payload.assetId)
    // 모르는 사진의 조각이다. 메시지가 아직 안 왔거나 이미 끝난 것이다.
    // **버리되 연결은 그대로 둔다.**
    if (assembly === undefined) return ok(undefined)

    const marked = assembly.accept(payload.index)
    if (!marked.ok) return ok(undefined)

    const written = await this.deps.assets.appendChunk(
      payload.assetId,
      payload.index,
      payload.data,
    )
    if (!written.ok) return written

    this.listeners.onProgress?.(payload.assetId, assembly.progress())

    if (assembly.isComplete()) {
      const finished = await this.deps.assets.finish(payload.assetId)
      if (!finished.ok) return finished

      this.pending.delete(payload.assetId)
      this.listeners.onComplete?.(payload.assetId)
    }

    return ok(undefined)
  }

  /**
   * 다시 붙었을 때 못 받은 것을 달라고 한다.
   *
   * **처음부터 다시 받지 않는다.** 사설망이 느릴 때 영영 못 끝낸다.
   */
  async requestMissing(): Promise<void> {
    for (const [assetId, assembly] of this.pending) {
      const missing = assembly.missing()
      if (missing.length === 0) continue

      await this.deps.transport.send({
        v: 1,
        id: this.deps.ids.next(),
        seq: 0,
        ts: this.deps.clock.epochMillis(),
        t: 'asset_request',
        p: { assetId, missing },
      })
    }
  }

  /** 아직 받는 중인 사진들. 화면이 진행률을 그릴 때 쓴다 */
  inFlight(): Array<{
    assetId: string
    ratio: number
    /** 받은 조각 수와 전체 크기. 좁은 길에서 조각 사이의 진행을 보탤 때 쓴다 */
    received: number
    byteLength: number
  }> {
    return [...this.pending.entries()].map(([assetId, assembly]) => ({
      assetId,
      ratio: assembly.progress(),
      received: assembly.receivedCount(),
      byteLength: assembly.byteLength,
    }))
  }

  /** 이미 다 받은 사진인가 */
  async has(assetId: string): Promise<boolean> {
    return this.deps.assets.exists(assetId)
  }
}
