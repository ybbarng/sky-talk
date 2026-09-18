import type { Chunk } from './Chunker'

/**
 * 조각을 다시 붙인다.
 *
 * 블루투스는 순서를 지켜주지만 **신호가 약하면 중간이 빈다.** 그러면
 * 그 묶음은 영영 안 채워진다. 기다리다 말고 버려야, 다음 묶음이 같은
 * 번호를 다시 쓸 때 섞이지 않는다.
 *
 * 묶음 번호는 한 바이트라 256번마다 돌아온다. 오래된 것을 안 버리면
 * **예전 묶음의 조각과 새 묶음의 조각이 섞여** 말이 뒤엉킨다.
 *
 * (docs/04-transport-spec.md 4.3 · T20)
 */

/** 마지막 조각 뒤 이만큼 지나도 안 채워지면 버린다 */
export const GIVE_UP_AFTER_MS = 5000

interface Pending {
  readonly total: number
  readonly parts: Map<number, Uint8Array>
  touchedAt: number
}

export class Reassembler {
  private readonly bundles = new Map<number, Pending>()

  /**
   * 조각 하나를 넣는다.
   *
   * 다 모이면 이어 붙인 것을 돌려준다. 아직이면 `null`.
   */
  accept(part: Chunk, now: number): Uint8Array | null {
    this.dropStale(now)

    const existing = this.bundles.get(part.bundle)

    // 전체 개수가 다르면 다른 묶음이 같은 번호를 쓴 것이다.
    // 예전 것을 버리고 새로 시작한다. 섞이면 말이 뒤엉킨다.
    const pending =
      existing !== undefined && existing.total === part.total
        ? existing
        : { total: part.total, parts: new Map<number, Uint8Array>(), touchedAt: now }

    pending.parts.set(part.index, part.data)
    pending.touchedAt = now
    this.bundles.set(part.bundle, pending)

    if (pending.parts.size < pending.total) return null

    this.bundles.delete(part.bundle)
    return join(pending)
  }

  /** 기다리다 만 묶음을 버린다 */
  private dropStale(now: number): void {
    for (const [bundle, pending] of this.bundles) {
      if (now - pending.touchedAt >= GIVE_UP_AFTER_MS) {
        this.bundles.delete(bundle)
      }
    }
  }

  /** 이 묶음이 얼마나 찼나. 0~1. 모르는 묶음이면 null */
  fill(bundle: number): number | null {
    const pending = this.bundles.get(bundle)
    if (pending === undefined || pending.total === 0) return null
    return pending.parts.size / pending.total
  }

  /** 아직 모으는 중인 묶음 수. 시험과 화면에서 본다 */
  pendingCount(): number {
    return this.bundles.size
  }

  /** 전부 버린다. 연결이 끊겼을 때 */
  clear(): void {
    this.bundles.clear()
  }
}

function join(pending: Pending): Uint8Array {
  let size = 0
  for (let i = 0; i < pending.total; i += 1) {
    size += pending.parts.get(i)?.byteLength ?? 0
  }

  const out = new Uint8Array(size)
  let at = 0

  // **자리 순서대로 붙인다.** 온 순서가 아니다.
  for (let i = 0; i < pending.total; i += 1) {
    const data = pending.parts.get(i)
    if (data === undefined) continue
    out.set(data, at)
    at += data.byteLength
  }

  return out
}
