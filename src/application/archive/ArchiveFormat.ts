import type { DeliveryState } from '@/domain/message/DeliveryState'
import type { MessageContent } from '@/domain/message/MessageContent'

/**
 * 꺼내둔 대화의 생김새.
 *
 * **이 형식은 앱보다 오래 산다.** 아이폰 앱은 7일마다 만료되고, 그때
 * 남는 건 이 파일뿐이다. 그래서 여기 적힌 모양을 함부로 바꾸지 않는다.
 * 늘려야 하면 자리를 더하고, 있던 자리는 그대로 둔다. 예전에 꺼내둔
 * 파일이 계속 열려야 한다. (docs/05-messaging-spec.md 6장)
 *
 * 날짜를 숫자(밀리초)로 담는 이유는 시간대 때문이다. 글자로 적으면
 * 어느 시간대에서 읽느냐에 따라 값이 달라진다. 시차를 넘는 비행에서
 * 두 폰의 시간대가 다르므로 이게 실제로 문제가 된다.
 */

/** 형식이 바뀌면 올린다. 읽는 쪽이 이걸 보고 다룰 수 있는지 판단한다 */
export const ARCHIVE_VERSION = 1

/** 다른 앱이 만든 JSON 을 거르는 표시 (05-messaging-spec.md 6.2) */
export const ARCHIVE_FORMAT = 'skytalk-archive'

/**
 * 예전 이름(Skywalkie) 때 만든 파일의 표시. 2026-10-12 에 이름을 바꿨다.
 *
 * **읽을 때만 받아준다.** 그때 꺼낸 파일도 되돌릴 수 있어야 한다.
 */
export const LEGACY_ARCHIVE_FORMATS: readonly string[] = ['skywalkie-archive']

export interface ArchiveFile {
  readonly format: typeof ARCHIVE_FORMAT
  readonly version: number
  /** 꺼낸 시각 */
  readonly exportedAt: number
  readonly people: readonly ArchivedPerson[]
  readonly messages: readonly ArchivedMessage[]
  readonly integrity: ArchiveIntegrity
}

export interface ArchivedPerson {
  readonly peerId: string
  readonly displayName: string
  readonly character: string
}

export interface ArchivedMessage {
  readonly id: string
  readonly author: string
  readonly content: MessageContent
  readonly sentAt: number
  readonly receivedAt: number | null
  readonly seq: number
  readonly delivery: DeliveryState
}

/**
 * 파일이 온전한지 알아보는 값.
 *
 * **파일이 잘렸는데 모르고 넘어가는 일을 막는다.** 되돌릴 때 다시 세어
 * 대조하고, 어긋나면 멈춘다. 조용히 절반만 되살아나는 것보다 낫다.
 */
export interface ArchiveIntegrity {
  readonly messageCount: number
  /** 메시지 id 를 정렬해 이은 값의 요약 */
  readonly checksum: string
  readonly firstMessageId: string | null
  readonly lastMessageId: string | null
  /**
   * 꺼내기 시작할 때 저장소가 "이만큼 있다"고 답한 수.
   *
   * **`messageCount` 와 이 값이 다르면 꺼내다 만 것이다.** 저장소가
   * 중간에 한 건을 해석하지 못하면 거기서 조용히 멈추는데, 그러면
   * 나머지가 없는 채로 **스스로는 앞뒤가 맞는** 파일이 나온다.
   * 검증값까지 그 상태로 계산되니 되돌릴 때도 안 걸린다.
   *
   * 그래서 바깥에서 센 수를 따로 적어둔다. 이게 유일한 단서다.
   *
   * 예전 파일에는 없다. 없으면 확인을 건너뛴다.
   */
  readonly sourceCount?: number
}
