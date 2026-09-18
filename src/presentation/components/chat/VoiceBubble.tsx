import { Pressable, View } from 'react-native'
import type { VoiceContent } from '@/domain/message/MessageContent'
import { useTheme } from '../../theme/ThemeProvider'
import { Icon } from '../Icon'
import { Text } from '../Text'

/**
 * 음성 메시지 말풍선.
 *
 * **아직 안 도착했어도 무엇인지 보여준다.** 길이는 메시지에 같이
 * 실려 오므로 조각이 오기 전에도 "23초" 라고 적을 수 있다. 얼마나
 * 긴지 알면 기다릴 만하다.
 *
 * 다 왔으면 누르면 들린다. 아직이면 얼마나 왔는지 보여준다.
 */

interface VoiceBubbleProps {
  content: VoiceContent
  /** 기기에 다 와 있나. 아직이면 null */
  localPath: string | null
  /** 받는 중이면 0~1 */
  progress?: number
  playing: boolean
  onPlay(): void
  onStop(): void
}

export function VoiceBubble({
  content,
  localPath,
  progress,
  playing,
  onPlay,
  onStop,
}: VoiceBubbleProps) {
  const theme = useTheme()

  const ready = localPath !== null
  const seconds = Math.max(1, Math.round(content.durationMs / 1000))

  return (
    <Pressable
      onPress={() => {
        if (!ready) return
        if (playing) onStop()
        else onPlay()
      }}
      disabled={!ready}
      accessibilityRole="button"
      accessibilityLabel={`음성 메시지 ${seconds}초`}
      accessibilityHint={ready ? '누르면 들려요' : '아직 받는 중이에요'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minWidth: 160,
        opacity: ready ? 1 : 0.6,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
        }}
      >
        <Icon name={playing ? 'stop' : 'play'} size={18} />
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        {/*
          소리의 물결.

          진짜 소리 크기를 그리지는 않는다. 그러려면 파일을 통째로
          훑어야 하는데, **누르면 바로 들리는 것이 더 중요하다.**
          여기서는 길이에 맞춰 칸 수만 늘린다.
        */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          {barsFor(seconds).map((height, index) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: 칸은 자리로만 구분된다
              key={index}
              style={{
                width: 3,
                height,
                borderRadius: 2,
                backgroundColor: theme.colors.bg,
                opacity: playing ? 1 : 0.7,
              }}
            />
          ))}
        </View>

        <Text variant="caption">
          {ready
            ? `${seconds}초`
            : progress === undefined
              ? `${seconds}초 · 받는 중`
              : `${seconds}초 · ${Math.round(progress * 100)}%`}
        </Text>
      </View>
    </Pressable>
  )
}

/**
 * 길이에 맞춰 칸을 그린다.
 *
 * 짧은 말은 짧게, 긴 말은 길게 보인다. 높이는 정해진 무늬를 돌려
 * 쓴다. 아무 소리나 그려도 **어차피 진짜 소리가 아니라** 규칙이
 * 있는 편이 덜 어수선하다.
 */
function barsFor(seconds: number): number[] {
  const shape = [8, 14, 10, 18, 12, 20, 9, 16, 11, 15]
  const count = Math.min(24, Math.max(8, seconds + 6))

  return Array.from({ length: count }, (_, index) => shape[index % shape.length] ?? 12)
}
