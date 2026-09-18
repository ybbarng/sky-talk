import { describe, expect, it } from 'vitest'
import {
  CONSERVATIVE_MTU,
  chunk,
  decodeChunk,
  encodeChunk,
  HEADER_BYTES,
  MAX_PARTS,
} from './Chunker'
import { GIVE_UP_AFTER_MS, Reassembler } from './Reassembler'

/**
 * 블루투스 조각내기.
 *
 * **핫스팟을 못 쓸 때 남는 마지막 길이다.** 항공사가 개인 핫스팟을
 * 금지하면 이것만 남는다.
 *
 * 한 번에 보낼 수 있는 크기가 아주 작아서, 자르고 붙이는 데서
 * 한 바이트라도 어긋나면 말이 깨진다.
 */

function bytes(length: number, fill = 65): Uint8Array {
  return new Uint8Array(length).fill(fill)
}

describe('자르기', () => {
  it('작은 것은 한 조각이다', () => {
    const result = chunk(bytes(10), 0)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(1)
    expect(result.value[0]?.total).toBe(1)
  })

  it('머리말 몫을 빼고 담는다', () => {
    // 이걸 안 빼면 보낼 때마다 한계를 넘어 잘린다
    const result = chunk(bytes(1000), 0, CONSERVATIVE_MTU)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const part of result.value) {
      expect(part.data.byteLength).toBeLessThanOrEqual(CONSERVATIVE_MTU - HEADER_BYTES)
    }
  })

  it('조각을 이으면 원래 것이 된다', () => {
    // **한 바이트라도 겹치거나 비면 말이 깨진다**
    const payload = new Uint8Array(500).map((_, i) => i % 256)
    const result = chunk(payload, 0, 64)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const joined = new Uint8Array(payload.byteLength)
    let at = 0
    for (const part of result.value) {
      joined.set(part.data, at)
      at += part.data.byteLength
    }

    expect(at).toBe(payload.byteLength)
    expect(Array.from(joined)).toEqual(Array.from(payload))
  })

  it('빈 것은 안 보낸다', () => {
    expect(chunk(new Uint8Array(0), 0).ok).toBe(false)
  })

  it('너무 크면 거절한다', () => {
    // 조각 번호가 두 바이트라 그 이상은 셀 수 없다.
    // 여기서 막지 않으면 조용히 잘린 말이 간다.
    const tooBig = bytes(MAX_PARTS + 1)

    expect(chunk(tooBig, 0, HEADER_BYTES + 1).ok).toBe(false)
    expect(chunk(bytes(MAX_PARTS), 0, HEADER_BYTES + 1).ok).toBe(true)
  })

  it('자리가 없으면 거절한다', () => {
    expect(chunk(bytes(10), 0, HEADER_BYTES).ok).toBe(false)
  })

  it('묶음 번호가 한 바이트를 안 넘는다', () => {
    const result = chunk(bytes(10), 300)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0]?.bundle).toBe(300 % 256)
  })
})

describe('바이트로 바꾸고 되돌리기', () => {
  it('넣은 것이 그대로 나온다', () => {
    // 조각 번호가 한 바이트를 넘어도 그대로 나와야 한다
    const original = { bundle: 7, index: 300, total: 400, data: bytes(20, 66) }

    const decoded = decodeChunk(encodeChunk(original))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.bundle).toBe(7)
    expect(decoded.value.index).toBe(300)
    expect(decoded.value.total).toBe(400)
    expect(Array.from(decoded.value.data)).toEqual(Array.from(original.data))
  })

  describe('이상한 것이 오면', () => {
    it('너무 짧으면 거절한다', () => {
      expect(decodeChunk(new Uint8Array([1, 2])).ok).toBe(false)
    })

    it('조각 수가 0이면 거절한다', () => {
      expect(decodeChunk(new Uint8Array([0, 0, 0, 0, 0, 65])).ok).toBe(false)
    })

    it('자리가 전체보다 크면 거절한다', () => {
      // 3번째인데 전부 2개라고 한다. 믿고 넣으면 엉뚱한 자리에 들어간다.
      expect(decodeChunk(new Uint8Array([0, 0, 3, 0, 2, 65])).ok).toBe(false)
    })
  })
})

describe('다시 붙이기', () => {
  const T0 = 1_758_000_000_000

  function parts(payload: Uint8Array, bundle = 1, mtu = 64) {
    const result = chunk(payload, bundle, mtu)
    if (!result.ok) throw new Error('자르지 못했다')
    return result.value
  }

  it('다 모이면 원래 것이 나온다', () => {
    const payload = new Uint8Array(300).map((_, i) => i % 256)
    const reassembler = new Reassembler()

    let joined: Uint8Array | null = null
    for (const part of parts(payload)) {
      joined = reassembler.accept(part, T0)
    }

    expect(joined).not.toBeNull()
    expect(Array.from(joined ?? [])).toEqual(Array.from(payload))
  })

  it('덜 모이면 기다린다', () => {
    const reassembler = new Reassembler()
    const all = parts(bytes(300))

    const early = reassembler.accept(all[0] as never, T0)

    expect(early).toBeNull()
    expect(reassembler.pendingCount()).toBe(1)
  })

  it('중간이 비면 안 채워진다', () => {
    // 신호가 약하면 실제로 생긴다
    const reassembler = new Reassembler()
    const all = parts(bytes(300))

    for (const [index, part] of all.entries()) {
      if (index === 1) continue
      reassembler.accept(part, T0)
    }

    expect(reassembler.pendingCount()).toBe(1)
  })

  it('기다리다 만 묶음을 버린다', () => {
    // **안 버리면** 묶음 번호가 256번마다 돌아올 때 예전 조각과
    // 새 조각이 섞여 말이 뒤엉킨다.
    const reassembler = new Reassembler()
    const all = parts(bytes(300))
    reassembler.accept(all[0] as never, T0)

    // 다른 묶음의 조각을 나중에 넣으면서 청소가 돈다
    const other = parts(bytes(10), 99)
    reassembler.accept(other[0] as never, T0 + GIVE_UP_AFTER_MS)

    expect(reassembler.pendingCount()).toBe(0)
  })

  it('같은 번호를 다른 묶음이 쓰면 예전 것을 버린다', () => {
    // 256번마다 번호가 돌아온다
    const reassembler = new Reassembler()
    const old = parts(bytes(300), 5)
    reassembler.accept(old[0] as never, T0)

    // 같은 번호인데 조각 수가 다르다 = 다른 묶음이다
    const fresh = parts(bytes(20), 5)
    const joined = reassembler.accept(fresh[0] as never, T0)

    expect(joined).not.toBeNull()
    expect(joined?.byteLength).toBe(20)
  })

  it('여러 묶음을 동시에 모은다', () => {
    const reassembler = new Reassembler()
    const a = parts(bytes(300, 65), 1)
    const b = parts(bytes(300, 66), 2)

    reassembler.accept(a[0] as never, T0)
    reassembler.accept(b[0] as never, T0)

    expect(reassembler.pendingCount()).toBe(2)
  })

  it('끊기면 전부 버린다', () => {
    const reassembler = new Reassembler()
    reassembler.accept(parts(bytes(300))[0] as never, T0)

    reassembler.clear()

    expect(reassembler.pendingCount()).toBe(0)
  })

  it('한 조각짜리도 바로 나온다', () => {
    const reassembler = new Reassembler()
    const one = parts(bytes(10))

    expect(reassembler.accept(one[0] as never, T0)).not.toBeNull()
  })
})

describe('자르고 보내고 다시 붙이기', () => {
  it('실제 메시지 하나가 그대로 건너간다', () => {
    // 바이트로 바꾸는 것까지 다 거쳐본다. 어느 한 단계만 맞아도
    // 소용없다.
    const text = JSON.stringify({
      t: 'message',
      p: { text: '34열 창가야. 기내식 나오면 알려줘 🛫' },
    })
    const payload = new TextEncoder().encode(text)

    const cut = chunk(payload, 3, CONSERVATIVE_MTU)
    if (!cut.ok) throw new Error('자르지 못했다')

    const reassembler = new Reassembler()
    let joined: Uint8Array | null = null

    for (const part of cut.value) {
      const wire = encodeChunk(part)
      const decoded = decodeChunk(wire)
      if (!decoded.ok) throw new Error('되돌리지 못했다')
      joined = reassembler.accept(decoded.value, 0)
    }

    expect(joined).not.toBeNull()
    expect(new TextDecoder().decode(joined ?? new Uint8Array())).toBe(text)
  })
})
