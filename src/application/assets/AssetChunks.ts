import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'

/**
 * 사진을 조각내어 나른다.
 *
 * **한 봉투에 다 담을 수 없다.** 봉투 하나는 1MB 까지인데 사진은 그보다
 * 크고, 큰 봉투 하나를 보내는 동안 글이 막힌다. 그래서 잘게 잘라
 * 보내고, 그 사이사이로 글이 지나간다.
 *
 * 여기는 **자르고 맞추는 계산만** 한다. 실제로 읽고 쓰는 일은
 * infrastructure 가 한다. 그래서 전부 시험할 수 있다.
 *
 * (docs/05-messaging-spec.md 사진 항목 · T22)
 */

/**
 * 한 조각의 크기.
 *
 * base64 로 바꾸면 4/3 배가 되므로 48KB 가 64KB 쯤 된다. 봉투 한계인
 * 1MB 에 한참 못 미쳐 여유가 있다.
 *
 * **너무 잘게 자르면** 봉투마다 붙는 머리말이 쌓여 낭비가 크고,
 * **너무 크게 자르면** 그 조각이 나가는 동안 글이 기다린다.
 */
export const CHUNK_BYTES = 48 * 1024

export function chunkCountFor(byteLength: number): number {
  if (byteLength <= 0) return 0
  return Math.ceil(byteLength / CHUNK_BYTES)
}

/** 몇 번째 조각이 어디부터 어디까지인가 */
export function chunkRange(
  index: number,
  byteLength: number,
): Result<{ start: number; end: number }, DomainError> {
  const count = chunkCountFor(byteLength)

  if (!Number.isInteger(index) || index < 0 || index >= count) {
    return err(domainError('invalid-value', `${index} 번째 조각은 없다`, 'asset'))
  }

  const start = index * CHUNK_BYTES
  return ok({ start, end: Math.min(start + CHUNK_BYTES, byteLength) })
}

/**
 * 받는 쪽이 조각을 모으는 판.
 *
 * **순서가 뒤바뀌어 와도 된다.** 어느 조각이 왔는지 표시해 두고 다
 * 모이면 알려준다. 끊겼다 다시 붙으면 못 받은 것만 달라고 한다.
 */
export class AssetAssembly {
  private readonly received = new Set<number>()

  constructor(
    readonly assetId: string,
    readonly byteLength: number,
  ) {}

  get total(): number {
    return chunkCountFor(this.byteLength)
  }

  /**
   * 조각 하나를 받았다고 표시한다.
   *
   * 같은 조각이 두 번 와도 괜찮다. 끊겼다 다시 붙었을 때 상대가
   * 겹쳐 보내는 일이 흔하다.
   */
  accept(index: number): Result<void, DomainError> {
    if (!Number.isInteger(index) || index < 0 || index >= this.total) {
      return err(domainError('invalid-value', `${index} 번째 조각은 없다`, 'asset'))
    }
    this.received.add(index)
    return ok(undefined)
  }

  isComplete(): boolean {
    return this.received.size === this.total
  }

  /** 지금까지 받은 조각 수 */
  receivedCount(): number {
    return this.received.size
  }

  /** 몇 퍼센트쯤 왔나. 화면에 진행률을 보여줄 때 쓴다 */
  progress(): number {
    if (this.total === 0) return 1
    return this.received.size / this.total
  }

  /**
   * 아직 못 받은 조각들.
   *
   * 다시 붙었을 때 이것만 달라고 한다. **처음부터 다시 받으면**
   * 사설망이 느릴 때 영영 못 끝낸다.
   */
  missing(): number[] {
    const gaps: number[] = []
    for (let i = 0; i < this.total; i += 1) {
      if (!this.received.has(i)) gaps.push(i)
    }
    return gaps
  }

  /**
   * 앞에서부터 빠짐없이 받은 데까지.
   *
   * 상대에게 "여기까지 받았다"고 알릴 때 쓴다. 빈틈 목록을 통째로
   * 보내는 것보다 짧다.
   */
  contiguousUpTo(): number {
    let at = 0
    while (this.received.has(at)) at += 1
    return at
  }
}

/**
 * 보내도 될 만한 크기인가.
 *
 * 줄여 보내는데도 이보다 크면 뭔가 잘못된 것이다. 사설망이 통째로
 * 막혀 글까지 못 가게 된다.
 */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024

export function isSendable(byteLength: number): boolean {
  return byteLength > 0 && byteLength <= MAX_ASSET_BYTES
}

/**
 * 줄일 목표 크기.
 *
 * 원본을 그대로 보내면 몇 MB 짜리가 사설망을 막는다. 긴 변을 이만큼
 * 맞추고 품질을 낮추면 대개 몇백 KB 로 준다. 얼굴과 창밖 풍경을
 * 보기에는 넉넉하다.
 */
export const RESIZE_LONG_EDGE = 1600
export const JPEG_QUALITY = 0.8

/**
 * 좁은 길(블루투스)로 보낼 때의 크기.
 *
 * 초당 3KB 남짓이라 1600px 사진(300~500KB)은 몇 분이 걸린다. 800px 에
 * 화질 0.5 면 대개 60~100KB 라 30초 안팎이다. 기내식 사진은 이걸로 된다.
 */
export const NARROW_LONG_EDGE = 800
export const NARROW_JPEG_QUALITY = 0.5

/**
 * 보내는 사람이 고르는 크기.
 *
 *   · small    — 800px · 0.5. 블루투스로 30초 안팎. 기내식 사진은 이걸로 된다
 *   · medium   — 1600px · 0.8. 예전 기본값. 블루투스로 2~3분
 *   · original — 4096px · 0.9. 거의 원본. 블루투스로 10분 넘게 걸릴 수 있다
 */
export type PhotoSize = 'small' | 'medium' | 'original'

export const PHOTO_SIZES: Readonly<
  Record<
    PhotoSize,
    { readonly longEdge: number; readonly quality: number; readonly typicalBytes: number }
  >
> = {
  small: {
    longEdge: NARROW_LONG_EDGE,
    quality: NARROW_JPEG_QUALITY,
    typicalBytes: 80 * 1024,
  },
  medium: { longEdge: RESIZE_LONG_EDGE, quality: JPEG_QUALITY, typicalBytes: 350 * 1024 },
  original: { longEdge: 4096, quality: 0.9, typicalBytes: 3 * 1024 * 1024 },
}

/** 좁은 길의 어림 속도. 얼마나 걸릴지 말해줄 때 쓴다 */
export const NARROW_BYTES_PER_SECOND = 3_000

/** 좁은 길로 이만큼 보내면 몇 초쯤 걸리나. 올림 */
export function narrowSeconds(byteLength: number): number {
  // base64 로 담겨 4/3 배가 된다
  return Math.max(1, Math.ceil((byteLength * 4) / 3 / NARROW_BYTES_PER_SECOND))
}

/** 긴 변을 목표에 맞춘 크기. 원본이 이미 작으면 그대로 둔다 */
export function resizedSize(
  width: number,
  height: number,
  longEdge = RESIZE_LONG_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= longEdge || longest === 0) return { width, height }

  const scale = longEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
