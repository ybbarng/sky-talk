import { FakeAssetStore, FakeImageResizer } from '@test/fakes/FakeAssetStore'
import { FakeClock } from '@test/fakes/FakeClock'
import { FakeConversationRepository } from '@test/fakes/FakeConversationRepository'
import { FakeIdGenerator } from '@test/fakes/FakeIdGenerator'
import { FakeMessageTransport } from '@test/fakes/FakeMessageTransport'
import { ME, startConversation } from '@test/support/factories'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Conversation } from '@/domain/message/Conversation'
import {
  chunkCountFor,
  NARROW_JPEG_QUALITY,
  NARROW_LONG_EDGE,
  RESIZE_LONG_EDGE,
} from './AssetChunks'
import { ReceiveAsset } from './ReceiveAsset'
import { SendPhoto } from './SendPhoto'

/**
 * 사진 주고받기.
 *
 * 여기서 볼 것은 셋이다.
 *
 *   1. **메시지가 조각보다 먼저 간다** — 안 그러면 상대는 아무것도
 *      모른 채 기다린다
 *   2. **끊겨도 메시지는 남는다** — 다시 붙으면 못 받은 것만 받는다
 *   3. **보낸 것과 받은 것이 같다** — 한 바이트라도 어긋나면 사진이 깨진다
 */

describe('사진 보내기', () => {
  let transport: FakeMessageTransport
  let repository: FakeConversationRepository
  let assets: FakeAssetStore
  let resizer: FakeImageResizer
  let sender: SendPhoto
  let conversation: Conversation

  beforeEach(() => {
    transport = new FakeMessageTransport()
    repository = new FakeConversationRepository()
    assets = new FakeAssetStore()
    resizer = new FakeImageResizer()
    conversation = startConversation()

    sender = new SendPhoto({
      transport,
      repository,
      assets,
      resizer,
      clock: new FakeClock(),
      ids: new FakeIdGenerator(),
    })
  })

  function send(caption?: string) {
    return sender.execute({
      author: ME,
      conversation,
      uri: 'file:///photo.jpg',
      ...(caption === undefined ? {} : { caption }),
    })
  }

  it('메시지를 먼저 보내고 조각을 나중에 보낸다', async () => {
    // **순서가 뒤바뀌면** 조각이 다 갈 때까지 상대 화면에 아무것도
    // 안 뜬다. 몇십 초 동안 아무 일도 없는 것처럼 보인다.
    const result = await send()

    expect(result.ok).toBe(true)

    const kinds = transport.sent.map(envelope => envelope.t)
    const messageAt = kinds.indexOf('message')
    const firstChunkAt = kinds.indexOf('asset_chunk')

    expect(messageAt).toBeGreaterThanOrEqual(0)
    expect(firstChunkAt).toBeGreaterThan(messageAt)
  })

  it('원본을 그대로 보내지 않는다', async () => {
    // 몇 MB 짜리가 사설망을 막으면 글까지 못 간다
    await send()

    const [message] = transport.sentOfType('message')
    expect(message?.p.content.kind).toBe('photo')
    if (message?.p.content.kind !== 'photo') return
    expect(message.p.content.width).toBe(1600)
  })

  it('흐릿한 미리보기를 같이 보낸다', async () => {
    // 진짜 사진이 도착할 때까지 빈 네모를 보여주지 않는다
    await send()

    const [message] = transport.sentOfType('message')
    if (message?.p.content.kind !== 'photo') throw new Error('사진이 아니다')
    expect(message.p.content.preview).toBe('preview-base64')
  })

  it('미리보기를 못 만들어도 사진은 간다', async () => {
    // 여기서 멈추면 "흐릿한 그림이 없는 사진"이 아니라 "사진 없음"이 된다
    resizer.failPreview = true

    const result = await send()

    expect(result.ok).toBe(true)
    expect(transport.sentOfType('asset_chunk').length).toBeGreaterThan(0)
  })

  it('붙인 말도 같이 간다', async () => {
    await send('기내식 나왔어')

    const [message] = transport.sentOfType('message')
    if (message?.p.content.kind !== 'photo') throw new Error('사진이 아니다')
    expect(message.p.content.caption).toBe('기내식 나왔어')
  })

  it('조각을 빠짐없이 보낸다', async () => {
    const result = await send()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const expected = chunkCountFor(resizer.byteLength)
    expect(transport.sentOfType('asset_chunk')).toHaveLength(expected)
    expect(result.value.chunksSent).toBe(true)
  })

  it('보내기 전에 기기에 둔다', async () => {
    // 조각을 보내다 앱이 죽어도 사진은 남아 있어야 한다
    const result = await send()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await assets.exists(result.value.assetId)).toBe(true)
  })

  it('너무 큰 사진은 거절한다', async () => {
    resizer.byteLength = 20 * 1024 * 1024

    const result = await send()

    expect(result.ok).toBe(false)
  })

  it('좁은 길이면 훨씬 작게 줄인다', async () => {
    // 블루투스는 초당 3KB 남짓이다. 1600px 짜리는 몇 분이 걸린다.
    await sender.execute({
      author: ME,
      conversation,
      uri: 'file:///photo.jpg',
      narrow: true,
    })

    expect(resizer.lastLongEdge).toBe(NARROW_LONG_EDGE)
    expect(resizer.lastQuality).toBe(NARROW_JPEG_QUALITY)
  })

  it('넓은 길이면 평소 크기로 줄인다', async () => {
    await send()

    expect(resizer.lastLongEdge).toBe(RESIZE_LONG_EDGE)
  })

  it('줄이지 못하면 보내지 않는다', async () => {
    resizer.failResize = true

    const result = await send()

    expect(result.ok).toBe(false)
    expect(transport.sentOfType('message')).toHaveLength(0)
  })

  describe('조각을 보내다 끊기면', () => {
    it('메시지는 그대로 남는다', async () => {
      // 첫 조각부터 실패하게 둔다. 메시지는 그 전에 나갔다.
      transport.failCount = -1

      const result = await send()

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.chunksSent).toBe(false)
      // 저장은 됐다. 다시 붙으면 나간다.
      expect(repository.all()).toHaveLength(1)
    })
  })
})

describe('사진 받기', () => {
  let transport: FakeMessageTransport
  let assets: FakeAssetStore
  let receiver: ReceiveAsset
  let completed: string[]

  beforeEach(() => {
    transport = new FakeMessageTransport()
    assets = new FakeAssetStore()
    completed = []

    receiver = new ReceiveAsset(
      {
        assets,
        transport,
        clock: new FakeClock(),
        ids: new FakeIdGenerator(),
      },
      { onComplete: assetId => completed.push(assetId) },
    )
  })

  const ASSET = '01JABCDEFGHJKMNPQRSTVWXYZ0'

  it('다 모이면 알려준다', async () => {
    receiver.expect(ASSET, 100)

    await receiver.onChunk({ assetId: ASSET, index: 0, data: 'abc' })

    expect(completed).toEqual([ASSET])
  })

  it('순서가 뒤바뀌어 와도 제자리에 담는다', async () => {
    // **여기가 어긋나면 사진이 깨진다.** 그리고 깨진 줄도 모른다.
    const size = 48 * 1024 * 3
    receiver.expect(ASSET, size)

    await receiver.onChunk({ assetId: ASSET, index: 2, data: 'CCC' })
    await receiver.onChunk({ assetId: ASSET, index: 0, data: 'AAA' })
    await receiver.onChunk({ assetId: ASSET, index: 1, data: 'BBB' })

    expect(completed).toEqual([ASSET])
    expect(assets.contentOf(ASSET)).toBe('AAABBBCCC')
  })

  it('같은 조각이 두 번 와도 된다', async () => {
    // 끊겼다 붙으면 상대가 겹쳐 보낸다
    const size = 48 * 1024 * 2
    receiver.expect(ASSET, size)

    await receiver.onChunk({ assetId: ASSET, index: 0, data: 'AAA' })
    await receiver.onChunk({ assetId: ASSET, index: 0, data: 'AAA' })

    expect(completed).toEqual([])
    expect(receiver.inFlight()[0]?.ratio).toBeCloseTo(0.5)
  })

  it('모르는 사진의 조각은 버리되 멈추지 않는다', async () => {
    // 이미 끝난 사진의 늦은 조각이 올 수 있다
    const result = await receiver.onChunk({
      assetId: ASSET,
      index: 0,
      data: 'abc',
    })

    expect(result.ok).toBe(true)
    expect(completed).toEqual([])
  })

  it('없는 자리의 조각은 버린다', async () => {
    receiver.expect(ASSET, 100)

    const result = await receiver.onChunk({ assetId: ASSET, index: 99, data: 'x' })

    expect(result.ok).toBe(true)
    expect(completed).toEqual([])
  })

  describe('다시 붙었을 때', () => {
    it('못 받은 조각만 달라고 한다', async () => {
      // **처음부터 다시 받으면** 사설망이 느릴 때 영영 못 끝낸다
      const size = 48 * 1024 * 4
      receiver.expect(ASSET, size)
      await receiver.onChunk({ assetId: ASSET, index: 0, data: 'A' })
      await receiver.onChunk({ assetId: ASSET, index: 2, data: 'C' })

      await receiver.requestMissing()

      const [request] = transport.sentOfType('asset_request')
      expect(request?.p.missing).toEqual([1, 3])
    })

    it('다 받은 것은 다시 달라고 하지 않는다', async () => {
      receiver.expect(ASSET, 100)
      await receiver.onChunk({ assetId: ASSET, index: 0, data: 'A' })

      await receiver.requestMissing()

      expect(transport.sentOfType('asset_request')).toHaveLength(0)
    })
  })
})

describe('보낸 것과 받은 것이 같다', () => {
  it('조각을 다 거쳐도 그대로다', async () => {
    // **한 바이트라도 어긋나면 사진이 깨진다.**
    // 보내는 쪽과 받는 쪽을 실제로 이어 본다.
    const transport = new FakeMessageTransport()
    const senderAssets = new FakeAssetStore()
    const receiverAssets = new FakeAssetStore()
    const resizer = new FakeImageResizer()

    const completed: string[] = []
    const receiver = new ReceiveAsset(
      {
        assets: receiverAssets,
        transport: new FakeMessageTransport(),
        clock: new FakeClock(),
        ids: new FakeIdGenerator(),
      },
      { onComplete: id => completed.push(id) },
    )

    const sender = new SendPhoto({
      transport,
      repository: new FakeConversationRepository(),
      assets: senderAssets,
      resizer,
      clock: new FakeClock(),
      ids: new FakeIdGenerator(),
    })

    const sent = await sender.execute({
      author: ME,
      conversation: startConversation(),
      uri: 'file:///photo.jpg',
    })
    if (!sent.ok) throw new Error('보내지 못했다')

    // 받는 쪽이 메시지를 먼저 보고 판을 깐다
    receiver.expect(sent.value.assetId, resizer.byteLength)

    for (const envelope of transport.sentOfType('asset_chunk')) {
      await receiver.onChunk(envelope.p)
    }

    expect(completed).toEqual([sent.value.assetId])
    expect(receiverAssets.contentOf(sent.value.assetId)).toBe(
      senderAssets.contentOf(sent.value.assetId),
    )
  })
})
