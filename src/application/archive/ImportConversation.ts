import { deliveryStates } from '@/domain/message/DeliveryState'
import { Message } from '@/domain/message/Message'
import { messageId } from '@/domain/message/MessageId'
import { peerId } from '@/domain/peer/PeerId'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'
import type { ConversationRepository } from '../ports/ConversationRepository'
import type { Hasher } from '../ports/FileStore'
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  type ArchivedMessage,
  type ArchivedPerson,
  type ArchiveIntegrity,
  LEGACY_ARCHIVE_FORMATS,
} from './ArchiveFormat'
import { compareIntegrity, computeIntegrity } from './ArchiveIntegrity'

/**
 * 꺼내둔 파일을 도로 넣는다.
 *
 * **두 번 불러도 두 배가 되지 않는다.** id 가 기준이라, 이미 있는
 * 것은 건너뛴다. 사람은 같은 파일을 두 번 고르기 마련이고, 그때마다
 * 대화가 불어나면 아무도 이 기능을 못 믿는다.
 *
 * **어긋나면 하나도 넣지 않는다.** 반쯤 넣고 알려주면 이미 늦다.
 * 먼저 전부 확인하고, 통과해야 넣는다.
 *
 * (docs/05-messaging-spec.md 6장 · T19)
 */

export interface ImportDeps {
  readonly repository: ConversationRepository
  readonly hasher: Hasher
}

export interface ImportOutcome {
  readonly inserted: number
  /** 이미 있어서 건너뛴 것 */
  readonly skipped: number
  /** 아예 읽지 못한 것. 망가진 파일을 억지로 열었을 때만 0 이 아니다 */
  readonly unreadable: number
  /** 어디가 어긋났는지. 멀쩡했으면 null */
  readonly damage: DomainError | null
  /** 파일에 함께 들어 있던 사람들. 프로필을 덮어쓸지는 화면이 물어본다 */
  readonly people: readonly ArchivedPerson[]
}

export interface ImportOptions {
  /**
   * 망가진 파일이어도 건질 수 있는 만큼 건진다.
   *
   * **기본은 거절이다.** 하지만 그 파일이 하나뿐이면 거절은 곧
   * 통째로 잃는 것이다. 그래서 화면이 "그래도 불러올까요?" 를 묻고,
   * 사용자가 그러겠다고 하면 이 길로 온다.
   * (05-messaging-spec.md 6.3)
   *
   * 이때도 **읽을 수 없는 한 건 때문에 나머지를 버리지는 않는다.**
   * 되살릴 수 있는 것만 넣고 몇 건을 못 읽었는지 알려준다.
   */
  readonly ignoreDamage?: boolean
}

export class ImportConversation {
  constructor(private readonly deps: ImportDeps) {}

  async fromJson(
    raw: string,
    options: ImportOptions = {},
  ): Promise<Result<ImportOutcome, DomainError>> {
    const parsed = parseArchive(raw)
    // 뜯지도 못하면 건질 것이 없다. 억지로 넘어가도 할 수 있는 게 없다.
    if (!parsed.ok) return parsed

    const file = parsed.value

    // 적혀 있던 값과 실제로 들어 있는 것을 맞춰본다.
    // 여기서 걸리면 파일이 잘렸거나 망가진 것이다.
    const actual = await computeIntegrity(
      this.deps.hasher,
      file.messages.map(m => m.id),
    )
    if (!actual.ok) return actual

    const matches = compareIntegrity(file.integrity, actual.value)
    const damage = matches.ok ? null : matches.error
    if (damage !== null && options.ignoreDamage !== true) return err(damage)

    // 전부 도메인 값으로 바꿔본 뒤에 넣는다.
    const messages: Message[] = []
    let unreadable = 0

    for (const [index, archived] of file.messages.entries()) {
      const restored = restore(archived, index)

      if (!restored.ok) {
        // 멀쩡한 파일이면 한 건이라도 이상할 때 하나도 넣지 않는다.
        // 반쯤 넣고 알려주면 이미 늦다.
        if (options.ignoreDamage !== true) return restored
        unreadable += 1
        continue
      }

      messages.push(restored.value)
    }

    const saved = await this.deps.repository.saveMany(messages)
    if (!saved.ok) return saved

    return ok({
      inserted: saved.value.inserted,
      skipped: saved.value.skipped,
      unreadable,
      damage,
      people: file.people,
    })
  }
}

interface ParsedArchive {
  readonly people: readonly ArchivedPerson[]
  readonly messages: readonly ArchivedMessage[]
  readonly integrity: ArchiveIntegrity
}

/**
 * 파일을 뜯어본다.
 *
 * **다른 앱이 만든 JSON 을 거절한다.** 표시가 없으면 우리 것이 아니다.
 * 엉뚱한 파일을 넣어 대화가 뒤섞이는 일을 막는다.
 */
export function parseArchive(raw: string): Result<ParsedArchive, DomainError> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    // 잘린 파일이 가장 흔하다. 끝이 잘리면 JSON 이 안 닫힌다.
    return err(
      domainError(
        'invalid-value',
        '파일을 읽지 못했어요. 옮기는 중에 잘렸을 수 있어요',
        'archive',
      ),
    )
  }

  if (typeof value !== 'object' || value === null) {
    return err(domainError('invalid-value', '대화 파일이 아니에요', 'archive'))
  }

  const file = value as Record<string, unknown>

  const format = typeof file.format === 'string' ? file.format : ''
  if (format !== ARCHIVE_FORMAT && !LEGACY_ARCHIVE_FORMATS.includes(format)) {
    return err(
      domainError('invalid-value', 'SkyTalk 에서 만든 대화 파일이 아니에요', 'archive'),
    )
  }

  if (typeof file.version !== 'number' || file.version > ARCHIVE_VERSION) {
    return err(
      domainError(
        'invalid-value',
        '더 새로운 앱이 만든 파일이에요. 앱을 새로 깔아야 열 수 있어요',
        'archive',
      ),
    )
  }

  if (!Array.isArray(file.messages)) {
    return err(domainError('invalid-value', '대화 내용이 들어 있지 않아요', 'archive'))
  }

  const integrity = file.integrity
  if (typeof integrity !== 'object' || integrity === null) {
    return err(
      domainError(
        'invalid-value',
        '확인용 값이 없어요. 파일이 잘린 것 같아요',
        'archive',
      ),
    )
  }

  const check = integrity as Record<string, unknown>
  if (typeof check.messageCount !== 'number' || typeof check.checksum !== 'string') {
    return err(domainError('invalid-value', '확인용 값이 온전하지 않아요', 'archive'))
  }

  return ok({
    people: Array.isArray(file.people) ? (file.people as ArchivedPerson[]) : [],
    messages: file.messages as ArchivedMessage[],
    integrity: {
      messageCount: check.messageCount,
      checksum: check.checksum,
      firstMessageId:
        typeof check.firstMessageId === 'string' ? check.firstMessageId : null,
      lastMessageId: typeof check.lastMessageId === 'string' ? check.lastMessageId : null,
      // 예전 파일에는 없다. 없으면 이 확인을 건너뛴다.
      ...(typeof check.sourceCount === 'number'
        ? { sourceCount: check.sourceCount }
        : {}),
    },
  })
}

/** 한 건을 도메인 값으로 되살린다. 검사는 도메인이 한다 */
function restore(archived: ArchivedMessage, index: number): Result<Message, DomainError> {
  const where = `${index + 1}번째 메시지`

  if (typeof archived !== 'object' || archived === null) {
    return err(domainError('invalid-value', `${where}가 비어 있어요`, 'archive'))
  }

  const id = messageId(String(archived.id))
  if (!id.ok) return err(withPlace(id.error, where))

  const author = peerId(String(archived.author))
  if (!author.ok) return err(withPlace(author.error, where))

  if (!isDelivery(archived.delivery)) {
    return err(domainError('invalid-value', `${where}의 상태를 알 수 없어요`, 'archive'))
  }

  if (typeof archived.sentAt !== 'number' || !Number.isFinite(archived.sentAt)) {
    return err(domainError('invalid-value', `${where}의 시각이 이상해요`, 'archive'))
  }

  const receivedAt =
    typeof archived.receivedAt === 'number' ? new Date(archived.receivedAt) : null

  const message = Message.compose({
    id: id.value,
    author: author.value,
    content: archived.content,
    sentAt: new Date(archived.sentAt),
    receivedAt,
    seq: archived.seq,
    delivery: archived.delivery,
  })

  return message.ok ? message : err(withPlace(message.error, where))
}

function isDelivery(value: unknown): value is ArchivedMessage['delivery'] {
  return (
    typeof value === 'string' && (deliveryStates as readonly string[]).includes(value)
  )
}

/** 몇 번째에서 걸렸는지 붙여준다. 만 건 중 하나가 이상할 때 찾을 수 있어야 한다 */
function withPlace(error: DomainError, where: string): DomainError {
  return domainError(error.code, `${where}: ${error.detail}`, error.field)
}
