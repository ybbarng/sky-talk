import { router } from 'expo-router'
import { Linking, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '@/presentation/components/Button'
import { Card } from '@/presentation/components/Card'
import { Text } from '@/presentation/components/Text'
import { useTheme } from '@/presentation/theme/ThemeProvider'

/**
 * 도움말.
 *
 * 물음표에 흩어져 있는 설명을 한 화면에 모은다. **반년 뒤에 다시 쓸 때
 * 여기만 보면 되게** 한다. (docs/07-design-system.md 9장)
 */
export default function Help() {
  const theme = useTheme()

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.xl,
          gap: theme.spacing.lg,
          paddingBottom: theme.spacing['3xl'],
        }}
      >
        <Text variant="title">도움말</Text>

        {topics.map(topic => (
          <Card key={topic.title} style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{topic.title}</Text>
            {topic.lines.map(line => (
              <Text key={line} variant="caption" color="textMuted">
                · {line}
              </Text>
            ))}
            {topic.opensSettings === true && (
              <View style={{ marginTop: theme.spacing.sm }}>
                <Button
                  label="설정 열기"
                  tone="neutral"
                  onPress={() => void Linking.openSettings()}
                />
              </View>
            )}
          </Card>
        ))}

        <Button label="닫기" tone="ghost" fullWidth onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  )
}

interface Topic {
  readonly title: string
  readonly lines: readonly string[]
  readonly opensSettings?: boolean
}

const topics: readonly Topic[] = [
  {
    title: '연결이 안 돼요',
    lines: [
      '두 폰 다 블루투스가 켜져 있어야 해요',
      '비행기 모드를 켜도 블루투스는 따로 켤 수 있어요',
      '두 폰이 몇 미터 안에 있어야 해요. 한 번 이어진 뒤에는 조금 멀어져도 괜찮아요',
      '잠시 기다리면 앱이 스스로 다시 찾아요',
    ],
  },
  {
    title: '음악이 꺼지거나 음질이 나빠져요',
    lines: [
      '무선 이어폰은 마이크를 켜는 순간 음질이 떨어져요',
      '이어폰과 운영체제가 정하는 일이라 앱이 어쩔 수 없어요',
      '설정에서 말하기 방식을 "말할 때만 잠깐"으로 바꿔보세요',
      '"폰에 대고 말하기"를 고르면 음악 음질이 계속 좋아요',
    ],
  },
  {
    title: '목소리가 안 들려요',
    lines: [
      '마이크 권한을 허락했는지 확인하세요',
      '이어폰이 제대로 연결됐는지 보세요',
      '블루투스로 연결된 상태면 목소리를 나를 수 없어요',
    ],
    opensSettings: true,
  },
  {
    title: '아이폰에서 앱이 안 열려요',
    lines: [
      '유료 개발자 계정 없이 설치한 앱은 7일 동안만 열려요',
      '다시 설치하면 또 7일이 생겨요',
      '앱을 지우지 말고 덮어쓰면 대화도 그대로 남아요',
      '미리 대화를 내보내 두면 안전해요',
    ],
  },
  {
    title: '메시지가 안 가요',
    lines: [
      '연결이 끊겨도 쓴 메시지는 사라지지 않아요',
      '쌓아뒀다가 다시 붙으면 자동으로 전해집니다',
      '말풍선에 "연결되면 보낼게요"가 뜨면 기다리는 중이에요',
    ],
  },
  {
    title: '상대 캐릭터가 회색이에요',
    lines: [
      '연결이 끊겼다는 뜻이에요',
      '눈을 감고 Z 가 뜨면 상대가 앱을 보고 있지 않은 거예요',
      '둘 다 잠시 기다리면 대개 스스로 다시 붙어요',
    ],
  },
]
