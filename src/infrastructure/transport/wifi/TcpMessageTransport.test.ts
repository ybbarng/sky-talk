import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HEARTBEAT } from '../protocol/FrameCodec'
import { TcpMessageTransport } from './TcpMessageTransport'

/**
 * 받는 쪽(안드로이드)이 누구를 상대로 치는가.
 *
 * 거는 쪽은 상대를 찾을 때 문을 두드리고 바로 끊는다. 받는 쪽이 그걸 상대로
 * 치면 이어졌다 끊겼다를 되풀이하고 진짜 연결을 못 받는다.
 * (docs/04-transport-spec.md 2.3)
 *
 * 진짜 소켓 대신 가짜를 끼워 "누가 언제 붙고 끊는지" 만 흉내 낸다.
 */

class FakeSocket extends EventEmitter {
  destroyed = false
  readonly written: Uint8Array[] = []

  write(data: Uint8Array): void {
    this.written.push(data)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('close')
  }

  /** 상대가 무언가를 보냈다 */
  receive(bytes: Uint8Array): void {
    this.emit('data', Buffer.from(bytes))
  }
}

class FakeServer extends EventEmitter {
  closed = false

  constructor(private readonly onConnection: (socket: FakeSocket) => void) {
    super()
  }

  listen(_options: unknown, ready: () => void): void {
    ready()
  }

  close(): void {
    this.closed = true
  }

  /** 누군가 문을 두드렸다 */
  accept(): FakeSocket {
    const socket = new FakeSocket()
    this.onConnection(socket)
    return socket
  }
}

const servers: FakeServer[] = []

vi.mock('react-native-tcp-socket', () => ({
  default: {
    createServer: (onConnection: (socket: FakeSocket) => void) => {
      const server = new FakeServer(onConnection)
      servers.push(server)
      return server
    },
    createConnection: () => new FakeSocket(),
  },
}))

function lastServer(): FakeServer {
  const server = servers.at(-1)
  if (server === undefined) throw new Error('문이 열리지 않았다')
  return server
}

describe('받는 쪽이 상대를 알아보기', () => {
  let host: TcpMessageTransport

  beforeEach(async () => {
    servers.length = 0
    host = new TcpMessageTransport('host')
    await host.connect()
  })

  afterEach(async () => {
    await host.disconnect()
  })

  it('문을 열기만 해서는 이어진 게 아니다', () => {
    expect(host.currentState().isUsable()).toBe(false)
  })

  it('두드리고 간 연결은 상대로 치지 않는다', () => {
    const phases: string[] = []
    host.onStateChange(state => phases.push(state.phase))

    const knock = lastServer().accept()
    knock.destroy()

    expect(phases).toEqual([])
    expect(host.currentState().isUsable()).toBe(false)
  })

  it('두드린 뒤에 온 진짜 연결을 받는다', () => {
    // 거는 쪽은 찾자마자 같은 주소로 다시 건다
    lastServer().accept().destroy()

    const peer = lastServer().accept()
    peer.receive(HEARTBEAT)

    expect(host.currentState().isUsable()).toBe(true)
    expect(peer.destroyed).toBe(false)
  })

  it('두드린 연결이 아직 안 닫혔어도 새 연결에 자리를 내준다', () => {
    const knock = lastServer().accept()
    const peer = lastServer().accept()

    expect(knock.destroyed).toBe(true)

    peer.receive(HEARTBEAT)
    expect(host.currentState().isUsable()).toBe(true)
  })

  it('자리를 내준 옛 연결이 늦게 보낸 것은 듣지 않는다', () => {
    const knock = lastServer().accept()
    lastServer().accept()

    knock.emit('data', Buffer.from(HEARTBEAT))

    expect(host.currentState().isUsable()).toBe(false)
  })

  it('상대와 이어진 동안 온 다른 연결은 돌려보낸다', () => {
    const peer = lastServer().accept()
    peer.receive(HEARTBEAT)

    const stranger = lastServer().accept()

    expect(stranger.destroyed).toBe(true)
    expect(peer.destroyed).toBe(false)
    expect(host.currentState().isUsable()).toBe(true)
  })

  it('상대가 끊겨도 문은 열어둔 채 다음 연결을 받는다', () => {
    const first = lastServer().accept()
    first.receive(HEARTBEAT)
    first.destroy()

    expect(host.currentState().phase).toBe('searching')
    expect(lastServer().closed).toBe(false)

    const again = lastServer().accept()
    again.receive(HEARTBEAT)

    expect(host.currentState().isUsable()).toBe(true)
  })
})
