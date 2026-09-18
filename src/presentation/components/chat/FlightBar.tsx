import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import {
  elapsedWords,
  progress,
  remainingMs,
  remainingWords,
} from '@/domain/flight/FlightTimer'
import { useTheme } from '../../theme/ThemeProvider'
import { Icon } from '../Icon'
import { Text } from '../Text'

/**
 * 목적지까지 얼마나 왔나.
 *
 * **가로폭이 여정 전체다.** 비행기가 왼쪽 끝에서 출발해 오른쪽 끝으로
 * 간다. 숫자를 읽지 않아도 한눈에 "반쯤 왔구나" 를 안다.
 *
 * ```
 * ━━━━━━━━━✈┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 *        2시간 40분 남았어요
 * ```
 *
 * 지나온 길은 진하게, 남은 길은 흐리게 그린다.
 *
 * ## 1분마다 다시 센다
 *
 * 초를 보여주지 않으므로 더 자주 셀 이유가 없다. **세 시간 동안
 * 1초마다 다시 그리면 배터리가 준다.**
 *
 * (docs/05-messaging-spec.md · T24)
 */

interface FlightBarProps {
  /** 이 폰의 시계로 언제 도착하나 */
  arrivesAt: number
  /** 비행이 통째로 얼마나 긴가 */
  totalMs: number
}

/** 초를 안 보여주니 1분마다면 충분하다 */
const TICK_MS = 60_000

export function FlightBar({ arrivesAt, totalMs }: FlightBarProps) {
  const theme = useTheme()
  const [now, setNow] = useState(() => Date.now())
  // 글을 누르면 "출발한 지" 로 바뀐다. 다시 누르면 돌아온다.
  const [showElapsed, setShowElapsed] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const left = remainingMs({ arrivesAt }, now)
  const done = progress(left, totalMs)
  const arrived = left === 0

  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.xs,
        gap: 4,
        backgroundColor: theme.colors.bg,
      }}
      accessibilityRole="progressbar"
      accessibilityLabel={remainingWords(left)}
    >
      <View style={{ height: 22, justifyContent: 'center' }}>
        {/* 남은 길. 아직 안 간 곳이라 흐리다 */}
        <View
          style={{
            height: 2,
            borderRadius: 1,
            backgroundColor: theme.colors.border,
          }}
        />

        {/* 지나온 길 */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            height: 2,
            borderRadius: 1,
            width: `${done * 100}%`,
            backgroundColor: theme.colors.me,
          }}
        />

        {/*
          비행기.

          `marginLeft` 로 반쯤 당겨야 **그림 한가운데가 지금 자리**에
          온다. 안 그러면 끝에 다다랐을 때 오른쪽으로 삐져나간다.
        */}
        <View
          style={{
            position: 'absolute',
            left: `${done * 100}%`,
            marginLeft: -9,
            width: 18,
            height: 18,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 9,
            backgroundColor: theme.colors.bg,
          }}
        >
          {/* 그림은 위를 보고 있다. 오른쪽으로 날아가는 모양이 되게 돌린다 */}
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icon name="plane" size={16} color={arrived ? 'success' : 'me'} />
          </View>
        </View>
      </View>

      {/*
        남은 시간을 비행기 아래 적는다.

        가로 자리를 비행기에 맞추면 끝에서 글이 잘린다. 그래서 글은
        **가운데 고정**이고 비행기만 움직인다.
      */}
      <Pressable
        onPress={() => setShowElapsed(on => !on)}
        accessibilityRole="button"
        accessibilityLabel={
          showElapsed ? '남은 시간 보기' : '출발한 지 얼마나 됐는지 보기'
        }
        hitSlop={8}
      >
        <Text variant="caption" color={arrived ? 'success' : 'textMuted'} align="center">
          {showElapsed ? elapsedWords(left, totalMs) : remainingWords(left)}
        </Text>
      </Pressable>
    </View>
  )
}
