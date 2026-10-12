import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated'
import type { ConnectionState } from '@/domain/connection/ConnectionState'
import { useTheme } from '../theme/ThemeProvider'
import type { ColorTokens } from '../theme/tokens'
import { Icon } from './Icon'
import { Text } from './Text'

interface ConnectionBarProps {
  state: ConnectionState | null
  pendingCount?: number
  /**
   * 끊김을 알릴 때가 됐나.
   *
   * 짧은 끊김은 알리지 않는다. 비행기에서는 신호가 자주 흔들리는데
   * 그때마다 빨간 띠가 뜨면 사람이 불안해진다. 그동안은 조용히
   * 다시 붙으려 애쓴다.
   */
  announceDisconnect?: boolean
  onPress?: () => void
}

/**
 * 화면 맨 위 가는 띠.
 *
 * 어느 탭에 있든 보인다. 색이 바뀔 때 서서히 변한다 — 깜빡이면
 * 눈이 그리로 자꾸 간다. (docs/07-design-system.md 9장)
 *
 * **이어져 있으면 잠시 뒤 사라진다.** 잘 되고 있는 것을 세 시간 내내
 * 띄워둘 이유가 없다. 상대 이름 옆의 점이 그 일을 맡는다. 끊기면 다시
 * 내려와서 무슨 일인지 말한다.
 */
const HIDE_AFTER_MS = 3_000

export function ConnectionBar({
  state,
  pendingCount = 0,
  announceDisconnect = true,
  onPress,
}: ConnectionBarProps) {
  const theme = useTheme()
  const look = describe(state, pendingCount, announceDisconnect)
  const usable = state?.isUsable() === true
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    if (!usable) {
      setHidden(false)
      return
    }
    const timer = setTimeout(() => setHidden(true), HIDE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [usable])

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(theme.colors[look.color], {
      duration: theme.duration.status,
    }),
  }))

  if (hidden) return null

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={look.text}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.sm,
            paddingVertical: 6,
            paddingHorizontal: theme.spacing.md,
          },
          animatedStyle,
        ]}
      >
        <Icon name={look.icon} size={13} color="onStatus" />
        <Text variant="label" style={{ color: theme.colors.onStatus }}>
          {look.text}
        </Text>
        {look.showSpinner && <PulsingDot />}
      </Animated.View>
    </Pressable>
  )
}

interface BarLook {
  readonly color: keyof ColorTokens
  readonly icon: 'wifi' | 'bluetooth' | 'refresh' | 'alert'
  readonly text: string
  readonly showSpinner: boolean
}

function describe(
  state: ConnectionState | null,
  pendingCount: number,
  announceDisconnect: boolean,
): BarLook {
  if (state === null) {
    return { color: 'textMuted', icon: 'refresh', text: '준비 중...', showSpinner: true }
  }

  const waiting = pendingCount > 0 ? ` · 쓴 말 ${pendingCount}개 보관 중` : ''

  // 끊겼지만 아직 알릴 때가 아니다. 조용히 다시 붙는 중이라고만 말한다.
  if (!state.isUsable() && !announceDisconnect) {
    return {
      color: 'textMuted',
      icon: 'refresh',
      text: `다시 잇는 중...${waiting}`,
      showSpinner: true,
    }
  }

  switch (state.phase) {
    case 'connected':
      // 블루투스도 제대로 이어진 것이다. "글만" 같은 단서를 달면 늘 반쪽짜리로
      // 보인다. 어느 길인지만 적는다. 기내 Wi-Fi 로 옮겨 탔을 때 사진이 왜
      // 빨라졌는지 알 수 있다.
      return {
        color: 'success',
        icon: state.link === 'ble' ? 'bluetooth' : 'wifi',
        text:
          state.link === 'ble' ? '블루투스로 이어져 있어요' : 'Wi-Fi 로 이어져 있어요',
        showSpinner: false,
      }

    case 'switching':
      return {
        color: 'warning',
        icon: 'refresh',
        text: '더 나은 길로 옮기는 중...',
        showSpinner: true,
      }

    case 'searching':
      return {
        color: 'textMuted',
        icon: 'refresh',
        text: `찾는 중...${waiting}`,
        showSpinner: true,
      }

    case 'handshaking':
      return {
        color: 'textMuted',
        icon: 'refresh',
        text: '이어지는 중...',
        showSpinner: true,
      }

    case 'idle':
      return {
        color: 'danger',
        icon: 'alert',
        text: `아직 못 이었어요${waiting}`,
        showSpinner: false,
      }
  }
}

/** 뭔가 진행 중이라는 표시. 빙글빙글 도는 것보다 조용하다 */
function PulsingDot() {
  const theme = useTheme()

  return (
    <View
      style={{
        width: 5,
        height: 5,
        borderRadius: 2.5,
        backgroundColor: theme.colors.onStatus,
        opacity: 0.7,
      }}
    />
  )
}
