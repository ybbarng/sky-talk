import { FakeMessageTransport } from '@test/fakes/FakeMessageTransport'
import { HER, makeUlid } from '@test/support/factories'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Envelope } from '@/application/ports/Envelope'
import { PROTOCOL_VERSION } from '@/application/ports/Envelope'
import { LinkQuality } from '@/domain/connection/LinkQuality'
import { CompositeTransport } from './CompositeTransport'

function envelope(text: string): Envelope {
  return {
    v: PROTOCOL_VERSION,
    t: 'message',
    id: makeUlid(1758000000000),
    seq: 1,
    ts: 1758000000000,
    p: {
      messageId: makeUlid(1758000000001),
      author: HER,
      content: { kind: 'text', text },
      sentAt: 1758000000000,
      messageSeq: 1,
    },
  }
}

function quality(kind: 'wifi' | 'ble', signal: number, latencyMs: number): LinkQuality {
  const result = LinkQuality.of({ kind, signal, latencyMs, lossRate: 0 })
  if (!result.ok) throw new Error('테스트용 품질을 만들지 못했다')
  return result.value
}

describe('여러 길을 하나처럼', () => {
  let wifi: FakeMessageTransport
  let ble: FakeMessageTransport
  let composite: CompositeTransport

  beforeEach(() => {
    wifi = new FakeMessageTransport('wifi')
    ble = new FakeMessageTransport('ble')
    composite = new CompositeTransport([wifi, ble])
  })

  it('첫 후보부터 시도한다', async () => {
    await composite.connect()

    expect(composite.kind).toBe('wifi')
  })

  it('첫 후보가 안 되면 다음으로 넘어간다', async () => {
    wifi.failConnect = true

    await composite.connect()

    expect(composite.kind).toBe('ble')
  })

  it('이미 이어져 있으면 다시 열어도 그대로 이어져 있다', async () => {
    // 이름을 바꾸면 화면이 다시 연다. 그때 찾는 중으로 돌아가면 안 된다.
    await composite.connect()
    const states: string[] = []
    composite.onStateChange(state => states.push(state.phase))

    await composite.connect()

    expect(composite.currentState().isUsable()).toBe(true)
    expect(states).toEqual([])
  })

  it('전부 안 되면 실패를 알린다', async () => {
    wifi.failConnect = true
    ble.failConnect = true

    const result = await composite.connect()

    expect(result.ok).toBe(false)
  })

  it('길이 없으면 만들 수 없다', () => {
    expect(() => new CompositeTransport([])).toThrow()
  })

  it('보낸 것이 지금 쓰는 길로 나간다', async () => {
    await composite.connect()

    await composite.send(envelope('안녕'))

    expect(wifi.sent).toHaveLength(1)
    expect(ble.sent).toHaveLength(0)
  })

  it('받은 것을 위로 전한다', async () => {
    await composite.connect()
    const received: Envelope[] = []
    composite.onReceive(e => received.push(e))

    wifi.deliver(envelope('들어왔다'))

    expect(received).toHaveLength(1)
  })
})

describe('길 갈아타기', () => {
  let wifi: FakeMessageTransport
  let ble: FakeMessageTransport
  let composite: CompositeTransport

  beforeEach(async () => {
    wifi = new FakeMessageTransport('wifi')
    ble = new FakeMessageTransport('ble')
    // 블루투스로 먼저 붙은 상황을 만든다
    composite = new CompositeTransport([ble, wifi])
    await composite.connect()
  })

  it('더 좋은 길이 열리면 옮긴다', async () => {
    ble.setQuality(quality('ble', 1, 30))
    wifi.setQuality(quality('wifi', 1, 20))

    const outcome = await composite.considerSwitching()

    expect(outcome.ok && outcome.value.switched).toBe(true)
    expect(composite.kind).toBe('wifi')
  })

  it('점수가 비슷하면 옮기지 않는다', async () => {
    // 안 그러면 두 길 사이를 계속 오간다
    ble.setQuality(quality('ble', 1, 30))
    wifi.setQuality(quality('wifi', 0.05, 1900))

    const outcome = await composite.considerSwitching()

    expect(outcome.ok && outcome.value.switched).toBe(false)
    expect(composite.kind).toBe('ble')
  })

  it('새 길이 안 열리면 옛 길을 그대로 쓴다', async () => {
    ble.setQuality(quality('ble', 1, 30))
    wifi.setQuality(quality('wifi', 1, 20))
    wifi.failConnect = true

    const outcome = await composite.considerSwitching()

    expect(outcome.ok && outcome.value.switched).toBe(false)
    expect(composite.kind).toBe('ble')
    expect(composite.currentState().isUsable()).toBe(true)
  })

  it('옮긴 뒤에는 새 길로 보낸다', async () => {
    ble.setQuality(quality('ble', 1, 30))
    wifi.setQuality(quality('wifi', 1, 20))
    await composite.considerSwitching()

    await composite.send(envelope('새 길로'))

    expect(wifi.sent).toHaveLength(1)
  })

  it('옮긴 뒤 옛 길에서 온 신호에 흔들리지 않는다', async () => {
    ble.setQuality(quality('ble', 1, 30))
    wifi.setQuality(quality('wifi', 1, 20))
    await composite.considerSwitching()

    // 옛 길이 뒤늦게 끊겼다고 알린다. 우리가 일부러 놓은 것이다.
    ble.loseConnection()

    expect(composite.currentState().isUsable()).toBe(true)
  })

  it('옮긴 뒤 옛 길에서 오는 메시지를 더 받지 않는다', async () => {
    ble.setQuality(quality('ble', 1, 30))
    wifi.setQuality(quality('wifi', 1, 20))
    const received: Envelope[] = []
    composite.onReceive(e => received.push(e))

    await composite.considerSwitching()
    ble.deliver(envelope('옛 길에서'))

    expect(received).toHaveLength(0)
  })
})

describe('갈아타는 동안 보낸 것', () => {
  it('연결이 없으면 쌓아둔다', async () => {
    const wifi = new FakeMessageTransport('wifi')
    const composite = new CompositeTransport([wifi])

    // 아직 연결하지 않았다
    await composite.send(envelope('쌓인다'))

    expect(composite.pendingCount()).toBe(1)
    expect(wifi.sent).toHaveLength(0)
  })

  it('연결되면 쌓아둔 것이 나간다', async () => {
    const wifi = new FakeMessageTransport('wifi')
    const composite = new CompositeTransport([wifi])
    await composite.send(envelope('하나'))
    await composite.send(envelope('둘'))

    await composite.connect()

    expect(wifi.sent).toHaveLength(2)
    expect(composite.pendingCount()).toBe(0)
  })

  it('쌓인 순서 그대로 나간다', async () => {
    const wifi = new FakeMessageTransport('wifi')
    const composite = new CompositeTransport([wifi])
    for (const text of ['하나', '둘', '셋']) await composite.send(envelope(text))

    await composite.connect()

    const texts = wifi
      .sentOfType('message')
      .map(e => (e.p.content.kind === 'text' ? e.p.content.text : ''))
    expect(texts).toEqual(['하나', '둘', '셋'])
  })
})

describe('나중에 이어지는 길', () => {
  it('처음에 못 연 길이 스스로 이어지면 그리로 옮긴다', async () => {
    // 붙는 쪽 Wi-Fi 는 상대를 못 찾으면 실패를 돌려주고 뒤에서 다시 찾는다.
    // 그 사이 블루투스만 열려 있다가, 나중에 Wi-Fi 가 붙을 수 있다.
    const wifi = new FakeMessageTransport('wifi')
    const ble = new FakeMessageTransport('ble')
    wifi.failConnect = true
    ble.failConnect = true
    const composite = new CompositeTransport([wifi, ble])
    await composite.connect()
    expect(composite.currentState().isUsable()).toBe(false)

    ble.regainConnection()

    expect(composite.kind).toBe('ble')
    expect(composite.currentState().isUsable()).toBe(true)
  })

  it('블루투스로 이어진 뒤에는 Wi-Fi 가 되뇌는 "찾는 중" 에 흔들리지 않는다', async () => {
    // 비행기에서 실제로 이런다. Wi-Fi 는 영영 못 찾고 몇 초마다 다시 찾는다.
    const wifi = new FakeMessageTransport('wifi')
    const ble = new FakeMessageTransport('ble')
    wifi.openWithoutPeer = true
    ble.openWithoutPeer = true
    const composite = new CompositeTransport([wifi, ble])
    await composite.connect()

    ble.regainConnection()
    expect(composite.kind).toBe('ble')

    wifi.searchAgain()
    wifi.searchAgain()

    expect(composite.currentState().isUsable()).toBe(true)
    await composite.send(envelope('블루투스로'))
    expect(ble.sent).toHaveLength(1)
  })

  it('블루투스가 끊긴 뒤 Wi-Fi 가 이어지면 그리로 옮긴다', async () => {
    const wifi = new FakeMessageTransport('wifi')
    const ble = new FakeMessageTransport('ble')
    wifi.openWithoutPeer = true
    ble.openWithoutPeer = true
    const composite = new CompositeTransport([wifi, ble])
    await composite.connect()
    ble.regainConnection()

    ble.loseConnection()
    expect(composite.currentState().isUsable()).toBe(false)

    wifi.regainConnection()

    expect(composite.kind).toBe('wifi')
    expect(composite.currentState().isUsable()).toBe(true)
  })
})

describe('아래쪽 길이 끊겼을 때', () => {
  it('위로 알린다', async () => {
    const wifi = new FakeMessageTransport('wifi')
    const composite = new CompositeTransport([wifi])
    await composite.connect()

    wifi.loseConnection()

    expect(composite.currentState().isUsable()).toBe(false)
  })

  it('끊긴 뒤에 보낸 것은 쌓인다', async () => {
    const wifi = new FakeMessageTransport('wifi')
    const composite = new CompositeTransport([wifi])
    await composite.connect()
    wifi.loseConnection()

    await composite.send(envelope('끊긴 뒤'))

    expect(composite.pendingCount()).toBe(1)
  })
})
