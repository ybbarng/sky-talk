import { View } from 'react-native'
import type { Message } from '@/domain/message/Message'
import type { CharacterId } from '@/domain/peer/Character'
import type { PeerId } from '@/domain/peer/PeerId'
import { Sticker } from '../../characters/Sticker'
import { useTheme } from '../../theme/ThemeProvider'
import { DoodleRenderer } from '../doodle/DoodleRenderer'
import { Icon } from '../Icon'
import { Text } from '../Text'
import { BUBBLE_MAX_WIDTH } from './bubbleLayout'
import { DeliveryMark } from './DeliveryMark'
import { PhotoBubble } from './PhotoBubble'
import { VoiceBubble } from './VoiceBubble'

interface MessageBubbleProps {
  message: Message
  me: PeerId
  /** 사진을 다 받았으면 그 자리 */
  assetPath?: string | null
  /** 받는 중이면 0~1 */
  assetProgress?: number | null
  /** 바로 앞 메시지와 같은 사람이 보낸 것인가 */
  grouped: boolean
  /** 시각을 보여줄지. 연달아 온 것 중 마지막에만 보여준다 */
  showTime: boolean
  onRetry?: () => void
  /** 지금 이 음성을 듣고 있나 */
  playingVoice?: boolean
  onPlayVoice?: (assetId: string) => void
  onStopVoice?: () => void
}

export function MessageBubble({
  message,
  me,
  grouped,
  showTime,
  onRetry,
  assetPath = null,
  assetProgress = null,
  playingVoice = false,
  onPlayVoice,
  onStopVoice,
}: MessageBubbleProps) {
  const theme = useTheme()
  const mine = message.isMine(me)

  if (message.content.kind === 'system') {
    return <SystemNotice message={message} />
  }

  const bubbleColor = mine ? theme.colors.me : theme.colors.peer
  const textColor = mine ? theme.colors.meText : theme.colors.peerText

  // **이모티콘은 말풍선에 안 담는다.** 그림이 이미 말이라
  // 테두리를 두르면 답답해 보인다.
  const bare =
    message.content.kind === 'sticker' ||
    message.content.kind === 'photo' ||
    message.content.kind === 'doodle'

  // **들고 나는 움직임을 쓰지 않는다.**
  //
  // `reanimated` 의 레이아웃 움직임은 그려지는 자리와 실제 자리를
  // 어긋나게 만든다. 말풍선이 서로 겹쳐 보인 것이 이것 때문이다.
  // 설명 창에서 단추가 안 눌린 것도 같은 원인이었다.
  //
  // 대화가 읽히는 것이 살짝 떠오르는 것보다 중요하다.
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: BUBBLE_MAX_WIDTH,
        marginTop: grouped ? theme.spacing.xs : theme.spacing.md,
      }}
    >
      <View
        style={
          bare
            ? undefined
            : {
                backgroundColor: bubbleColor,
                borderRadius: theme.radius.xl,
                // 말하는 쪽 아래 모서리만 각지게. 꼬리 없이도 누구 말인지 안다.
                borderBottomRightRadius: mine ? theme.radius.sm : theme.radius.xl,
                borderBottomLeftRadius: mine ? theme.radius.xl : theme.radius.sm,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
              }
        }
      >
        <BubbleContent
          message={message}
          me={me}
          textColor={textColor}
          assetPath={assetPath}
          assetProgress={assetProgress}
          playingVoice={playingVoice}
          {...(onPlayVoice === undefined ? {} : { onPlayVoice })}
          {...(onStopVoice === undefined ? {} : { onStopVoice })}
        />
      </View>

      {showTime && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: mine ? 'flex-end' : 'flex-start',
            gap: theme.spacing.xs,
            marginTop: 2,
            paddingHorizontal: theme.spacing.xs,
          }}
        >
          <Text variant="caption" color="textFaint">
            {formatTime(message.orderedAt())}
          </Text>
          {mine && <DeliveryMark state={message.delivery} onRetry={onRetry} />}
        </View>
      )}
    </View>
  )
}

function BubbleContent({
  message,
  me,
  textColor,
  assetPath,
  assetProgress,
  playingVoice,
  onPlayVoice,
  onStopVoice,
}: {
  message: Message
  me: PeerId
  textColor: string
  assetPath: string | null
  assetProgress: number | null
  playingVoice: boolean
  onPlayVoice?: (assetId: string) => void
  onStopVoice?: () => void
}) {
  const theme = useTheme()

  switch (message.content.kind) {
    case 'text':
      return <Text style={{ color: textColor }}>{message.content.text}</Text>

    case 'nudge':
      return (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
        >
          <Icon name="poke" size={18} />
          <Text style={{ color: textColor }}>콕 찔렀어요</Text>
        </View>
      )

    case 'sticker':
      return (
        <Sticker
          character={message.content.character as CharacterId}
          pose={message.content.pose}
          size={120}
        />
      )

    case 'voice': {
      const assetId = message.content.assetId

      return (
        <VoiceBubble
          content={message.content}
          localPath={assetPath}
          {...(assetProgress === null ? {} : { progress: assetProgress })}
          playing={playingVoice}
          onPlay={() => onPlayVoice?.(assetId)}
          onStop={() => onStopVoice?.()}
        />
      )
    }

    case 'photo':
      return (
        <PhotoBubble
          content={message.content}
          localPath={assetPath}
          progress={assetProgress}
        />
      )

    case 'doodle':
      return (
        <DoodleRenderer
          strokes={message.content.strokes}
          width={220}
          height={160}
          // 받은 낙서만 그려지는 과정을 보여준다.
          // 내가 그린 것은 이미 봤다.
          animate={!message.isMine(me)}
        />
      )

    case 'system':
      return null
  }
}

/** 앱이 끼워 넣는 알림. 말풍선이 아니라 가운데 작은 글로 */
function SystemNotice({ message }: { message: Message }) {
  const theme = useTheme()
  if (message.content.kind !== 'system') return null

  return (
    <View style={{ alignItems: 'center', marginVertical: theme.spacing.md }}>
      <Text variant="caption" color="textFaint">
        {noticeText(message.content.notice)}
      </Text>
    </View>
  )
}

function noticeText(notice: string): string {
  switch (notice) {
    case 'link-lost':
      return '연결이 끊겼어요'
    case 'link-restored':
      return '다시 연결됐어요'
    case 'switched-to-bluetooth':
      return '블루투스로 바뀌었어요 · 사진과 음성은 작게 줄여서 가요'
    case 'switched-to-wifi':
      return 'Wi-Fi 로 바뀌었어요 · 사진과 목소리가 그대로 가요'
    case 'call-ended':
      return '통화가 끝났어요'
    case 'conversation-imported':
      return '대화를 불러왔어요'
    default:
      return ''
  }
}

function formatTime(at: Date): string {
  const hours = at.getHours()
  const minutes = at.getMinutes().toString().padStart(2, '0')
  const period = hours < 12 ? '오전' : '오후'
  const displayHours = hours % 12 === 0 ? 12 : hours % 12

  return `${period} ${displayHours}:${minutes}`
}
