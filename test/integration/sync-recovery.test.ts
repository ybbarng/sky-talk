import { FakeClock } from '@test/fakes/FakeClock'
import { FakeConversationRepository } from '@test/fakes/FakeConversationRepository'
import { FakeIdGenerator } from '@test/fakes/FakeIdGenerator'
import {
  type LinkedTransport,
  linkedTransportPair,
} from '@test/fakes/LinkedTransportPair'
import { HER, ME, makeText } from '@test/support/factories'
import { beforeEach, describe, expect, it } from 'vitest'
import { ConversationSync } from '@/application/messaging/ConversationSync'
import { ReceiveMessage } from '@/application/messaging/ReceiveMessage'
import { SendMessage } from '@/application/messaging/SendMessage'
import type { Envelope } from '@/application/ports/Envelope'
import { SerialQueue } from '@/application/shared/SerialQueue'
import { Conversation } from '@/domain/message/Conversation'
import type { PeerId } from '@/domain/peer/PeerId'

/**
 * 끊긴 동안 상대가 보낸 것을 되찾는다.
 *
 * **이게 이 앱에서 메시지가 사라지는 유일한 경로였다.**
 *
 *   1. 안드로이드가 메시지를 보낸다 → 보낸 쪽은 "보냄"으로 표시
 *   2. 아이폰이 그 사이 끊겨 있어 못 받는다
 *   3. 안드로이드는 이미 보냈다고 여겨 다시 보내지 않는다
 *   4. 다시 붙어도 아이폰은 그것을 영영 모른다
 *
 * 쌓였다 보내기(`FlushPendingMessages`)는 **내가 못 보낸 것**만 다룬다.
 * 상대가 보냈는데 내가 못 받은 것은 이것으로 해결되지 않는다.
 */

class Device {
  conversation: Conversation
  readonly repository = new FakeConversationRepository()
  readonly clock = new FakeClock()
  readonly ids: FakeIdGenerator
  peerId: string | null = null

  private readonly queue = new SerialQueue()

  constructor(
    readonly me: PeerId,
    readonly transport: LinkedTransport,
    idSeed: number,
    private readonly name: string,
  ) {
    this.ids = new FakeIdGenerator(idSeed)
    this.conversation = Conversation.start(me)

    transport.onReceive(envelope => {
      void this.queue.run(() => this.handle(envelope))
    })
  }

  private get sync(): ConversationSync {
    return new ConversationSync(this.repository, this.transport, this.clock, this.ids)
  }

  async say(text: string): Promise<void> {
    await this.queue.run(async () => {
      const sender = new SendMessage(
        this.transport,
        this.repository,
        this.clock,
        this.ids,
      )
      const result = await sender.execute({
        author: this.me,
        content: makeText(text),
        conversation: this.conversation,
      })
      if (result.ok) this.conversation = result.value.conversation
    })
  }

  /** 연결되면 인사한다 */
  async greet(): Promise<void> {
    await this.queue.run(async () => {
      await this.sync.greet({
        me: this.me,
        displayName: this.name,
        character: 'aria',
        appVersion: '0.1.0',
        conversation: this.conversation,
        peerId: this.peerId ?? undefined,
      })
    })
  }

  async settle(): Promise<void> {
    await this.queue.drain()
  }

  async received(): Promise<string[]> {
    await this.settle()
    const page = await this.repository.loadPage({ limit: 200 })
    if (!page.ok) return []
    return page.value
      .filter(m => !m.isMine(this.me))
      .map(m => (m.content.kind === 'text' ? m.content.text : `[${m.content.kind}]`))
  }

  private async handle(envelope: Envelope): Promise<void> {
    switch (envelope.t) {
      case 'hello': {
        const outcome = await this.sync.onHello({
          me: this.me,
          displayName: this.name,
          character: 'aria',
          appVersion: '0.1.0',
          conversation: this.conversation,
          hello: envelope.p,
        })
        if (outcome.ok && outcome.value.peer !== null) {
          this.peerId = outcome.value.peer.peerId
        }
        return
      }

      case 'hello_ack': {
        this.peerId = envelope.p.peerId
        return
      }

      case 'sync_request': {
        await this.sync.onSyncRequest({ me: this.me, payload: envelope.p })
        return
      }

      case 'sync_response': {
        const outcome = await this.sync.onSyncResponse({
          payload: envelope.p,
          conversation: this.conversation,
        })
        if (outcome.ok) this.conversation = outcome.value.conversation
        return
      }

      case 'message': {
        // 메시지를 받았다는 건 상대를 안다는 뜻이다.
        // 기억해 두어야 다음 인사에서 "몇 번까지 받았다"를 제대로 알려준다.
        this.peerId = envelope.p.author

        const receiver = new ReceiveMessage(
          this.repository,
          this.transport,
          this.clock,
          this.ids,
        )
        const result = await receiver.execute({
          payload: envelope.p,
          conversation: this.conversation,
        })
        if (result.ok) this.conversation = result.value.conversation
        return
      }

      default:
        return
    }
  }
}

describe('끊긴 동안 상대가 보낸 것 되찾기', () => {
  let android: Device
  let iphone: Device
  let link: [LinkedTransport, LinkedTransport]

  beforeEach(() => {
    link = linkedTransportPair()
    android = new Device(ME, link[0], 1758000000000, '나')
    iphone = new Device(HER, link[1], 1758000900000, '여자친구')
  })

  it('한쪽만 끊겨 못 받은 메시지를 다시 붙을 때 되찾는다', async () => {
    // 아이폰만 귀를 막는다. 안드로이드는 잘 보냈다고 여긴다.
    link[1].deafen()

    await android.say('하나')
    await android.say('둘')
    await android.say('셋')

    expect(await iphone.received()).toEqual([])

    // 다시 붙었다. 인사하면서 놓친 것을 알아챈다.
    link[1].listen()
    await android.greet()
    await iphone.greet()
    await android.settle()
    await iphone.settle()

    expect(await iphone.received()).toEqual(['하나', '둘', '셋'])
  })

  it('가운데만 놓쳐도 그것만 되찾는다', async () => {
    await android.say('앞')

    link[1].deafen()
    await android.say('가운데')
    link[1].listen()

    await android.say('뒤')

    // 가운데가 빈 것을 알아챈다
    await iphone.settle()
    expect(await iphone.received()).toEqual(['앞', '뒤'])

    await android.greet()
    await iphone.greet()
    await android.settle()
    await iphone.settle()

    expect(await iphone.received()).toEqual(['앞', '가운데', '뒤'])
  })

  it('되찾은 메시지가 두 번 쌓이지 않는다', async () => {
    link[1].deafen()
    await android.say('하나')
    link[1].listen()

    // 인사를 두 번 해도 한 번만 들어온다
    await android.greet()
    await iphone.greet()
    await android.settle()
    await iphone.settle()

    await android.greet()
    await iphone.greet()
    await android.settle()
    await iphone.settle()

    expect(await iphone.received()).toEqual(['하나'])
  })

  it('놓친 게 없으면 아무것도 요청하지 않는다', async () => {
    await android.say('잘 받았다')
    await iphone.settle()

    link[0].sent.length = 0
    await iphone.greet()
    await android.settle()

    expect(link[0].sentOfType('sync_response')).toHaveLength(0)
  })

  it('양쪽이 서로 놓쳤어도 둘 다 되찾는다', async () => {
    link[0].deafen()
    link[1].deafen()

    await android.say('내가 보낸 것')
    await iphone.say('네가 보낸 것')

    link[0].listen()
    link[1].listen()

    await android.greet()
    await iphone.greet()
    await android.settle()
    await iphone.settle()

    expect(await iphone.received()).toEqual(['내가 보낸 것'])
    expect(await android.received()).toEqual(['네가 보낸 것'])
  })

  it('상대에게 없는 메시지를 요청하면 없다고 답한다', async () => {
    // 아이폰이 5번까지 받았다고 치는데 안드로이드는 그런 걸 보낸 적이 없다
    link[1].deafen()
    await android.say('하나')
    link[1].listen()

    await android.greet()
    await iphone.greet()
    await android.settle()
    await iphone.settle()

    const responses = link[0].sentOfType('sync_response')

    expect(responses.length).toBeGreaterThan(0)
  })

  it('인사하면 서로의 이름과 캐릭터를 알게 된다', async () => {
    await android.greet()
    await iphone.settle()
    await android.settle()

    expect(iphone.peerId).toBe(ME)
    expect(android.peerId).toBe(HER)
  })
})
