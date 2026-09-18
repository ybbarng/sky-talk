import { router } from 'expo-router'
import { useEffect } from 'react'
import { View } from 'react-native'
import { Character } from '@/presentation/characters/Character'
import { StepLayout } from '@/presentation/components/onboarding/StepLayout'
import { Text } from '@/presentation/components/Text'
import { welcome } from '@/presentation/copy/onboarding'
import { useSetupStore } from '@/presentation/stores/useSetupStore'
import { useTheme } from '@/presentation/theme/ThemeProvider'

export default function Welcome() {
  const theme = useTheme()
  const ensureProfile = useSetupStore(s => s.ensureProfile)

  // 역할은 기기가 정한다. 안드로이드가 열고 아이폰이 붙는다.
  useEffect(() => {
    void ensureProfile()
  }, [ensureProfile])

  return (
    <StepLayout
      step={1}
      totalSteps={3}
      title={welcome.title}
      primaryLabel="시작하기"
      onPrimary={() => router.push('/onboarding/character')}
    >
      <View style={{ alignItems: 'center', paddingVertical: theme.spacing.lg }}>
        <Character id="aria" expression="idle" size={180} />
      </View>

      <View style={{ gap: theme.spacing.xs }}>
        {welcome.lines.map(line => (
          <Text key={line} variant="bodyStrong">
            {line}
          </Text>
        ))}
      </View>

      <Text color="textMuted">{welcome.note}</Text>
    </StepLayout>
  )
}
