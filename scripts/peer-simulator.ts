/**
 * 맥을 상대 폰처럼 쓰는 도구.
 *
 * **아이폰이 없어도 두 기기 대화를 진짜로 시험하기 위해 만든다.**
 *
 * 이 도구는 앱과 **똑같은 코드**로 말한다. `FrameDecoder` 도 `EnvelopeSchema` 도
 * `src/` 에 있는 것을 그대로 가져다 쓴다. 그래서 여기서 대화가 되면
 * 규약이 맞다는 뜻이고, 안 되면 앱에서도 안 된다.
 *
 *     pnpm peer --guest              맥이 붙는 쪽. 폰이 핫스팟을 켠 경우
 *     pnpm peer --host               맥이 받는 쪽. 폰이 붙어 온다
 *     pnpm peer --guest --to 192.168.43.1
 *
 * 켜두면 터미널에 친 글이 폰으로 가고, 폰에서 온 글이 여기 뜬다.
 */

import { createConnection, createServer, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import type { Envelope } from '../src/application/ports/Envelope'
import { PROTOCOL_VERSION } from '../src/application/ports/Envelope'
import {
  decodeEnvelope,
  encodeEnvelope,
} from '../src/infrastructure/transport/protocol/EnvelopeSchema'
import { encodeFrame } from '../src/infrastructure/transport/protocol/FrameCodec'
import { FrameDecoder } from '../src/infrastructure/transport/protocol/FrameDecoder'
import { ports } from '../src/infrastructure/transport/wifi/DiscoveryPlan'

const MESSAGE_PORT = ports.message

interface Options {
  readonly role: 'host' | 'guest'
  readonly peerAddress: string | undefined
  readonly name: string
}

function parseArgs(): Options {
  const args = process.argv.slice(2)
  const readFlag = (flag: string): string | undefined => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }

  return {
    role: args.includes('--host') ? 'host' : 'guest',
    peerAddress: readFlag('--to'),
    name: readFlag('--name') ?? '맥',
  }
}

// --- 주고받기 ---

let seq = 0
let counter = 0

function nextId(): string {
  // 실제 ULID 와 같은 26자 형식. 앱이 형식을 검사하므로 맞춰야 한다.
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  counter += 1
  let time = ''
  let remaining = Date.now()
  for (let i = 0; i < 10; i += 1) {
    time = alphabet[remaining % 32] + time
    remaining = Math.floor(remaining / 32)
  }
  let tail = ''
  let n = counter
  for (let i = 0; i < 16; i += 1) {
    tail = alphabet[n % 32] + tail
    n = Math.floor(n / 32)
  }
  return time + tail
}

function send(socket: Socket, envelope: Envelope): void {
  const encoded = encodeEnvelope(envelope)
  if (!encoded.ok) {
    console.error('봉투를 글로 바꾸지 못했다')
    return
  }

  const frame = encodeFrame(encoded.value)
  if (!frame.ok) {
    console.error('조각으로 만들지 못했다:', frame.error.detail)
    return
  }

  socket.write(Buffer.from(frame.value))
}

function sendText(socket: Socket, text: string): void {
  seq += 1
  send(socket, {
    v: PROTOCOL_VERSION,
    t: 'message',
    id: nextId(),
    seq,
    ts: Date.now(),
    p: {
      messageId: nextId(),
      author: 'peer-simulator',
      content: { kind: 'text', text },
      sentAt: Date.now(),
      messageSeq: seq,
    },
  })
}

function sendHello(socket: Socket, options: Options): void {
  send(socket, {
    v: PROTOCOL_VERSION,
    t: 'hello',
    id: nextId(),
    seq: 0,
    ts: Date.now(),
    p: {
      peerId: 'peer-simulator',
      displayName: options.name,
      character: 'nova',
      lastSeenSeq: 0,
      appVersion: '0.1.0-sim',
    },
  })
}

function describe(envelope: Envelope): string | null {
  switch (envelope.t) {
    case 'message': {
      const content = envelope.p.content
      if (content.kind === 'text') return `📩  ${content.text}`
      return `📩  [${content.kind}]`
    }
    case 'hello':
      return `👋  ${envelope.p.displayName} 이(가) 인사했다`
    case 'hello_ack':
      return `🤝  ${envelope.p.displayName} 이(가) 인사를 받았다`
    case 'ack':
      return null
    case 'read':
      return `👀  ${envelope.p.messageIds.length}건을 읽었다`
    case 'typing':
      return envelope.p.typing ? '✏️   입력 중...' : null
    case 'nudge':
      return '👉  콕 찔렀다'
    case 'bye':
      return `👋  끊었다 (${envelope.p.reason})`
    default:
      return `📦  ${envelope.t}`
  }
}

function attach(socket: Socket, options: Options): void {
  const decoder = new FrameDecoder()

  console.log('\n✅  연결됐다. 아무거나 치면 폰으로 갑니다. (Ctrl+C 로 끝)\n')

  sendHello(socket, options)

  socket.on('data', chunk => {
    const decoded = decoder.push(new Uint8Array(chunk))
    if (!decoded.ok) {
      console.error('❌  이상한 걸 받았다:', decoded.error.detail)
      socket.destroy()
      return
    }

    for (const payload of decoded.value.payloads) {
      const outcome = decodeEnvelope(payload)

      if (outcome.kind === 'unknown') {
        console.log(`❓  모르는 종류: ${outcome.type} (그냥 넘긴다)`)
        continue
      }
      if (outcome.kind === 'invalid') {
        console.log(`⚠️   형식이 안 맞는다: ${outcome.reason}`)
        continue
      }

      const line = describe(outcome.envelope)
      if (line !== null) console.log(line)

      // 메시지를 받으면 앱처럼 답한다
      if (outcome.envelope.t === 'message') {
        send(socket, {
          v: PROTOCOL_VERSION,
          t: 'ack',
          id: nextId(),
          seq: 0,
          ts: Date.now(),
          p: { messageId: outcome.envelope.p.messageId },
        })
      }

      // 인사를 받으면 답한다
      if (outcome.envelope.t === 'hello') {
        send(socket, {
          v: PROTOCOL_VERSION,
          t: 'hello_ack',
          id: nextId(),
          seq: 0,
          ts: Date.now(),
          p: {
            peerId: 'peer-simulator',
            displayName: options.name,
            character: 'nova',
            lastSeenSeq: 0,
            appVersion: '0.1.0-sim',
          },
        })
      }
    }
  })

  socket.on('close', () => {
    console.log('\n🔌  연결이 끊겼다')
    process.exit(0)
  })

  socket.on('error', cause => {
    console.error('❌  연결 오류:', cause.message)
  })

  // 터미널에 친 글을 폰으로 보낸다
  const reader = createInterface({ input: stdin, output: stdout, prompt: '> ' })
  reader.prompt()

  reader.on('line', line => {
    const text = line.trim()
    if (text.length > 0) {
      sendText(socket, text)
      console.log(`📤  ${text}`)
    }
    reader.prompt()
  })
}

function myAddresses(): string[] {
  const found: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address)
    }
  }
  return found
}

function main(): void {
  const options = parseArgs()

  console.log('─'.repeat(52))
  console.log('  Skywalkie 상대 흉내내기')
  console.log('─'.repeat(52))
  console.log(
    `  역할      ${options.role === 'host' ? '받는 쪽 (핫스팟을 연 쪽)' : '거는 쪽'}`,
  )
  console.log(`  이름      ${options.name}`)
  console.log(`  내 주소   ${myAddresses().join(', ') || '없음'}`)
  console.log('─'.repeat(52))

  if (options.role === 'host') {
    const server = createServer(socket => {
      console.log(`📱  ${socket.remoteAddress} 에서 붙었다`)
      attach(socket, options)
    })

    server.listen(MESSAGE_PORT, '0.0.0.0', () => {
      console.log(`👂  ${MESSAGE_PORT} 번에서 기다리는 중...`)
      console.log('    폰 앱을 "붙는 쪽"으로 두고 이 주소로 연결하세요.')
    })

    server.on('error', cause => {
      console.error('❌  기다리지 못했다:', cause.message)
      process.exit(1)
    })
    return
  }

  const host = options.peerAddress
  if (host === undefined) {
    console.error('❌  걸 주소를 모른다. --to 192.168.43.1 처럼 알려주세요.')
    console.error('    폰 앱의 설정 → 연결 상태에서 주소를 볼 수 있어요.')
    process.exit(1)
  }

  console.log(`📞  ${host}:${MESSAGE_PORT} 로 거는 중...`)

  const socket = createConnection({ host, port: MESSAGE_PORT }, () => {
    attach(socket, options)
  })

  socket.on('error', cause => {
    console.error('❌  연결하지 못했다:', cause.message)
    console.error('\n확인할 것')
    console.error('  · 폰과 맥이 같은 Wi-Fi 에 있나요?')
    console.error('  · 폰 앱이 켜져 있고 "열어주는 쪽"으로 되어 있나요?')
    console.error('  · 주소가 맞나요? (폰 앱 설정 → 연결 상태)')
    process.exit(1)
  })
}

main()
