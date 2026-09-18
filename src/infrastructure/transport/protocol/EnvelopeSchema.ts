import { z } from 'zod'
import type { Envelope } from '@/application/ports/Envelope'
import { stickerPoses } from '@/domain/message/MessageContent'
import { characterIds } from '@/domain/peer/Character'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'

/**
 * 받은 봉투를 검사한다.
 *
 * **상대가 보낸 것을 믿지 않는다.** 다른 버전의 앱일 수도 있고,
 * 같은 Wi-Fi 에 붙은 다른 사람이 아무거나 보낼 수도 있다.
 *
 * 가장 중요한 규칙: **모르는 종류가 와도 연결을 끊지 않는다.**
 * 조용히 무시하고 기록만 남긴다. 이 규칙이 없으면 한쪽만 업데이트했을 때
 * 대화가 통째로 안 된다. (docs/04-transport-spec.md 3장)
 */

const header = {
  v: z.number().int().min(1),
  id: z.string().min(1).max(64),
  seq: z.number().int().min(0),
  ts: z.number().int().min(0),
}

const point = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

const stroke = z.object({
  points: z.array(point).min(1).max(1000),
  color: z.string().min(1).max(32),
  width: z.number().positive().max(100),
})

const messageContent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(4000) }),
  z.object({ kind: z.literal('doodle'), strokes: z.array(stroke).min(1).max(200) }),
  z.object({
    kind: z.literal('sticker'),
    // 캐릭터 이름을 목록으로 막지 않는다. 상대가 새 버전이라
    // 우리가 모르는 캐릭터를 쓸 수 있는데, 그때 대화가 끊기면 안 된다.
    character: z.string().min(1).max(32),
    pose: z.enum(stickerPoses),
  }),
  z.object({
    kind: z.literal('photo'),
    assetId: z.string().length(26),
    width: z.number().positive().max(20_000),
    height: z.number().positive().max(20_000),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024),
    preview: z.string().max(4000).optional(),
    caption: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('voice'),
    assetId: z.string().length(26),
    // 한 번에 1분까지. 넉넉히 잡아 2분을 넘으면 버린다
    durationMs: z
      .number()
      .int()
      .positive()
      .max(2 * 60_000),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024),
  }),
  z.object({ kind: z.literal('nudge') }),
  z.object({
    kind: z.literal('system'),
    notice: z.enum([
      'link-lost',
      'link-restored',
      'switched-to-bluetooth',
      'switched-to-wifi',
      'call-ended',
      'conversation-imported',
    ]),
  }),
])

const messagePayload = z.object({
  messageId: z.string().length(26),
  author: z.string().min(8).max(64),
  content: messageContent,
  sentAt: z.number().int().min(0),
  messageSeq: z.number().int().min(1),
})

const helloPayload = z.object({
  peerId: z.string().min(8).max(64),
  displayName: z.string().min(1).max(20),
  character: z.enum(characterIds),
  status: z.string().max(60).optional(),
  lastSeenSeq: z.number().int().min(0),
  appVersion: z.string().min(1).max(32),
})

export const envelopeSchema = z.discriminatedUnion('t', [
  z.object({ ...header, t: z.literal('hello'), p: helloPayload }),
  // 예전 앱은 여기에 코드와 받아들임 여부를 실어 보낸다. 모르는 항목은
  // 버리고 읽으므로 그대로 붙는다.
  z.object({ ...header, t: z.literal('hello_ack'), p: helloPayload }),
  z.object({ ...header, t: z.literal('message'), p: messagePayload }),
  z.object({
    ...header,
    t: z.literal('ack'),
    p: z.object({ messageId: z.string().length(26) }),
  }),
  z.object({
    ...header,
    t: z.literal('read'),
    p: z.object({ messageIds: z.array(z.string().length(26)).max(500) }),
  }),
  z.object({
    ...header,
    t: z.literal('typing'),
    p: z.object({ typing: z.boolean() }),
  }),
  z.object({
    ...header,
    t: z.literal('nudge'),
    p: z.object({ messageId: z.string().length(26) }),
  }),
  z.object({
    ...header,
    t: z.literal('presence'),
    p: z.object({
      foreground: z.boolean(),
      batteryLevel: z.number().min(0).max(1).optional(),
      nowPlaying: z.string().max(100).optional(),
    }),
  }),
  z.object({
    ...header,
    t: z.literal('flight'),
    p: z.object({
      // 하루를 넘기면 잘못 넣은 것이다. 0 이면 끈 것
      remainingMs: z
        .number()
        .int()
        .min(0)
        .max(24 * 60 * 60 * 1000),
      // 비행이 통째로 얼마나 긴가. 예전 앱은 안 보낸다
      totalMs: z
        .number()
        .int()
        .positive()
        .max(24 * 60 * 60 * 1000)
        .optional(),
    }),
  }),
  z.object({
    ...header,
    t: z.literal('sync_request'),
    p: z.object({ missingSeqs: z.array(z.number().int().min(1)).max(500) }),
  }),
  z.object({
    ...header,
    t: z.literal('sync_response'),
    p: z.object({
      messages: z.array(messagePayload).max(200),
      unavailableSeqs: z.array(z.number().int().min(1)).max(500),
    }),
  }),
  z.object({
    ...header,
    t: z.literal('call_signal'),
    p: z.object({
      kind: z.enum(['offer', 'answer', 'candidate', 'hangup', 'decline']),
      sdp: z.string().max(100_000).optional(),
      candidate: z.string().max(2000).optional(),
      sdpMid: z.string().max(100).optional(),
      sdpMLineIndex: z.number().int().min(0).optional(),
      media: z.enum(['voice', 'video']).optional(),
    }),
  }),
  z.object({
    ...header,
    t: z.literal('asset_chunk'),
    p: z.object({
      assetId: z.string().length(26),
      index: z.number().int().min(0).max(1000),
      // base64 라 원래보다 4/3 배가 된다. 48KB 조각이 64KB 쯤 된다.
      data: z.string().max(96 * 1024),
    }),
  }),
  z.object({
    ...header,
    t: z.literal('asset_request'),
    p: z.object({
      assetId: z.string().length(26),
      /** 못 받은 조각들. 비어 있으면 처음부터 달라는 뜻이다 */
      missing: z.array(z.number().int().min(0).max(1000)).max(1000),
    }),
  }),
  z.object({
    ...header,
    t: z.literal('bye'),
    p: z.object({
      reason: z.enum(['user-stopped', 'app-closing', 'switching-link']),
    }),
  }),
])

export type DecodeOutcome =
  | { readonly kind: 'ok'; readonly envelope: Envelope }
  /** 모르는 종류다. 연결은 그대로 두고 넘긴다 */
  | { readonly kind: 'unknown'; readonly type: string }
  /** 형식이 어긋났다. 버리되 연결은 유지한다 */
  | { readonly kind: 'invalid'; readonly reason: string }

/**
 * 받은 글을 봉투로 바꾼다.
 *
 * **어떤 경우에도 예외를 던지지 않는다.** 아무 바이트나 던져도
 * 앱이 죽지 않아야 한다.
 */
export function decodeEnvelope(raw: string): DecodeOutcome {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'invalid', reason: 'JSON 이 아니다' }
  }

  const result = envelopeSchema.safeParse(parsed)
  if (result.success) {
    return { kind: 'ok', envelope: result.data as Envelope }
  }

  // 종류는 알겠는데 내용이 틀린 것과, 종류 자체를 모르는 것을 나눈다.
  // 앞은 상대 앱의 버그이고, 뒤는 우리보다 새 버전이라는 뜻이다.
  const type = readType(parsed)
  if (type !== null && !knownTypes.has(type)) {
    return { kind: 'unknown', type }
  }

  return { kind: 'invalid', reason: summarize(result.error) }
}

export function encodeEnvelope(envelope: Envelope): Result<string, DomainError> {
  try {
    return ok(JSON.stringify(envelope))
  } catch {
    // 순환 참조 같은 것. 우리 코드의 버그다.
    return err(domainError('invalid-value', '봉투를 글로 바꾸지 못했다', 'envelope'))
  }
}

const knownTypes = new Set([
  'hello',
  'hello_ack',
  'message',
  'ack',
  'read',
  'typing',
  'nudge',
  'presence',
  'flight',
  'sync_request',
  'sync_response',
  'call_signal',
  'asset_chunk',
  'asset_request',
  'bye',
])

function readType(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const t = (value as { t?: unknown }).t
  return typeof t === 'string' ? t : null
}

function summarize(error: z.ZodError): string {
  const first = error.issues[0]
  if (first === undefined) return '형식이 맞지 않는다'
  return `${first.path.join('.')}: ${first.message}`
}
