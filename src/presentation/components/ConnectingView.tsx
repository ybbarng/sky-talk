import { Linking, Platform, View } from 'react-native'
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated'
import type { CharacterId } from '@/domain/peer/Character'
import { Character } from '../characters/Character'
import { type ConnectPhase, copyFor, longHintFor, type Role } from '../copy/connecting'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from './Button'
import { Card } from './Card'
import { Text } from './Text'

/**
 * 연결되기 전에 보여주는 화면.
 *
 * **이 화면을 보는 사람은 이 앱이 어떻게 돌아가는지 모른다.** 떨어져
 * 앉아 물어볼 수도 없다.
 *
 * 그래서 이렇게 만든다.
 *   · 기술 단계를 숨긴다. 진행 숫자도 안 보여준다
 *   · 캐릭터로 지금 상태를 말한다. 글을 안 읽어도 안다
 *   · 사람이 할 일은 한 번에 하나만, 큰 버튼으로
 */

interface ConnectingViewProps {
  phase: ConnectPhase
  role: Role
  /**
   * 한 번도 안 이어졌으면 `null` 이다.
   *
   * **이름도 캐릭터도 인사를 주고받아야 안다.** 모를 때 아무거나 끼워
   * 넣으면 처음 켠 사람에게 낯선 이름과 얼굴이 뜬다.
   */
  peerName: string | null
  peerCharacter: CharacterId | null
  /** 한참 못 찾았다. 그때만 도움말을 보여준다 */
  showHint: boolean
}

export function ConnectingView({
  phase,
  role,
  peerName,
  peerCharacter,
  showHint,
}: ConnectingViewProps) {
  const theme = useTheme()
  const reducedMotion = useReducedMotion()
  const copy = copyFor(phase, peerName)
  const hint = longHintFor(role, peerName)

  const found = phase === 'found' || phase === 'joining'

  return (
    <View
      style={{
        alignItems: 'center',
        gap: theme.spacing.xl,
        paddingHorizontal: theme.spacing.xl,
        paddingVertical: theme.spacing['2xl'],
      }}
    >
      {/* 캐릭터가 상태를 말한다. 찾으면 또렷해지고 커진다 */}
      <Animated.View
        key={found ? 'found' : 'searching'}
        entering={reducedMotion ? undefined : FadeIn.duration(400)}
        style={{ opacity: found ? 1 : 0.4 }}
      >
        <Character
          id={peerCharacter}
          expression={found ? 'idle' : 'sleeping'}
          size={found ? 150 : 110}
        />
      </Animated.View>

      <Animated.View
        key={phase}
        entering={reducedMotion ? undefined : FadeInDown.duration(300)}
        style={{ alignItems: 'center', gap: theme.spacing.sm }}
      >
        <Text variant="title" align="center">
          {copy.title}
        </Text>
        <Text color="textMuted" align="center">
          {copy.detail}
        </Text>
      </Animated.View>

      {copy.action !== undefined && (
        <Button label={copy.action} size="large" fullWidth onPress={openSettings} />
      )}

      {!found && copy.action === undefined && <Breathing />}

      {showHint && !found && (
        <Card style={{ alignSelf: 'stretch', gap: theme.spacing.sm }}>
          <Text variant="bodyStrong">{hint.title}</Text>
          {hint.lines.map(line => (
            <Text key={line} variant="caption" color="textMuted">
              · {line}
            </Text>
          ))}
        </Card>
      )}
    </View>
  )
}

/**
 * 뭔가 하는 중이라는 표시.
 *
 * 빙글빙글 도는 것보다 조용하다. 숨 쉬듯 천천히 밝아졌다 어두워진다.
 */
function Breathing() {
  const theme = useTheme()

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      {[0, 1, 2].map(index => (
        <View
          key={index}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.colors.textFaint,
            opacity: 0.4 + index * 0.2,
          }}
        />
      ))}
    </View>
  )
}

/**
 * 블루투스 설정으로 데려다준다.
 *
 * 앱이 블루투스를 대신 켜줄 수는 없다. 운영체제가 막아뒀다.
 * 그래서 문 앞까지만 데려다준다. (docs/02-tech-decisions.md D10)
 */
function openSettings(): void {
  if (Platform.OS === 'ios') {
    void Linking.openURL('App-Prefs:root=Bluetooth').catch(() => {
      void Linking.openSettings()
    })
    return
  }

  void Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => {
    void Linking.openSettings()
  })
}
