import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { narrowSeconds } from '@/application/assets/AssetChunks'
import { vibration } from '@/composition/services'
import { useTheme } from '../../theme/ThemeProvider'
import { Icon } from '../Icon'
import { Sheet } from '../Sheet'
import { Text } from '../Text'

/**
 * 음성 메시지를 녹음하는 창.
 *
 * 무전기처럼 누르고 있는 동안 녹음하는 방식은 **눌렀는지 안 눌렀는지
 * 알 수가 없었다.** 그래서 창을 띄우고 거기서 다 한다. 한 번 누르면
 * 녹음이 시작되고(짧게 떨린다), 다시 누르면 끝난다. 그다음 보낼지 버릴지
 * 고른다. 블루투스면 얼마나 걸릴지도 적는다.
 *
 * 길어야 20초다. 그 전에 저절로 끝난다.
 *
 * 창 자체는 `Sheet` 가 맡는다. 직접 `Modal` 을 만들었더니 안드로이드에서
 * 자리가 어긋나고 단추가 안 눌렸다. `Sheet` 에 그 함정들이 다 적혀 있다.
 */
interface VoiceRecordSheetProps {
  open: boolean
  recording: boolean
  /** 녹음이 끝나 보낼지 고르는 중이면 그 길이와 크기 */
  recorded: { readonly durationMs: number; readonly byteLength: number } | null
  /** 블루투스로 이어져 있나. 그러면 얼마나 걸릴지 적는다 */
  narrow: boolean
  /** 녹음이 안 됐을 때 왜 안 됐는지 */
  notice: string | null
  maxMs: number
  onStart: () => void
  onStop: () => void
  onSend: () => void
  onDiscard: () => void
  onClose: () => void
}

export function VoiceRecordSheet(props: VoiceRecordSheetProps) {
  const theme = useTheme()
  const [elapsed, setElapsed] = useState(0)

  // 녹음하는 동안 몇 초 지났는지 센다. 초 단위면 충분하다.
  useEffect(() => {
    if (!props.recording) {
      setElapsed(0)
      return
    }
    const startedAt = Date.now()
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 250)
    return () => clearInterval(timer)
  }, [props.recording])

  const seconds = Math.floor(elapsed / 1000)
  const maxSeconds = Math.round(props.maxMs / 1000)

  const title =
    props.recorded !== null
      ? '녹음했어요'
      : props.recording
        ? `녹음 중 · ${seconds}초`
        : '음성 메시지'

  return (
    <Sheet visible={props.open} onClose={props.onClose} title={title}>
      <View style={{ alignItems: 'center', gap: theme.spacing.lg }}>
        {props.recorded === null ? (
          <>
            <Pressable
              onPress={() => {
                if (props.recording) {
                  props.onStop()
                  return
                }
                // 시작했다는 것을 손끝으로 알린다. 화면만 보면 놓친다.
                void vibration.talkReady()
                props.onStart()
              }}
              accessibilityRole="button"
              accessibilityLabel={props.recording ? '녹음 끝내기' : '녹음 시작'}
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: props.recording ? theme.colors.danger : theme.colors.me,
              }}
            >
              <Icon
                name="mic"
                size={40}
                color={props.recording ? 'onStatus' : 'meText'}
              />
            </Pressable>

            <Text variant="caption" color="textMuted" align="center">
              {props.recording
                ? `다시 누르면 끝나요. ${maxSeconds}초가 되면 저절로 끝나요.`
                : `누르면 녹음이 시작돼요. 길어야 ${maxSeconds}초예요.`}
            </Text>
          </>
        ) : (
          <>
            <Text color="textMuted" align="center">
              {`${Math.max(1, Math.round(props.recorded.durationMs / 1000))}초`}
              {props.narrow
                ? ` · 블루투스라 약 ${narrowSeconds(props.recorded.byteLength)}초 걸려요`
                : ''}
            </Text>

            <View
              style={{
                flexDirection: 'row',
                gap: theme.spacing.sm,
                alignSelf: 'stretch',
              }}
            >
              <Pressable
                onPress={props.onSend}
                accessibilityRole="button"
                style={{
                  flex: 1,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.me,
                  paddingVertical: theme.spacing.md,
                  alignItems: 'center',
                }}
              >
                <Text variant="label" style={{ color: theme.colors.meText }}>
                  보내기
                </Text>
              </Pressable>
              <Pressable
                onPress={props.onDiscard}
                accessibilityRole="button"
                style={{
                  flex: 1,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  paddingVertical: theme.spacing.md,
                  alignItems: 'center',
                }}
              >
                <Text variant="label">버리기</Text>
              </Pressable>
            </View>
          </>
        )}

        {props.notice !== null && (
          <Text variant="caption" color="danger" align="center">
            {props.notice}
          </Text>
        )}
      </View>
    </Sheet>
  )
}
