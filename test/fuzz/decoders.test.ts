import { Rng } from '@test/support/random'
import { describe, expect, it } from 'vitest'
import { parseArchive } from '@/application/archive/ImportConversation'
import { sha256Hex, utf8Bytes } from '@/infrastructure/archive/Sha256'
import { base64ToBytes, bytesToBase64 } from '@/infrastructure/transport/ble/base64'
import { decodeChunk } from '@/infrastructure/transport/ble/chunk/Chunker'
import { decodeEnvelope } from '@/infrastructure/transport/protocol/EnvelopeSchema'
import { FrameDecoder } from '@/infrastructure/transport/protocol/FrameDecoder'
import {
  parseQuery,
  parseRequest,
  readText,
  utf8Length,
} from '@/infrastructure/transport/web/httpProtocol'

/**
 * 바깥에서 들어오는 것을 마구잡이로 던져본다.
 *
 * ## 왜 이렇게까지 하나
 *
 * **여기서 예외가 하나 새면 비행기에서 앱이 죽는다.** 그리고 고칠
 * 방법이 없다. 앱 스토어 업데이트도, 서버 수정도 없다.
 *
 * 들어오는 것을 우리가 정하지 못한다.
 *
 *   · 같은 Wi-Fi 에 붙은 다른 사람이 아무거나 보낼 수 있다
 *   · 상대가 다른 버전의 앱일 수 있다
 *   · 신호가 약해 반만 오거나 중간이 깨질 수 있다
 *   · 사파리가 우리가 모르는 형태로 물어볼 수 있다
 *
 * 그래서 **무엇이 오든 터지지 않는지**를 본다. 올바르게 처리하는 것은
 * 그다음 문제다.
 *
 * 씨앗을 고정해서 실패하면 그 자리를 다시 볼 수 있다.
 */

/** 일부러 사람을 괴롭히는 값들. 무작위로는 잘 안 나온다 */
const nasty = [
  '',
  ' ',
  '\0',
  '\n',
  '{',
  '}',
  '[]',
  'null',
  'undefined',
  'NaN',
  '-1',
  '1e999',
  '{"__proto__":{"polluted":true}}',
  '{"constructor":{"prototype":{}}}',
  '\\u0000',
  '"'.repeat(1000),
  '{'.repeat(1000),
  'a'.repeat(100_000),
  '🛫'.repeat(1000),
  '가'.repeat(10_000),
]

describe('봉투를 읽을 때', () => {
  it('아무 글이나 던져도 안 터진다', () => {
    const rng = new Rng(1)

    for (let i = 0; i < 3000; i += 1) {
      const raw = rng.text(rng.int(200))

      expect(() => decodeEnvelope(raw)).not.toThrow()
    }
  })

  it.each(nasty)('괴롭히는 값(%#)에도 안 터진다', raw => {
    expect(() => decodeEnvelope(raw)).not.toThrow()
  })

  it('프로토타입을 더럽히지 못한다', () => {
    // **JSON 으로 프로토타입을 건드리는 건 흔한 공격이다.**
    // 여기가 뚫리면 앱 전체가 이상하게 돈다.
    decodeEnvelope('{"t":"message","__proto__":{"polluted":true}}')

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('거의 맞는 봉투에도 안 터진다', () => {
    // 한 글자만 다른 것이 가장 위험하다. 형식 검사를 통과할 뻔한다.
    const rng = new Rng(2)
    const base =
      '{"v":1,"id":"01JABCDEFGHJKMNPQRSTVWXYZ0","seq":1,"ts":1,"t":"message","p":{"messageId":"01JABCDEFGHJKMNPQRSTVWXYZ0","author":"peer-me00000","content":{"kind":"text","text":"안녕"},"sentAt":1,"messageSeq":1}}'

    for (let i = 0; i < 1000; i += 1) {
      const at = rng.int(base.length)
      const broken = base.slice(0, at) + rng.text(1) + base.slice(at + 1)

      expect(() => decodeEnvelope(broken)).not.toThrow()
    }
  })

  it('잘린 봉투에도 안 터진다', () => {
    const base =
      '{"v":1,"id":"01JABCDEFGHJKMNPQRSTVWXYZ0","seq":1,"ts":1,"t":"hello","p":{}}'

    for (let at = 0; at <= base.length; at += 1) {
      expect(() => decodeEnvelope(base.slice(0, at))).not.toThrow()
    }
  })
})

describe('바이트를 봉투로 자를 때', () => {
  it('아무 바이트나 던져도 안 터진다', () => {
    const rng = new Rng(3)

    for (let i = 0; i < 1000; i += 1) {
      const decoder = new FrameDecoder()

      expect(() => decoder.push(rng.bytes(rng.int(500)))).not.toThrow()
    }
  })

  it('한 바이트씩 흘려 넣어도 안 터진다', () => {
    // 실제 소켓이 이렇게 준다. 한 번에 다 오지 않는다.
    const rng = new Rng(4)
    const decoder = new FrameDecoder()
    const stream = rng.bytes(2000)

    for (const byte of stream) {
      expect(() => decoder.push(Uint8Array.from([byte]))).not.toThrow()
    }
  })

  it('말도 안 되는 길이를 말해도 메모리를 안 먹는다', () => {
    // **네 바이트로 앱을 죽일 수 있으면 안 된다.**
    const decoder = new FrameDecoder()
    const huge = new Uint8Array([0xff, 0xff, 0xff, 0xff, 1, 2, 3])

    const result = decoder.push(huge)

    expect(result.ok).toBe(false)
  })

  it('길이가 음수로 읽히지 않는다', () => {
    // 최상위 비트가 1 이면 부호 있는 정수로 읽을 때 음수가 된다.
    // 그러면 크기 검사를 그냥 지나친다.
    const decoder = new FrameDecoder()

    const result = decoder.push(new Uint8Array([0x80, 0, 0, 0]))

    expect(result.ok).toBe(false)
  })

  it('끝없이 쌓이지 않는다', () => {
    // 머리말만 계속 오면 버퍼가 무한히 는다
    const decoder = new FrameDecoder()

    for (let i = 0; i < 100; i += 1) {
      const result = decoder.push(new Uint8Array([0, 0, 0, 200]))
      expect(result.ok).toBe(true)
    }
  })
})

describe('꺼내둔 파일을 읽을 때', () => {
  it('아무 글이나 던져도 안 터진다', () => {
    const rng = new Rng(5)

    for (let i = 0; i < 2000; i += 1) {
      expect(() => parseArchive(rng.text(rng.int(300)))).not.toThrow()
    }
  })

  it.each(nasty)('괴롭히는 값(%#)에도 안 터진다', raw => {
    expect(() => parseArchive(raw)).not.toThrow()
  })

  it('알맹이가 이상해도 안 터진다', () => {
    const shapes = [
      '{"format":"skytalk-archive","version":1,"messages":null}',
      '{"format":"skytalk-archive","version":1,"messages":[],"integrity":null}',
      '{"format":"skytalk-archive","version":1,"messages":[1,2,3],"integrity":{}}',
      '{"format":"skytalk-archive","version":-1,"messages":[],"integrity":{}}',
      '{"format":"skytalk-archive","version":1e999,"messages":[],"integrity":{}}',
      '[]',
      '"글"',
      '123',
      'true',
    ]

    for (const raw of shapes) {
      expect(() => parseArchive(raw)).not.toThrow()
    }
  })
})

describe('사파리가 물어볼 때', () => {
  it('아무 글이나 던져도 안 터진다', () => {
    const rng = new Rng(6)

    for (let i = 0; i < 2000; i += 1) {
      expect(() => parseRequest(rng.text(rng.int(300)))).not.toThrow()
    }
  })

  it('머리말이 이상해도 안 터진다', () => {
    const heads = [
      'GET',
      'GET ',
      ' / HTTP/1.1',
      'GET / HTTP/1.1\r\nContent-Length: abc\r\n\r\n',
      'GET / HTTP/1.1\r\nContent-Length: -5\r\n\r\n',
      'GET / HTTP/1.1\r\nContent-Length: 1e999\r\n\r\n',
      'GET /?a=%\r\n\r\n',
      '\r\n\r\n\r\n\r\n',
    ]

    for (const raw of heads) {
      expect(() => parseRequest(raw)).not.toThrow()
    }
  })

  it('물음표 뒤가 이상해도 안 터진다', () => {
    const rng = new Rng(7)

    for (let i = 0; i < 1000; i += 1) {
      expect(() => parseQuery(rng.text(rng.int(100)))).not.toThrow()
    }
  })

  it('보낸 글이 이상해도 안 터진다', () => {
    const rng = new Rng(8)

    for (let i = 0; i < 1000; i += 1) {
      expect(() => readText(rng.text(rng.int(200)))).not.toThrow()
    }
  })

  it('아무리 긴 글도 잘라낸다', () => {
    // 막지 않으면 사설망이 통째로 막힌다
    const long = JSON.stringify({ text: '가'.repeat(100_000) })

    expect(readText(long)?.length).toBeLessThanOrEqual(4000)
  })
})

describe('블루투스 조각을 읽을 때', () => {
  it('아무 바이트나 던져도 안 터진다', () => {
    const rng = new Rng(9)

    for (let i = 0; i < 3000; i += 1) {
      expect(() => decodeChunk(rng.bytes(rng.int(200)))).not.toThrow()
    }
  })

  it('머리말만 있는 것도 안 터진다', () => {
    for (let length = 0; length <= 4; length += 1) {
      expect(() => decodeChunk(new Uint8Array(length))).not.toThrow()
    }
  })
})

describe('base64 를 읽을 때', () => {
  it('아무 글이나 던져도 안 터진다', () => {
    const rng = new Rng(10)

    for (let i = 0; i < 2000; i += 1) {
      expect(() => base64ToBytes(rng.text(rng.int(200)))).not.toThrow()
    }
  })

  it('무엇을 넣어도 Node 와 같게 나온다', () => {
    const rng = new Rng(11)

    for (let i = 0; i < 500; i += 1) {
      const original = rng.bytes(rng.int(300))

      expect(bytesToBase64(original)).toBe(Buffer.from(original).toString('base64'))
    }
  })
})

describe('글자를 바이트로 셀 때', () => {
  it('무엇을 넣어도 Node 와 같다', () => {
    // **여기가 어긋나면 사파리가 답을 끝까지 못 읽고 멈춘다**
    const rng = new Rng(12)

    for (let i = 0; i < 2000; i += 1) {
      const text = rng.text(rng.int(100))

      expect(utf8Length(text)).toBe(Buffer.byteLength(text, 'utf8'))
    }
  })

  it('UTF-8 바이트도 Node 와 같다', () => {
    const rng = new Rng(13)

    for (let i = 0; i < 1000; i += 1) {
      const text = rng.text(rng.int(80))

      expect(Array.from(utf8Bytes(text))).toEqual(Array.from(Buffer.from(text, 'utf8')))
    }
  })
})

describe('요약값을 만들 때', () => {
  it('무엇을 넣어도 Node 와 같다', () => {
    // 꺼내둔 파일이 온전한지 이걸로 판단한다. 어긋나면 멀쩡한 파일을
    // 거절하거나, 망가진 파일을 받아들인다.
    const rng = new Rng(14)

    for (let i = 0; i < 300; i += 1) {
      const text = rng.text(rng.int(500))
      const { createHash } = require('node:crypto')

      expect(sha256Hex(text)).toBe(
        createHash('sha256').update(text, 'utf8').digest('hex'),
      )
    }
  })

  it('아무 길이나 넣어도 안 터진다', () => {
    const rng = new Rng(15)

    for (let length = 0; length < 200; length += 1) {
      expect(() => sha256Hex(rng.text(length))).not.toThrow()
    }
  })
})
