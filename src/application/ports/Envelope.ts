import type { MessageContent } from '@/domain/message/MessageContent'
import type { CharacterId } from '@/domain/peer/Character'

/**
 * 두 기기가 주고받는 봉투.
 *
 * **연결 방식이 달라도 봉투의 생김새는 같다.** Wi-Fi 든 블루투스든 웹이든
 * 같은 형식을 쓴다. 그래야 길을 갈아타도 위층 코드가 그대로다.
 *
 * 여기는 "무엇을 주고받는가"만 정한다. 바이트로 바꾸고 형식을 검사하는
 * 일은 infrastructure 가 한다. 이 층은 zod 같은 바깥 도구를 모른다.
 * (docs/04-transport-spec.md 3장)
 */

/** 규약 버전. 기기끼리 다르면 인사 단계에서 낮은 쪽에 맞춘다 */
export const PROTOCOL_VERSION = 1

export interface EnvelopeHeader {
  /** 규약 버전 */
  readonly v: number
  /** 이 봉투의 고유 번호 (ULID) */
  readonly id: string
  /** 보낸 쪽 기준 순번 */
  readonly seq: number
  /** 보낸 시각. 밀리초 */
  readonly ts: number
}

export interface HelloPayload {
  readonly peerId: string
  readonly displayName: string
  readonly character: CharacterId
  /** 내가 상대에게서 마지막으로 받은 순번. 놓친 걸 바로 알아채려고 알려준다 */
  readonly lastSeenSeq: number
  readonly appVersion: string
}

/**
 * 인사에 대한 답. 내용은 인사와 같다.
 *
 * 예전에는 여섯 자리 코드가 맞는지 보고 받아들일지 정했는데, 그 기능을
 * 없앴다. 붙은 상대는 그냥 우리 둘이다. 두 사람이 쓰는 앱이고 비행기
 * 안에서 코드를 맞추다 대화를 못 하는 편이 훨씬 나쁘다.
 */
export type HelloAckPayload = HelloPayload

export interface MessagePayload {
  readonly messageId: string
  readonly author: string
  readonly content: MessageContent
  readonly sentAt: number
  readonly messageSeq: number
}

export interface AckPayload {
  readonly messageId: string
}

export interface ReadPayload {
  /** 여러 건을 묶어 한 번에 보낸다 */
  readonly messageIds: readonly string[]
}

export interface TypingPayload {
  readonly typing: boolean
}

export interface NudgePayload {
  readonly messageId: string
}

export interface PresencePayload {
  readonly foreground: boolean
  readonly batteryLevel?: number
  /** 지금 듣는 것. 사용자가 켰을 때만 보낸다 */
  readonly nowPlaying?: string
}

/**
 * 목적지까지 남은 시간.
 *
 * **시각이 아니라 남은 길이를 보낸다.** 두 폰의 시계가 다를 수 있고,
 * 시차를 넘으면 한쪽이 먼저 시간대를 바꾼다. 받는 쪽이 자기 시계로
 * 도착 시각을 다시 센다. (docs/05-messaging-spec.md)
 */
export interface FlightPayload {
  /** 앞으로 이만큼 남았다. 0 이면 끈 것이다 */
  readonly remainingMs: number
  /**
   * 비행이 통째로 얼마나 긴가. 진행 막대의 출발점이 된다.
   *
   * 출발·도착 시각으로 잡으면 남은 것보다 길다. **없으면 남은 것을
   * 총 길이로 본다.** 예전 앱이 보낸 봉투가 그렇다.
   */
  readonly totalMs?: number
}

export interface SyncRequestPayload {
  /** 못 받은 순번들 */
  readonly missingSeqs: readonly number[]
}

export interface SyncResponsePayload {
  readonly messages: readonly MessagePayload[]
  /** 상대가 요청한 것 중 이제는 없는 것 */
  readonly unavailableSeqs: readonly number[]
}

export interface CallSignalPayload {
  readonly kind: 'offer' | 'answer' | 'candidate' | 'hangup' | 'decline'
  readonly sdp?: string
  readonly candidate?: string
  readonly sdpMid?: string
  readonly sdpMLineIndex?: number
  /**
   * 소리만인가 영상까지인가. `offer` 에만 붙는다.
   *
   * 없으면 소리로 본다. 예전 버전이 보낸 봉투일 수 있는데,
   * 거기서 멈추면 통화가 아예 안 된다.
   */
  readonly media?: 'voice' | 'video'
}

/**
 * 사진 조각 하나.
 *
 * 사진은 봉투 하나에 안 들어간다. 잘게 잘라 보내고 그 사이사이로
 * 글이 지나간다. **큰 봉투 하나를 보내는 동안 글이 막히면 안 된다.**
 */
export interface AssetChunkPayload {
  readonly assetId: string
  readonly index: number
  /** base64 로 담은 조각 */
  readonly data: string
}

/** 못 받은 조각을 달라고 한다. 끊겼다 다시 붙었을 때 쓴다 */
export interface AssetRequestPayload {
  readonly assetId: string
  readonly missing: readonly number[]
}

export interface ByePayload {
  readonly reason: 'user-stopped' | 'app-closing' | 'switching-link'
}

export type Envelope =
  | (EnvelopeHeader & { t: 'hello'; p: HelloPayload })
  | (EnvelopeHeader & { t: 'hello_ack'; p: HelloAckPayload })
  | (EnvelopeHeader & { t: 'message'; p: MessagePayload })
  | (EnvelopeHeader & { t: 'ack'; p: AckPayload })
  | (EnvelopeHeader & { t: 'read'; p: ReadPayload })
  | (EnvelopeHeader & { t: 'typing'; p: TypingPayload })
  | (EnvelopeHeader & { t: 'nudge'; p: NudgePayload })
  | (EnvelopeHeader & { t: 'presence'; p: PresencePayload })
  | (EnvelopeHeader & { t: 'flight'; p: FlightPayload })
  | (EnvelopeHeader & { t: 'sync_request'; p: SyncRequestPayload })
  | (EnvelopeHeader & { t: 'sync_response'; p: SyncResponsePayload })
  | (EnvelopeHeader & { t: 'call_signal'; p: CallSignalPayload })
  | (EnvelopeHeader & { t: 'asset_chunk'; p: AssetChunkPayload })
  | (EnvelopeHeader & { t: 'asset_request'; p: AssetRequestPayload })
  | (EnvelopeHeader & { t: 'bye'; p: ByePayload })

export type EnvelopeType = Envelope['t']

/**
 * 좁은 길(블루투스)로도 보낼 만한 봉투인가.
 *
 * 입력 중 표시 같은 건 안 보낸다. 좁은 길을 실제 대화에 양보한다.
 * (docs/04-transport-spec.md 4.4)
 */
export function worthSendingOnNarrowLink(type: EnvelopeType): boolean {
  // 사진 조각은 좁은 길을 통째로 막는다. Wi-Fi 가 열릴 때까지 기다린다.
  return type !== 'typing' && type !== 'presence' && type !== 'asset_chunk'
}

/** 받았다는 답을 기다려야 하는 봉투인가 */
export function expectsAck(type: EnvelopeType): boolean {
  return type === 'message'
}
