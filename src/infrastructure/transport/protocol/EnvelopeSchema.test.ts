import { HER, makeUlid } from '@test/support/factories'
import { describe, expect, it } from 'vitest'
import { type Envelope, PROTOCOL_VERSION } from '@/application/ports/Envelope'
import { decodeEnvelope, encodeEnvelope, envelopeSchema } from './EnvelopeSchema'

function messageEnvelope(overrides: Record<string, unknown> = {}): Envelope {
  return {
    v: PROTOCOL_VERSION,
    t: 'message',
    id: makeUlid(1758000000000),
    seq: 1,
    ts: 1758000000000,
    p: {
      messageId: makeUlid(1758000000001),
      author: HER,
      content: { kind: 'text', text: '34열 창가야' },
      sentAt: 1758000000000,
      messageSeq: 1,
    },
    ...overrides,
  } as Envelope
}

function roundTrip(envelope: Envelope) {
  const encoded = encodeEnvelope(envelope)
  if (!encoded.ok) throw new Error('글로 바꾸지 못했다')
  return decodeEnvelope(encoded.value)
}

describe('봉투를 글로 바꾸고 되돌리기', () => {
  it('메시지 봉투가 그대로 돌아온다', () => {
    const original = messageEnvelope()

    const decoded = roundTrip(original)

    expect(decoded.kind).toBe('ok')
    expect(decoded.kind === 'ok' && decoded.envelope).toEqual(original)
  })

  it('낙서가 담긴 봉투도 돌아온다', () => {
    const original = messageEnvelope({
      p: {
        messageId: makeUlid(1758000000001),
        author: HER,
        content: {
          kind: 'doodle',
          strokes: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
              color: 'me',
              width: 3,
            },
          ],
        },
        sentAt: 1758000000000,
        messageSeq: 1,
      },
    })

    const decoded = roundTrip(original)

    expect(decoded.kind).toBe('ok')
  })

  it('인사 봉투가 돌아온다', () => {
    const hello: Envelope = {
      v: PROTOCOL_VERSION,
      t: 'hello',
      id: makeUlid(1758000000000),
      seq: 0,
      ts: 1758000000000,
      p: {
        peerId: HER,
        displayName: '여자친구',
        character: 'aria',
        pairingCode: 'K7M2PX',
        lastSeenSeq: 12,
        appVersion: '0.1.0',
      },
    }

    const decoded = roundTrip(hello)

    expect(decoded.kind).toBe('ok')
  })

  it('통화 협상 봉투가 돌아온다', () => {
    const signal: Envelope = {
      v: PROTOCOL_VERSION,
      t: 'call_signal',
      id: makeUlid(1758000000000),
      seq: 0,
      ts: 1758000000000,
      p: { kind: 'offer', sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n' },
    }

    const decoded = roundTrip(signal)

    expect(decoded.kind).toBe('ok')
  })

  it('비행 봉투는 전체 길이를 실어도 되고 안 실어도 된다', () => {
    // 예전 앱은 남은 시간만 보낸다. 그것도 그대로 읽혀야 한다.
    const older: Envelope = {
      v: PROTOCOL_VERSION,
      t: 'flight',
      id: makeUlid(1758000000000),
      seq: 0,
      ts: 1758000000000,
      p: { remainingMs: 2 * 60 * 60 * 1000 },
    }
    const newer: Envelope = {
      ...older,
      p: { remainingMs: 2 * 60 * 60 * 1000, totalMs: 3 * 60 * 60 * 1000 },
    }

    expect(roundTrip(older)).toEqual({ kind: 'ok', envelope: older })
    expect(roundTrip(newer)).toEqual({ kind: 'ok', envelope: newer })
  })

  it('비행 전체 길이가 하루를 넘거나 0 이면 거절한다', () => {
    const base = {
      v: PROTOCOL_VERSION,
      t: 'flight',
      id: makeUlid(1758000000000),
      seq: 0,
      ts: 1758000000000,
    }

    expect(
      envelopeSchema.safeParse({ ...base, p: { remainingMs: 1000, totalMs: 0 } }).success,
    ).toBe(false)
    expect(
      envelopeSchema.safeParse({
        ...base,
        p: { remainingMs: 1000, totalMs: 25 * 60 * 60 * 1000 },
      }).success,
    ).toBe(false)
  })
})

describe('모르는 종류가 와도 연결을 끊지 않는다', () => {
  it('처음 보는 종류를 조용히 넘긴다', () => {
    // 한쪽만 업데이트했을 때 대화가 통째로 안 되는 걸 막는 규칙이다
    const future = JSON.stringify({
      v: 2,
      t: 'hologram',
      id: makeUlid(1758000000000),
      seq: 1,
      ts: 1758000000000,
      p: { data: 'x' },
    })

    const decoded = decodeEnvelope(future)

    expect(decoded.kind).toBe('unknown')
    expect(decoded.kind === 'unknown' && decoded.type).toBe('hologram')
  })

  it('아는 종류인데 내용이 틀리면 형식 오류로 본다', () => {
    // 이건 상대 앱의 버그다. 모르는 종류와 구분해서 기록해야 고칠 수 있다.
    const broken = JSON.stringify({
      v: 1,
      t: 'message',
      id: makeUlid(1758000000000),
      seq: 1,
      ts: 1758000000000,
      p: { messageId: '짧음' },
    })

    const decoded = decodeEnvelope(broken)

    expect(decoded.kind).toBe('invalid')
  })
})

describe('망가진 것을 받았을 때', () => {
  it.each([
    ['JSON 이 아니면', '{{{ 망가짐'],
    ['빈 글이면', ''],
    ['숫자만 있으면', '42'],
    ['null 이면', 'null'],
    ['배열이면', '[1, 2, 3]'],
    ['종류가 없으면', '{"v":1,"id":"x","seq":1,"ts":1}'],
    ['종류가 숫자면', '{"v":1,"t":7,"id":"x","seq":1,"ts":1}'],
  ])('%s 버리되 앱이 죽지 않는다', (_label, raw) => {
    const decoded = decodeEnvelope(raw)

    expect(decoded.kind).not.toBe('ok')
  })

  it('필수 항목이 빠지면 거절한다', () => {
    const missing = JSON.stringify({ t: 'ack', p: { messageId: makeUlid(1) } })

    expect(decodeEnvelope(missing).kind).not.toBe('ok')
  })

  it('규약 버전이 0이면 거절한다', () => {
    const decoded = decodeEnvelope(JSON.stringify({ ...messageEnvelope(), v: 0 }))

    expect(decoded.kind).toBe('invalid')
  })
})

describe('지나치게 큰 값 막기', () => {
  it('4000자를 넘는 글은 거절한다', () => {
    const tooLong = messageEnvelope({
      p: {
        messageId: makeUlid(1758000000001),
        author: HER,
        content: { kind: 'text', text: '가'.repeat(4001) },
        sentAt: 1758000000000,
        messageSeq: 1,
      },
    })

    expect(roundTrip(tooLong).kind).toBe('invalid')
  })

  it('낙서 선이 너무 많으면 거절한다', () => {
    const strokes = Array.from({ length: 201 }, () => ({
      points: [{ x: 0, y: 0 }],
      color: 'me',
      width: 1,
    }))

    const tooMany = messageEnvelope({
      p: {
        messageId: makeUlid(1758000000001),
        author: HER,
        content: { kind: 'doodle', strokes },
        sentAt: 1758000000000,
        messageSeq: 1,
      },
    })

    expect(roundTrip(tooMany).kind).toBe('invalid')
  })

  it('낙서 좌표가 화면 밖이면 거절한다', () => {
    const outside = messageEnvelope({
      p: {
        messageId: makeUlid(1758000000001),
        author: HER,
        content: {
          kind: 'doodle',
          strokes: [{ points: [{ x: 5, y: 0.5 }], color: 'me', width: 1 }],
        },
        sentAt: 1758000000000,
        messageSeq: 1,
      },
    })

    expect(roundTrip(outside).kind).toBe('invalid')
  })

  it('읽음 신호에 식별자를 너무 많이 담으면 거절한다', () => {
    const flood = JSON.stringify({
      v: 1,
      t: 'read',
      id: makeUlid(1758000000000),
      seq: 0,
      ts: 1,
      p: { messageIds: Array.from({ length: 501 }, () => makeUlid(1)) },
    })

    expect(decodeEnvelope(flood).kind).toBe('invalid')
  })
})

describe('모르는 캐릭터', () => {
  it('나중 버전이 만든 캐릭터가 오면 거절한다', () => {
    // 인사는 못 받아들이지만 연결이 끊기지는 않는다.
    // 화면에서 "상대 앱이 더 새 버전이에요"라고 알린다.
    const future = JSON.stringify({
      v: 1,
      t: 'hello',
      id: makeUlid(1758000000000),
      seq: 0,
      ts: 1,
      p: {
        peerId: HER,
        displayName: '여자친구',
        character: 'dragon',
        pairingCode: 'K7M2PX',
        lastSeenSeq: 0,
        appVersion: '2.0.0',
      },
    })

    expect(decodeEnvelope(future).kind).toBe('invalid')
  })
})

/**
 * 우리가 보내는 종류를 우리가 모르면 안 된다.
 *
 * 봉투를 하나 더할 때 **형식에는 넣고 `knownTypes` 에는 안 넣는**
 * 실수를 하기 쉽다. 그러면 내용이 조금만 틀려도 "모르는 종류" 로
 * 분류되어, 상대 앱이 새 버전인 줄 알고 넘어간다. 진짜 버그를 놓친다.
 */
describe('아는 종류 목록이 형식과 맞는다', () => {
  it('형식에 있는 종류는 전부 아는 것으로 친다', () => {
    const inSchema = envelopeSchema.options.map(
      option => (option.shape.t as { value: string }).value,
    )

    for (const type of inSchema) {
      // 내용을 일부러 비워 보낸다. 아는 종류면 "형식이 틀렸다" 가,
      // 모르는 종류면 "모르겠다" 가 나온다.
      const outcome = decodeEnvelope(
        JSON.stringify({ v: 1, id: 'x', seq: 0, ts: 0, t: type }),
      )

      expect(outcome.kind, `${type} 가 아는 목록에 없다`).toBe('invalid')
    }
  })
})
