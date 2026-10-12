import { FakeClock } from '@test/fakes/FakeClock'
import { FakeConversationRepository } from '@test/fakes/FakeConversationRepository'
import {
  HER,
  ME,
  makeDraft,
  makeReceived,
  makeText,
  ulidSequence,
} from '@test/support/factories'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DomainError } from '@/domain/shared/DomainError'
import { ok, type Result } from '@/domain/shared/Result'
import { sha256Hex } from '@/infrastructure/archive/Sha256'
import type { Hasher } from '../ports/FileStore'
import { ExportConversation } from './ExportConversation'
import { ImportConversation } from './ImportConversation'

/**
 * 꺼냈다 도로 넣기.
 *
 * **아이폰 앱은 7일마다 만료된다.** 다시 깐 뒤 대화를 못 되돌리면
 * 여행의 절반이 사라진다. 그래서 이 시험이 T19 에서 가장 값지다.
 *
 * 스스로와만 맞춰보지 않도록, 요약값은 실제로 쓰는 것과 같은 구현을
 * 쓴다. 가짜로 바꿔치우면 값이 틀려도 통과한다.
 */

const realHasher: Hasher = {
  async sha256(value: string): Promise<Result<string, DomainError>> {
    return ok(sha256Hex(value))
  },
}

const people = [
  { peerId: ME, displayName: '나', character: 'orion' },
  { peerId: HER, displayName: '지민', character: 'aria' },
]

describe('꺼냈다 도로 넣기', () => {
  let source: FakeConversationRepository
  let target: FakeConversationRepository
  let exporter: ExportConversation
  let importer: ImportConversation

  beforeEach(() => {
    source = new FakeConversationRepository()
    target = new FakeConversationRepository()
    exporter = new ExportConversation({
      repository: source,
      hasher: realHasher,
      clock: new FakeClock(),
    })
    importer = new ImportConversation({ repository: target, hasher: realHasher })
  })

  async function fill(count: number): Promise<void> {
    const nextId = ulidSequence()
    for (let i = 0; i < count; i += 1) {
      // 양쪽이 번갈아 말하는 실제 대화 모양으로 만든다
      const message =
        i % 2 === 0
          ? makeDraft({
              id: nextId(),
              seq: Math.floor(i / 2) + 1,
              content: makeText(`내가 한 말 ${i}`),
            })
          : makeReceived({
              id: nextId(),
              seq: Math.floor(i / 2) + 1,
              content: makeText(`상대가 한 말 ${i}`),
            })
      await source.save(message)
    }
  }

  async function exported(batchSize = 200): Promise<string> {
    const json = await exporter.toJson({ people, batchSize })
    if (!json.ok) throw new Error('꺼내지 못했다')
    return json.value
  }

  it('한 건도 빠지지 않고 돌아온다', async () => {
    await fill(50)

    const result = await importer.fromJson(await exported())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.inserted).toBe(50)
    expect(target.all()).toHaveLength(50)
  })

  it('내용과 시각이 그대로다', async () => {
    await fill(4)

    await importer.fromJson(await exported())

    const before = source.all()
    const after = target.all()

    for (const [index, original] of before.entries()) {
      const restored = after[index]
      expect(restored?.id).toBe(original.id)
      expect(restored?.author).toBe(original.author)
      expect(restored?.content).toEqual(original.content)
      expect(restored?.sentAt.getTime()).toBe(original.sentAt.getTime())
      expect(restored?.receivedAt?.getTime() ?? null).toBe(
        original.receivedAt?.getTime() ?? null,
      )
      expect(restored?.seq).toBe(original.seq)
      expect(restored?.delivery).toBe(original.delivery)
    }
  })

  it('같은 파일을 두 번 넣어도 두 배가 되지 않는다', async () => {
    // 사람은 같은 파일을 두 번 고르기 마련이다.
    // 그때마다 대화가 불어나면 아무도 이 기능을 못 믿는다.
    await fill(20)
    const file = await exported()

    await importer.fromJson(file)
    const second = await importer.fromJson(file)

    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.inserted).toBe(0)
    expect(second.value.skipped).toBe(20)
    expect(target.all()).toHaveLength(20)
  })

  it('이미 있는 것과 섞여도 없는 것만 넣는다', async () => {
    await fill(10)
    const file = await exported()

    // 절반은 이미 들어와 있다고 치자
    for (const message of source.all().slice(0, 4)) {
      await target.save(message)
    }

    const result = await importer.fromJson(file)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.inserted).toBe(6)
    expect(result.value.skipped).toBe(4)
    expect(target.all()).toHaveLength(10)
  })

  it('사람 정보도 같이 나온다', async () => {
    await fill(2)

    const result = await importer.fromJson(await exported())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 덮어쓸지는 화면이 물어본다. 여기서는 전해주기만 한다.
    expect(result.value.people).toEqual(people)
  })

  it('조금씩 끊어 읽어도 결과가 같다', async () => {
    // 만 건짜리 대화는 나눠 읽는다. 나누는 크기가 결과를 바꾸면 안 된다.
    await fill(25)

    const wholeAtOnce = await exported(1000)
    const inSmallBites = await exported(3)

    expect(inSmallBites).toBe(wholeAtOnce)
  })

  it('빈 대화도 꺼냈다 넣을 수 있다', async () => {
    const result = await importer.fromJson(await exported())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.inserted).toBe(0)
  })

  it('예전 이름(Skywalkie) 때 꺼낸 파일도 되돌린다', async () => {
    // 2026-10-12 에 이름을 바꿨다. 그 전에 꺼낸 파일은 표시가 다르다
    await fill(4)
    const json = (await exported()).replace('"skytalk-archive"', '"skywalkie-archive"')

    const result = await importer.fromJson(json)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.inserted).toBe(4)
  })
})

describe('만 건짜리 대화', () => {
  it('꺼냈다 넣어도 하나도 빠지지 않는다', async () => {
    // 세 시간 비행에서 만 건은 안 나온다. 그래도 여기서 터지면
    // **어디서 터지는지 알 수 없는 채로** 여행을 가게 된다.
    const source = new FakeConversationRepository()
    const nextId = ulidSequence()
    for (let i = 0; i < 10_000; i += 1) {
      await source.save(makeDraft({ id: nextId(), seq: i + 1 }))
    }

    const exporter = new ExportConversation({
      repository: source,
      hasher: realHasher,
      clock: new FakeClock(),
    })

    const startedAt = Date.now()
    const json = await exporter.toJson({ people, batchSize: 200 })
    const tookMs = Date.now() - startedAt

    expect(json.ok).toBe(true)
    if (!json.ok) return

    const target = new FakeConversationRepository()
    const importer = new ImportConversation({ repository: target, hasher: realHasher })
    const result = await importer.fromJson(json.value)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.inserted).toBe(10_000)
    // 카드가 정한 기준이다. 화면이 멈춘 것처럼 보이면 안 된다.
    expect(tookMs).toBeLessThan(5000)
  })

  it('진행률을 알려준다', async () => {
    // 아무 표시 없이 오래 걸리면 사람은 앱이 멈춘 줄 안다
    const source = new FakeConversationRepository()
    const nextId = ulidSequence()
    for (let i = 0; i < 500; i += 1) {
      await source.save(makeDraft({ id: nextId(), seq: i + 1 }))
    }

    const exporter = new ExportConversation({
      repository: source,
      hasher: realHasher,
      clock: new FakeClock(),
    })

    const steps: Array<[number, number]> = []
    await exporter.toJson({
      people,
      batchSize: 100,
      onProgress: (done, total) => steps.push([done, total]),
    })

    expect(steps).toEqual([
      [100, 500],
      [200, 500],
      [300, 500],
      [400, 500],
      [500, 500],
    ])
  })
})

describe('망가진 파일은', () => {
  const importer = new ImportConversation({
    repository: new FakeConversationRepository(),
    hasher: realHasher,
  })

  async function goodFile(): Promise<string> {
    const source = new FakeConversationRepository()
    const nextId = ulidSequence()
    for (let i = 0; i < 6; i += 1) {
      await source.save(makeDraft({ id: nextId(), seq: i + 1 }))
    }
    const exporter = new ExportConversation({
      repository: source,
      hasher: realHasher,
      clock: new FakeClock(),
    })
    const json = await exporter.toJson({ people })
    if (!json.ok) throw new Error('꺼내지 못했다')
    return json.value
  }

  it('끝이 잘리면 거절한다', async () => {
    // 옮기는 중에 잘리는 것이 가장 흔한 사고다
    const file = await goodFile()

    const result = await importer.fromJson(file.slice(0, file.length - 40))

    expect(result.ok).toBe(false)
  })

  it('한 건이 사라지면 알아챈다', async () => {
    // JSON 은 멀쩡한데 내용만 빈 경우다. 세어보지 않으면 못 잡는다.
    const file = JSON.parse(await goodFile())
    file.messages = file.messages.slice(0, 5)

    const result = await importer.fromJson(JSON.stringify(file))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.detail).toContain('잘린')
  })

  it('내용이 바뀌면 알아챈다', async () => {
    const file = JSON.parse(await goodFile())
    file.messages[0].id = file.messages[1].id

    const result = await importer.fromJson(JSON.stringify(file))

    expect(result.ok).toBe(false)
  })

  it('꺼내다 만 파일을 거절한다', async () => {
    // **이게 가장 무서운 경우다.** 저장소가 중간에 한 건을 해석하지
    // 못하면 거기서 조용히 멈춘다. 그러면 파일 자체는 멀쩡하다.
    // 적힌 건수와 든 건수가 맞고 검증값도 맞는다. 꺼내다 만 상태
    // 그대로 앞뒤가 맞기 때문이다.
    //
    // 저장소가 "이만큼 있다"고 했던 수와 견주는 것만이 단서다.
    const source = new FakeConversationRepository()
    const nextId = ulidSequence()
    for (let i = 0; i < 10; i += 1) {
      await source.save(makeDraft({ id: nextId(), seq: i + 1 }))
    }

    // 여섯 건만 흘려주는 저장소로 바꿔치운다. 실제로 중간에
    // 멈췄을 때 나오는 파일과 똑같은 것이 만들어진다.
    const halting = {
      ...source,
      count: () => source.count(),
      streamAll: async function* (): AsyncIterable<
        import('@/domain/message/Message').Message[]
      > {
        yield source.all().slice(0, 6)
      },
    } as unknown as FakeConversationRepository

    const exporter = new ExportConversation({
      repository: halting,
      hasher: realHasher,
      clock: new FakeClock(),
    })
    const json = await exporter.toJson({ people })
    if (!json.ok) throw new Error('꺼내지 못했다')

    // 파일 자체는 앞뒤가 맞는다는 것부터 확인한다
    const parsed = JSON.parse(json.value)
    expect(parsed.messages).toHaveLength(6)
    expect(parsed.integrity.messageCount).toBe(6)
    expect(parsed.integrity.sourceCount).toBe(10)

    const result = await importer.fromJson(json.value)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.detail).toContain('4건이 빠져')
  })

  it('예전 파일에는 그 확인을 건너뛴다', async () => {
    // sourceCount 가 없던 시절에 꺼내둔 파일도 열려야 한다.
    // 대화가 앱보다 오래 사는 게 이 기능의 목적이다.
    const file = JSON.parse(await goodFile())
    delete file.integrity.sourceCount

    const repository = new FakeConversationRepository()
    const old = new ImportConversation({ repository, hasher: realHasher })
    const result = await old.fromJson(JSON.stringify(file))

    expect(result.ok).toBe(true)
  })

  describe('그래도 불러오겠다고 하면', () => {
    it('건질 수 있는 만큼 건진다', async () => {
      // **거절만 하면 그 파일이 하나뿐일 때 통째로 잃는다.**
      // 망가졌다고 알린 다음, 그래도 열겠다면 열어준다.
      const file = JSON.parse(await goodFile())
      file.integrity.checksum = 'sha256:엉뚱한값'

      const repository = new FakeConversationRepository()
      const salvage = new ImportConversation({ repository, hasher: realHasher })
      const result = await salvage.fromJson(JSON.stringify(file), {
        ignoreDamage: true,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.inserted).toBe(6)
      // 무엇이 어긋났는지는 그대로 알려준다. 멀쩡했던 척하지 않는다.
      expect(result.value.damage).not.toBeNull()
    })

    it('못 읽은 건수를 알려준다', async () => {
      // 읽을 수 없는 한 건 때문에 나머지를 버리지 않는다
      const file = JSON.parse(await goodFile())
      file.messages[2].seq = 0
      file.messages[4].sentAt = '어제'

      const repository = new FakeConversationRepository()
      const salvage = new ImportConversation({ repository, hasher: realHasher })
      const result = await salvage.fromJson(JSON.stringify(file), {
        ignoreDamage: true,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.inserted).toBe(4)
      expect(result.value.unreadable).toBe(2)
    })

    it('멀쩡한 파일이면 못 읽은 것이 없다', async () => {
      const repository = new FakeConversationRepository()
      const normal = new ImportConversation({ repository, hasher: realHasher })
      const result = await normal.fromJson(await goodFile())

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.unreadable).toBe(0)
      expect(result.value.damage).toBeNull()
    })

    it('뜯지도 못하는 파일은 그래도 안 된다', async () => {
      // 건질 것이 없다. 억지로 넘어가도 할 수 있는 게 없다.
      const salvage = new ImportConversation({
        repository: new FakeConversationRepository(),
        hasher: realHasher,
      })

      const result = await salvage.fromJson('그냥 글', { ignoreDamage: true })

      expect(result.ok).toBe(false)
    })
  })

  it('다른 앱이 만든 JSON 은 거절한다', async () => {
    const result = await importer.fromJson('{"messages":[],"version":1}')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.detail).toContain('SkyTalk')
  })

  it('JSON 이 아니면 거절한다', async () => {
    const result = await importer.fromJson('그냥 글')

    expect(result.ok).toBe(false)
  })

  it('더 새로운 앱이 만든 파일은 거절한다', async () => {
    const file = JSON.parse(await goodFile())
    file.version = 99

    const result = await importer.fromJson(JSON.stringify(file))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.detail).toContain('새로운')
  })

  it('한 건이라도 이상하면 하나도 넣지 않는다', async () => {
    // 반쯤 넣고 알려주면 이미 늦다
    const repository = new FakeConversationRepository()
    const strict = new ImportConversation({ repository, hasher: realHasher })
    const file = JSON.parse(await goodFile())
    file.messages[3].seq = 0 // 순번은 1부터다

    const result = await strict.fromJson(JSON.stringify(file))

    expect(result.ok).toBe(false)
    expect(repository.all()).toHaveLength(0)
  })

  it('몇 번째가 이상한지 알려준다', async () => {
    const file = JSON.parse(await goodFile())
    file.messages[3].seq = 0

    const result = await importer.fromJson(JSON.stringify(file))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.detail).toContain('4번째')
  })
})
