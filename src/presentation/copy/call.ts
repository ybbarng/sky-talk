import type { CallEndReason, CallPhase } from '@/domain/call/CallState'

/**
 * 통화 화면에 쓰는 글.
 *
 * **오류 코드를 띄우지 않는다.** 무엇이 잘못됐고 무엇을 누르면 되는지
 * 적는다. (docs/06-voice-video-spec.md 6장)
 */

export function phaseLabel(phase: CallPhase, peerName: string): string {
  switch (phase) {
    case 'idle':
      return ''
    case 'calling':
      return `${peerName}님을 부르는 중`
    case 'ringing':
      return `${peerName}님이 부르고 있어요`
    case 'connecting':
      return '이어지는 중'
    case 'active':
      return '통화 중'
    case 'ended':
      return '통화가 끝났어요'
  }
}

/**
 * 왜 끝났는지.
 *
 * **"실패"라고만 하면 사람은 무엇을 해야 할지 모른다.** 무엇을 하면
 * 되는지를 같이 적는다.
 */
export function endMessage(reason: CallEndReason | null, peerName: string): string {
  switch (reason) {
    case 'hung-up':
      return '통화를 끝냈어요.'
    case 'peer-hung-up':
      return `${peerName}님이 통화를 끝냈어요.`
    case 'declined':
      return `${peerName}님이 지금은 받기 어려운가 봐요. 글로 말을 걸어보세요.`
    case 'unanswered':
      return `${peerName}님이 못 받았어요. 글로 먼저 말을 걸어보세요.`
    case 'failed':
      return '소리를 잇지 못했어요. 통화는 집에서 Wi-Fi 로 이었을 때만 돼요.'
    case 'link-lost':
      return '연결이 끊겨 통화가 끝났어요. 글은 계속 주고받을 수 있어요.'
    case 'no-microphone':
      return '마이크를 쓸 수 없어요. 설정에서 허용해 주세요.'
    case 'unsupported':
      return '이 앱에서는 통화를 쓸 수 없어요. 글로는 그대로 이야기할 수 있어요.'
    default:
      return ''
  }
}

/** 다시 해볼 수 있는 일인가. 버튼을 보일지 정하는 데 쓴다 */
export function canRetry(reason: CallEndReason | null): boolean {
  return reason === 'failed' || reason === 'unanswered' || reason === 'link-lost'
}

/** 설정으로 데려다줘야 하는 일인가 */
export function needsSettings(reason: CallEndReason | null): boolean {
  return reason === 'no-microphone'
}

export const talkModeLabel = {
  'push-to-talk-brief': {
    title: '말할 때만 잠깐',
    hint: '버튼을 누를 때만 마이크가 켜져요',
  },
  'phone-mic': {
    title: '폰에 대고 말하기',
    hint: '이어폰은 듣기만 해요. 음악 음질이 그대로예요',
  },
  'like-a-call': {
    title: '전화처럼',
    hint: '이어폰으로 듣고 말해요',
  },
} as const

export const pushToTalk = {
  idle: '누르고 말하기',
  talking: '말하는 중',
  locked: '계속 말하는 중 · 누르면 멈춰요',
  hint: '위로 밀면 계속 켜져요',
}

/** 통화를 못 거는 이유 */
export const cannotCall = {
  unsupported: '이 앱에서는 통화를 쓸 수 없어요',
  notConnected: '먼저 이어져야 통화할 수 있어요',
  narrowLink: '지금은 글로만 이야기할 수 있어요',
}

export const headphonesGone = '이어폰이 빠져서 마이크를 껐어요'

export const batteryWarning = '영상 통화는 배터리를 많이 써요'
