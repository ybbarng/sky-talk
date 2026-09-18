import { describe, expect, it } from 'vitest'
import type { Envelope } from '@/application/ports/Envelope'
import {
  doodleContent,
  type MessageContent,
  nudgeContent,
  photoContent,
  stickerContent,
  systemContent,
  textContent,
} from '@/domain/message/MessageContent'
import { decodeEnvelope, encodeEnvelope } from './EnvelopeSchema'
import { encodeFrame } from './FrameCodec'
import { FrameDecoder } from './FrameDecoder'

/**
 * 봉투가 진짜 바이트를 거쳐 그대로 건너가나.
 *
 * **여기가 이 앱에서 가장 조용히 무너지는 자리다.** 새 내용 종류를
 * 더할 때 형식 검사에 안 적어두면, 보내는 쪽은 잘 보냈다고 믿고
 * 받는 쪽은 **말없이 버린다.** 규칙상 모르는 봉투는 연결을 끊지 않고
 * 무시하기 때문에, 어디서도 오류가 안 뜬다.
 *
 * `LinkedTransport` 로는 못 잡는다. 그건 봉투를 그대로 넘겨서
 * 형식 검사를 안 거친다. 그래서 여기서 **바이트까지 내려간다.**
 */

function must<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok) throw new Error(`만들지 못했다: ${JSON.stringify(result.error)}`)
  return result.value as T
}

const everyContent: Array<[string, MessageContent]> = [
  ['글', must(textContent('34열 창가야'))],
  ['이모지가 섞인 글', must(textContent('기내식 나왔어 🛫'))],
  [
    '낙서',
    must(
      doodleContent([
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          color: 'me',
          width: 4,
        },
      ]),
    ),
  ],
  ['이모티콘', must(stickerContent('aria', 'heart'))],
  [
    '사진',
    must(
      photoContent({
        assetId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
        width: 1600,
        height: 1200,
        byteLength: 204_800,
        preview: 'bWlsbGlvbg==',
        caption: '창밖 좀 봐',
      }),
    ),
  ],
  ['콕 찌르기', nudgeContent()],
  ['앱이 끼워 넣은 알림', systemContent('link-lost')],
]

function messageEnvelope(content: MessageContent): Envelope {
  return {
    v: 1,
    id: '01JABCDEFGHJKMNPQRSTVWXYZ1',
    seq: 1,
    ts: 1_758_000_000_000,
    t: 'message',
    p: {
      messageId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      author: 'peer-me00000',
      content,
      sentAt: 1_758_000_000_000,
      messageSeq: 1,
    },
  }
}

/** 봉투를 실제 바이트로. 글로 바꾸고 길이를 붙이는 것까지 */
function toWire(envelope: Envelope): Uint8Array {
  const encoded = encodeEnvelope(envelope)
  if (!encoded.ok) throw new Error('글로 못 바꿨다')

  const framed = encodeFrame(encoded.value)
  if (!framed.ok) throw new Error('자르지 못했다')

  return framed.value
}

/** 실제로 선을 타고 건너간다. 자르는 것까지 다 거친다 */
function overTheWire(envelope: Envelope): Envelope | null {
  const decoder = new FrameDecoder()
  const frames = decoder.push(toWire(envelope))
  if (!frames.ok || frames.value.payloads.length !== 1) return null

  const outcome = decodeEnvelope(frames.value.payloads[0] as string)
  return outcome.kind === 'ok' ? outcome.envelope : null
}

describe('모든 내용이 선을 타고 그대로 건너간다', () => {
  it.each(everyContent)('%s 이 그대로 도착한다', (_label, content) => {
    const arrived = overTheWire(messageEnvelope(content))

    // **null 이면 상대가 말없이 버렸다는 뜻이다.** 보내는 쪽은
    // 잘 보냈다고 믿고, 받는 쪽에는 아무것도 안 뜬다.
    expect(arrived).not.toBeNull()
    if (arrived === null || arrived.t !== 'message') return
    expect(arrived.p.content).toEqual(content)
  })
})

describe('모든 봉투 종류가 건너간다', () => {
  const envelopes: Array<[string, Envelope]> = [
    [
      '인사',
      {
        v: 1,
        id: '01JABCDEFGHJKMNPQRSTVWXYZ1',
        seq: 0,
        ts: 1,
        t: 'hello',
        p: {
          peerId: 'peer-me00000',
          displayName: '지민',
          character: 'mira',
          lastSeenSeq: 3,
          appVersion: '0.1.0',
        },
      },
    ],
    [
      '받았다는 답',
      {
        v: 1,
        id: '01JABCDEFGHJKMNPQRSTVWXYZ2',
        seq: 0,
        ts: 1,
        t: 'ack',
        p: { messageId: '01JABCDEFGHJKMNPQRSTVWXYZ0' },
      },
    ],
    [
      '읽음',
      {
        v: 1,
        id: '01JABCDEFGHJKMNPQRSTVWXYZ3',
        seq: 0,
        ts: 1,
        t: 'read',
        p: { messageIds: ['01JABCDEFGHJKMNPQRSTVWXYZ0'] },
      },
    ],
    [
      '통화 신호',
      {
        v: 1,
        id: '01JABCDEFGHJKMNPQRSTVWXYZ4',
        seq: 0,
        ts: 1,
        t: 'call_signal',
        p: { kind: 'offer', sdp: 'v=0\r\n', media: 'video' },
      },
    ],
    [
      '통화 거절',
      {
        v: 1,
        id: '01JABCDEFGHJKMNPQRSTVWXYZ5',
        seq: 0,
        ts: 1,
        t: 'call_signal',
        p: { kind: 'decline' },
      },
    ],
    [
      '사진 조각',
      {
        v: 1,
        id: '01JABCDEFGHJKMNPQRSTVWXYZ6',
        seq: 0,
        ts: 1,
        t: 'asset_chunk',
        p: { assetId: '01JABCDEFGHJKMNPQRSTVWXYZ0', index: 3, data: 'AAAA' },
      },
    ],
    [
      '못 받은 조각 요청',
      {
        v: 1,
        id: '01JABCDEFGHJKMNPQRSTVWXYZ7',
        seq: 0,
        ts: 1,
        t: 'asset_request',
        p: { assetId: '01JABCDEFGHJKMNPQRSTVWXYZ0', missing: [1, 4] },
      },
    ],
  ]

  it.each(envelopes)('%s 이 그대로 도착한다', (_label, envelope) => {
    const arrived = overTheWire(envelope)

    expect(arrived).not.toBeNull()
    expect(arrived).toEqual(envelope)
  })
})

describe('여러 봉투가 한 번에 와도', () => {
  it('차례대로 다 나온다', () => {
    // 사진을 보낼 때 조각이 줄줄이 붙어 온다. 여기서 하나라도
    // 놓치면 사진이 영영 안 채워진다.
    const all = everyContent.map(([, content]) => messageEnvelope(content))

    let stream = new Uint8Array(0)
    for (const envelope of all) {
      const frame = toWire(envelope)
      const merged = new Uint8Array(stream.byteLength + frame.byteLength)
      merged.set(stream)
      merged.set(frame, stream.byteLength)
      stream = merged
    }

    const decoder = new FrameDecoder()
    const frames = decoder.push(stream)

    expect(frames.ok).toBe(true)
    if (!frames.ok) return
    expect(frames.value.payloads).toHaveLength(all.length)

    // 내용까지 다 살아 있어야 한다
    for (const [index, payload] of frames.value.payloads.entries()) {
      const outcome = decodeEnvelope(payload)
      expect(outcome.kind).toBe('ok')
      if (outcome.kind !== 'ok') continue
      expect(outcome.envelope).toEqual(all[index])
    }
  })

  it('반만 와도 기다렸다가 이어 붙인다', () => {
    // 사설망에서 흔하다. 여기서 섣불리 읽으면 잘린 봉투가 된다.
    const frame = toWire(messageEnvelope(everyContent[4]?.[1] as never))
    const half = Math.floor(frame.byteLength / 2)

    const decoder = new FrameDecoder()
    const first = decoder.push(frame.subarray(0, half))
    const second = decoder.push(frame.subarray(half))

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    expect(first.value.payloads).toHaveLength(0)
    expect(second.value.payloads).toHaveLength(1)
  })
})
