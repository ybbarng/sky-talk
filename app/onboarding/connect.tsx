import { router } from 'expo-router'
import { Linking, Platform, View } from 'react-native'
import { notifier } from '@/composition/services'
import { Button } from '@/presentation/components/Button'
import { Card } from '@/presentation/components/Card'
import { Icon } from '@/presentation/components/Icon'
import { StepLayout } from '@/presentation/components/onboarding/StepLayout'
import { Text } from '@/presentation/components/Text'
import { notificationReason } from '@/presentation/copy/notify'
import { connectIntro, connectSteps, roleReason } from '@/presentation/copy/onboarding'
import { useSetupStore } from '@/presentation/stores/useSetupStore'
import { useTheme } from '@/presentation/theme/ThemeProvider'

/**
 * **이 앱에서 가장 중요한 화면이다.**
 *
 * 말을 나눌 수 없는 두 사람이 각자 이 화면만 보고 연결에 성공해야 한다.
 * 그래서 역할마다 자기가 할 일만 보여주고, 상대에게 보여줄 코드를
 * 화면에서 가장 크게 띄운다. (docs/07-design-system.md 8장)
 */
export default function Connect() {
  const theme = useTheme()
  const profile = useSetupStore(s => s.profile)
  const finishOnboarding = useSetupStore(s => s.finishOnboarding)
  const role = profile?.role ?? 'host'
  const steps = connectSteps[role]

  return (
    <StepLayout
      step={3}
      totalSteps={3}
      title={role === 'host' ? '내가 알리는 쪽이에요' : '내가 찾는 쪽이에요'}
      description={`${roleReason[role]}.`}
      onPrimary={() => {
        void (async () => {
          // **여기서 알림 권한을 물어본다.** 대화 화면에서 갑자기
          // 물으면 무슨 일인가 싶다. 안내를 끝내는 지금이 자연스럽다.
          // 거절해도 그냥 넘어간다.
          await notifier.prepare()
          await finishOnboarding()
          router.replace('/(tabs)/chat')
        })()
      }}
      primaryLabel="시작하기"
    >
      <Card raised style={{ marginBottom: theme.spacing.xs }}>
        <Text variant="bodyStrong">{connectIntro[role]}</Text>
      </Card>

      <View style={{ gap: theme.spacing.md }}>
        {steps.map((step, index) => (
          <Card key={step.title}>
            <View
              style={{
                flexDirection: 'row',
                gap: theme.spacing.md,
                alignItems: 'flex-start',
              }}
            >
              <StepNumber value={index + 1} />

              <View style={{ flex: 1, gap: theme.spacing.xs }}>
                <Text variant="bodyStrong">{step.title}</Text>
                <Text variant="caption" color="textMuted">
                  {step.detail}
                </Text>

                {step.opensSettings === true && (
                  <View style={{ marginTop: theme.spacing.sm }}>
                    <Button
                      label="설정 열기"
                      tone="neutral"
                      icon={<Icon name="settings" size={16} />}
                      onPress={() => openSettings(role)}
                    />
                  </View>
                )}
              </View>
            </View>
          </Card>
        ))}
      </View>

      <Card>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Icon name="alert" size={18} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">알림을 켜주세요</Text>
            <Text variant="caption" color="textMuted">
              {notificationReason} 시작하기를 누르면 물어봐요.
            </Text>
          </View>
        </View>
      </Card>
    </StepLayout>
  )
}

function StepNumber({ value }: { value: number }) {
  const theme = useTheme()

  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: theme.colors.me,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="label" style={{ color: theme.colors.meText }}>
        {value}
      </Text>
    </View>
  )
}

/**
 * 설정 화면으로 데려다준다.
 *
 * 앱이 핫스팟을 대신 켜줄 수는 없다. 안드로이드 10부터 막혔다.
 * 데려다주는 데까지가 전부다. (docs/02-tech-decisions.md D10)
 *
 * **여는 쪽은 핫스팟 화면으로 바로 보낸다.** 삼성 폰은 핫스팟이
 * `연결` 아래 묻혀 있어서 Wi-Fi 목록에 떨어뜨리면 못 찾는다.
 */
function openSettings(role: 'host' | 'guest'): void {
  if (Platform.OS === 'ios') {
    void Linking.openURL('App-Prefs:root=WIFI').catch(() => {
      void Linking.openSettings()
    })
    return
  }

  // 못 여는 기기가 있어서 한 단계씩 물러난다
  const targets =
    role === 'host'
      ? ['android.settings.TETHER_SETTINGS', 'android.settings.WIRELESS_SETTINGS']
      : ['android.settings.WIFI_SETTINGS', 'android.settings.WIRELESS_SETTINGS']

  void openFirstAvailable(targets)
}

async function openFirstAvailable(intents: readonly string[]): Promise<void> {
  for (const intent of intents) {
    try {
      await Linking.sendIntent(intent)
      return
    } catch {
      // 다음 것을 해본다
    }
  }

  await Linking.openSettings()
}
