import { CHUNK_BYTES } from '@/application/assets/AssetChunks'
import type {
  AssetStore,
  ImageResizer,
  ResizedImage,
} from '@/application/ports/AssetTransfer'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'

/**
 * 사진을 기기에 두는 척한다.
 *
 * 조각을 제자리에 담는지 보려고 **자리마다 따로 기억한다.** 그냥
 * 이어 붙이면 순서가 뒤바뀐 것을 못 잡는다.
 */
export class FakeAssetStore implements AssetStore {
  private readonly whole = new Map<string, string>()
  private readonly parts = new Map<string, Map<number, string>>()
  failWrite = false

  async write(assetId: string, base64: string): Promise<Result<void, DomainError>> {
    if (this.failWrite) {
      return err(domainError('invalid-value', '둘 곳이 없다', 'asset'))
    }
    this.whole.set(assetId, base64)
    return ok(undefined)
  }

  async appendChunk(
    assetId: string,
    index: number,
    base64: string,
  ): Promise<Result<void, DomainError>> {
    const bucket = this.parts.get(assetId) ?? new Map<number, string>()
    bucket.set(index, base64)
    this.parts.set(assetId, bucket)
    return ok(undefined)
  }

  async finish(assetId: string): Promise<Result<string, DomainError>> {
    const bucket = this.parts.get(assetId)
    if (bucket === undefined) {
      return err(domainError('not-found', '받은 조각이 없다', 'asset'))
    }

    // 자리 순서대로 이어 붙인다. 온 순서가 아니다.
    const joined = [...bucket.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, data]) => data)
      .join('')

    this.whole.set(assetId, joined)
    this.parts.delete(assetId)
    return ok(this.pathOf(assetId))
  }

  pathOf(assetId: string): string {
    return `fake://assets/${assetId}`
  }

  async exists(assetId: string): Promise<boolean> {
    return this.whole.has(assetId)
  }

  async readChunk(assetId: string, index: number): Promise<Result<string, DomainError>> {
    const data = this.whole.get(assetId)
    if (data === undefined) {
      return err(domainError('not-found', '그런 사진이 없다', 'asset'))
    }

    const start = index * CHUNK_BYTES
    if (start >= data.length) {
      return err(domainError('not-found', '그 조각은 없다', 'asset'))
    }

    return ok(data.slice(start, start + CHUNK_BYTES))
  }

  async remove(assetId: string): Promise<Result<void, DomainError>> {
    this.whole.delete(assetId)
    this.parts.delete(assetId)
    return ok(undefined)
  }

  /** 시험에서 들여다볼 때 */
  contentOf(assetId: string): string | undefined {
    return this.whole.get(assetId)
  }
}

export class FakeImageResizer implements ImageResizer {
  /** 줄인 결과로 내놓을 바이트 수 */
  byteLength = CHUNK_BYTES * 3 + 500
  failResize = false
  failPreview = false
  /** 마지막으로 어떤 크기·화질로 줄이라고 했나. 좁은 길에서 더 줄이는지 본다 */
  lastLongEdge: number | null = null
  lastQuality: number | null = null

  async resize(
    uri: string,
    longEdge: number,
    quality: number,
  ): Promise<Result<ResizedImage, DomainError>> {
    this.lastLongEdge = longEdge
    this.lastQuality = quality
    if (this.failResize) {
      return err(domainError('invalid-value', '줄이지 못했다', 'photo'))
    }

    // 실제 base64 처럼 길이가 있는 글을 만든다
    const base64 = 'A'.repeat(this.byteLength)

    return ok({
      uri: `${uri}.resized`,
      width: 1600,
      height: 1200,
      base64,
      byteLength: this.byteLength,
    })
  }

  async makePreview(_uri: string): Promise<Result<string, DomainError>> {
    if (this.failPreview) {
      return err(domainError('invalid-value', '미리보기를 못 만들었다', 'photo'))
    }
    return ok('preview-base64')
  }
}
