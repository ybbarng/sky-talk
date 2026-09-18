import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'

/**
 * 블루투스로 보낼 만큼 잘게 자른다.
 *
 * **한 번에 보낼 수 있는 크기가 아주 작다.** 아이폰은 185바이트,
 * 안드로이드도 많아야 517바이트다. Wi-Fi 에서 쓰던 1MB 봉투가
 * 여기서는 통째로 안 들어간다.
 *
 * 머리말 다섯 바이트를 붙인다.
 *
 * ```
 * ┌────────┬────────┬────────┬─────────────────┐
 * │ 묶음번호│ 조각   │ 전체   │ 내용            │
 * │ 1바이트 │ 2바이트│ 2바이트│ 나머지          │
 * └────────┴────────┴────────┴─────────────────┘
 * ```
 *
 * 조각 번호가 두 바이트인 까닭: 사진·음성 조각(48KB, base64 로 64KB)을
 * 블루투스로도 나르기로 했다(2026-09-19). 한 바이트면 255조각, 약 46KB
 * 가 한계라 그 조각이 통째로 안 들어갔다. 두 바이트면 넉넉하다.
 *
 * (docs/04-transport-spec.md 4.3 · T20)
 */

/** 머리말 크기 */
export const HEADER_BYTES = 5

/** 한 묶음에 담을 수 있는 조각 수 */
export const MAX_PARTS = 65_535

/** 아이폰이 한 번에 받을 수 있는 크기. 가장 작은 쪽에 맞춘다 */
export const CONSERVATIVE_MTU = 185

export interface Chunk {
  readonly bundle: number
  readonly index: number
  readonly total: number
  readonly data: Uint8Array
}

/**
 * 자른다.
 *
 * `mtu` 는 상대와 협상한 크기다. 여기서 머리말 몫을 뺀 만큼씩 담는다.
 */
export function chunk(
  payload: Uint8Array,
  bundle: number,
  mtu: number = CONSERVATIVE_MTU,
): Result<Chunk[], DomainError> {
  const room = mtu - HEADER_BYTES

  if (room <= 0) {
    return err(domainError('invalid-value', '한 조각에 담을 자리가 없다', 'ble'))
  }

  if (payload.byteLength === 0) {
    return err(domainError('empty', '보낼 것이 없다', 'ble'))
  }

  const total = Math.ceil(payload.byteLength / room)
  if (total > MAX_PARTS) {
    return err(
      domainError('too-long', `블루투스로 보내기에 너무 크다 (${total}조각)`, 'ble'),
    )
  }

  const chunks: Chunk[] = []
  for (let index = 0; index < total; index += 1) {
    const start = index * room
    chunks.push({
      bundle: bundle % 256,
      index,
      total,
      data: payload.subarray(start, Math.min(start + room, payload.byteLength)),
    })
  }

  return ok(chunks)
}

/** 조각 하나를 실제로 보낼 바이트로 */
export function encodeChunk(part: Chunk): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + part.data.byteLength)
  out[0] = part.bundle & 0xff
  out[1] = (part.index >> 8) & 0xff
  out[2] = part.index & 0xff
  out[3] = (part.total >> 8) & 0xff
  out[4] = part.total & 0xff
  out.set(part.data, HEADER_BYTES)
  return out
}

/**
 * 받은 바이트를 조각으로.
 *
 * **믿지 않는다.** 같은 방에 있는 다른 기기가 아무거나 보낼 수 있고,
 * 신호가 약해 반만 올 수도 있다.
 */
export function decodeChunk(raw: Uint8Array): Result<Chunk, DomainError> {
  if (raw.byteLength < HEADER_BYTES) {
    return err(domainError('invalid-value', '조각이 너무 짧다', 'ble'))
  }

  const bundle = raw[0] ?? 0
  const index = ((raw[1] ?? 0) << 8) | (raw[2] ?? 0)
  const total = ((raw[3] ?? 0) << 8) | (raw[4] ?? 0)

  if (total === 0) {
    return err(domainError('invalid-value', '조각 수가 0이다', 'ble'))
  }

  if (index >= total) {
    return err(
      domainError('invalid-value', `${index}번째 조각인데 전부 ${total}개다`, 'ble'),
    )
  }

  return ok({ bundle, index, total, data: raw.subarray(HEADER_BYTES) })
}
