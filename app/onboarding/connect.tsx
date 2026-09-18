import { router } from 'expo-router'
import { Linking, Platform, View } from 'react-native'
import { homeHotspot } from '@/composition/hotspot'
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
      step={4}
      totalSteps={4}
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

      <HotspotCard role={role} />

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

/**
 * 핫스팟 이름과 비밀번호.
 *
 * **집에서 준비할 때만 쓴다.** 비행기 모드에서는 핫스팟이 안 켜진다
 * (docs/02-tech-decisions.md D1). 그래서 "이걸 켜세요" 가 아니라
 * "집에서는 이걸로 더 많은 걸 할 수 있어요" 로 적는다.
 *
 * 자리에 앉아서 이 카드를 읽고 잠긴 메뉴를 들여다보게 만들면 안 된다.
 *
 * 붙는 쪽 화면에도 그대로 뜬다. 그래야 상대 폰을 넘겨다보지 않아도
 * 혼자 들어갈 수 있다. 길게 누르면 복사된다.
 */
function HotspotCard({ role }: { role: 'host' | 'guest' }) {
  const theme = useTheme()

  // `.env` 에 안 적어뒀다. 안내를 접고 예전처럼 상대 화면을 보고 들어간다.
  if (homeHotspot === null) return null

  return (
    <Card raised style={{ gap: theme.spacing.sm }}>
      <Text variant="heading">집에서는 Wi-Fi 로 더 많이 할 수 있어요</Text>

      <Text variant="caption" color="textMuted">
        {'비행기에서는 블루투스로 글과 이모지만 오갑니다. 집에서 핫스팟을 켜두면 '}
        {'사진과 목소리까지 오가요. 비행기 모드에서는 핫스팟이 안 켜지니 '}
        {'자리에 앉으면 이건 잊으셔도 됩니다.'}
      </Text>

      <Field label="이름" value={homeHotspot.ssid} />
      <Field label="비밀번호" value={homeHotspot.password} />

      <Text variant="caption" color="textMuted">
        {role === 'host'
          ? '핫스팟 이름을 이것과 같게 맞춰두면 상대 폰이 알아서 찾습니다.'
          : '길게 누르면 복사돼요. 한 번 들어가두면 폰이 기억합니다.'}
      </Text>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  const theme = useTheme()

  return (
    <View style={{ gap: 2 }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>

      <Text
        variant="bodyStrong"
        selectable
        style={{
          color: theme.colors.me,
          backgroundColor: theme.colors.surfaceRaised,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
        }}
      >
        {value}
      </Text>
    </View>
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
