import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { MAX_TEXT_LENGTH } from '@/domain/message/MessageContent'
import { useTheme } from '../../theme/ThemeProvider'
import { Icon, type IconName } from '../Icon'
import { Text } from '../Text'

interface MessageInputProps {
  onSend(text: string): void
  onTyping?(typing: boolean): void
  onNudge?(): void
  onDoodle?(): void
  /** 이모티콘 서랍을 여닫는다 */
  onStickers?(): void
  /** 앨범에서 사진을 고른다 */
  onPhoto?(): void
  /** 길게 누르면 카메라를 연다. 지금 찍어 보낼 때 */
  onCamera?(): void
  /** 꾹 누르는 동안 녹음한다 */
  onRecordStart?(): void
  onRecordStop?(): void
  onRecordCancel?(): void
  /** 지금 녹음 중인가 */
  recording?: boolean
  /** 끊겨 있으면 알려준다. 입력을 막지는 않는다 */
  offline?: boolean
}

/**
 * 메시지 입력칸.
 *
 * **연결이 끊겨도 입력과 보내기를 막지 않는다.** 쌓아뒀다가 나중에 보낸다.
 * 막아버리면 하고 싶은 말을 잊어버린다.
 *
 * ## 도구는 접어둔다
 *
 * 콕 찌르기·이모티콘·사진·낙서를 한 줄에 다 늘어놓으면 **입력칸이
 * 손가락 두 개 폭**밖에 안 남는다. 글이 이 앱의 본업인데 글 쓸 자리가
 * 가장 좁았다. 그래서 왼쪽에 더보기 하나만 두고, 누르면 도구 줄이
 * **아래에** 펼쳐진다. 글을 쓰기 시작하면 다시 접힌다.
 *
 * 입력칸은 말풍선 최대 폭(`BUBBLE_MAX_WIDTH`)을 목표로 한다. 더보기와
 * 보내기는 누를 수 있는 최소 크기라 더 줄일 수 없고, 그 둘을 뺀
 * 나머지를 입력칸이 전부 차지한다. 보통 폰에서 그 나머지가 말풍선
 * 폭과 거의 같다. 정확히 같은 비율로 못 박으면 좁은 폰에서 오히려
 * 입력칸이 남는 자리를 못 쓴다.
 *
 * 도구 줄에 **움직임을 넣지 않는다.** `reanimated` 의 레이아웃 움직임은
 * 그려지는 자리와 눌리는 자리를 어긋나게 한다. 설명 창에서 실제로
 * 단추가 안 눌렸다.
 */
export function MessageInput({
  onSend,
  onTyping,
  onNudge,
  onDoodle,
  onStickers,
  onPhoto,
  onCamera,
  onRecordStart,
  onRecordStop,
  onRecordCancel,
  recording = false,
  offline = false,
}: MessageInputProps) {
  const theme = useTheme()
  const [text, setText] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)

  const canSend = text.trim().length > 0

  function submit(): void {
    if (!canSend) return
    onSend(text)
    setText('')
    onTyping?.(false)
  }

  /** 도구를 하나 골랐다. 줄은 접고 그 일을 한다 */
  function pick(action: (() => void) | undefined): (() => void) | undefined {
    if (action === undefined) return undefined
    return () => {
      setToolsOpen(false)
      action()
    }
  }

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        backgroundColor: theme.colors.bg,
        paddingHorizontal: theme.spacing.md,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.sm,
        gap: theme.spacing.xs,
      }}
    >
      {recording && (
        <Pressable
          onPress={onRecordCancel}
          accessibilityRole="button"
          style={{ paddingHorizontal: theme.spacing.sm }}
        >
          <Text variant="caption" color="danger">
            녹음 중… 손을 떼면 보내져요. 20초가 되면 저절로 끝나요. 여기를 누르면 버려요.
          </Text>
        </Pressable>
      )}

      {offline && (
        <Text
          variant="caption"
          color="warning"
          style={{ paddingHorizontal: theme.spacing.sm }}
        >
          지금은 끊겨 있어요. 써두면 연결될 때 보낼게요.
        </Text>
      )}

      <View
        style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}
      >
        <RoundButton
          icon={toolsOpen ? 'close' : 'plus'}
          label={toolsOpen ? '도구 접기' : '도구 더보기'}
          onPress={() => setToolsOpen(open => !open)}
        />

        <TextInput
          value={text}
          onChangeText={next => {
            setText(next)
            onTyping?.(next.length > 0)
            // 글을 쓰기 시작했다. 도구는 이제 방해다.
            if (next.length > 0) setToolsOpen(false)
          }}
          placeholder="메시지"
          placeholderTextColor={theme.colors.textFaint}
          multiline
          maxLength={MAX_TEXT_LENGTH}
          onSubmitEditing={submit}
          style={{
            // 더보기와 보내기를 뺀 나머지를 전부 쓴다. 위 설명 참고.
            flex: 1,
            ...theme.typography.body,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.xl,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.md,
            // 다섯 줄까지만 늘어난다
            maxHeight: 120,
          }}
        />

        {/*
          **쓸 글이 있으면 보내기, 없으면 마이크.**

          자리를 하나만 쓰는 이유는 좁아서다. 글을 쓰다 말고 녹음할
          일은 없으니 둘이 겹쳐도 헷갈리지 않는다.

          녹음은 **꾹 누르는 동안만** 된다. 손을 떼면 바로 나간다.
          눌러서 켜고 다시 눌러 끄는 방식은 켜둔 줄 모르고 있다가
          엉뚱한 소리가 통째로 건너간다.
        */}
        {canSend || onRecordStart === undefined ? (
          <Pressable
            onPress={submit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="보내기"
            style={{
              width: theme.minTouchSize,
              height: theme.minTouchSize,
              borderRadius: theme.minTouchSize / 2,
              backgroundColor: canSend ? theme.colors.me : theme.colors.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canSend ? 1 : 0.5,
            }}
          >
            <Icon name="send" size={20} color={canSend ? 'meText' : 'textFaint'} />
          </Pressable>
        ) : (
          <Pressable
            onPressIn={onRecordStart}
            onPressOut={onRecordStop}
            accessibilityRole="button"
            accessibilityLabel="음성 메시지"
            accessibilityHint="꾹 누르고 말한 뒤 손을 떼면 보내져요"
            style={{
              width: theme.minTouchSize,
              height: theme.minTouchSize,
              borderRadius: theme.minTouchSize / 2,
              backgroundColor: recording
                ? theme.colors.danger
                : theme.colors.surfaceRaised,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="mic" size={20} color={recording ? 'onStatus' : 'textMuted'} />
          </Pressable>
        )}
      </View>

      {toolsOpen && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-around',
            paddingTop: theme.spacing.xs,
          }}
        >
          <Tool icon="poke" label="콕 찌르기" onPress={pick(onNudge)} />
          <Tool icon="smile" label="이모티콘" onPress={pick(onStickers)} />
          <Tool
            icon="photo"
            label="사진"
            hint="길게 누르면 카메라가 열려요"
            onPress={pick(onPhoto)}
            onLongPress={pick(onCamera)}
          />
          <Tool icon="palette" label="낙서" onPress={pick(onDoodle)} />
        </View>
      )}
    </View>
  )
}

/** 입력칸 양옆의 동그란 단추 */
function RoundButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName
  label: string
  onPress: () => void
}) {
  const theme = useTheme()

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: theme.minTouchSize,
        height: theme.minTouchSize,
        borderRadius: theme.minTouchSize / 2,
        backgroundColor: theme.colors.surfaceRaised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={22} color="textMuted" />
    </Pressable>
  )
}

/**
 * 펼친 줄의 도구 하나. 그림 아래 이름을 적는다.
 *
 * 그림만으로는 헷갈린다. 느낌표가 콕 찌르기인지, 말풍선이 낙서인지
 * 실제로 못 알아봤다. 이름이 있으면 처음 보는 사람도 안다.
 */
function Tool({
  icon,
  label,
  hint,
  onPress,
  onLongPress,
}: {
  icon: IconName
  label: string
  hint?: string
  onPress?: () => void
  onLongPress?: () => void
}) {
  const theme = useTheme()
  if (onPress === undefined) return null

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint === undefined ? {} : { accessibilityHint: hint })}
      style={{
        minWidth: theme.minTouchSize,
        minHeight: theme.minTouchSize,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        paddingHorizontal: theme.spacing.sm,
      }}
    >
      <Icon name={icon} size={24} color="textMuted" />
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
    </Pressable>
  )
}
