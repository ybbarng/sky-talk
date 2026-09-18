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
    title: '어떻게 이어지나요',
    lines: [
      '두 폰이 블루투스로 직접 이어져요. 인터넷도 Wi-Fi 도 필요 없어요',
      '비행기 모드를 켜도 블루투스는 따로 켤 수 있어요',
      '이름 옆의 점이 초록이면 이어진 것, 빨강이면 끊긴 거예요',
      '이어져 있으면 상대 배터리가, 끊겼으면 언제까지 이어져 있었는지 보여요',
    ],
  },
  {
    title: '연결이 안 돼요',
    lines: [
      '두 폰 다 블루투스가 켜져 있어야 해요',
      '두 폰이 몇 미터 안에 있어야 해요. 한 번 이어진 뒤에는 조금 멀어져도 괜찮아요',
      '상대 쪽 앱도 열려 있어야 해요',
      'bitchat 같은 다른 블루투스 대화 앱은 두 폰 모두 완전히 꺼주세요. 같은 블루투스 선을 써서 우리 연결을 끊어요',
      '잠시 기다리면 앱이 스스로 다시 찾아요. 누를 것은 없어요',
    ],
  },
  {
    title: '메시지가 안 가요',
    lines: [
      '연결이 끊겨도 쓴 메시지는 사라지지 않아요',
      '쌓아뒀다가 다시 붙으면 자동으로 전해져요',
      '말풍선에 "연결되면 보낼게요"가 뜨면 기다리는 중이에요',
    ],
  },
  {
    title: '사진은 왜 오래 걸리나요',
    lines: [
      '블루투스는 아주 좁은 길이라 사진 한 장에 몇십 초가 걸려요',
      '보낼 때 작게·중간·원본 중에 고를 수 있어요. 작게가 30초쯤, 원본은 몇 분이에요',
      '양쪽 말풍선에 몇 퍼센트 갔는지 보여요',
      '다 받은 사진은 눌러서 크게 보고, 두 손가락으로 벌려 확대할 수 있어요',
    ],
  },
  {
    title: '음성 메시지',
    lines: [
      '입력칸이 비어 있을 때 마이크를 누르면 녹음 창이 열려요',
      '큰 단추를 누르면 녹음 시작, 다시 누르면 끝. 길어야 20초예요',
      '끝나면 보낼지 버릴지 고를 수 있어요. 블루투스라 10초 녹음에 15초쯤 걸려요',
      '받은 쪽은 말풍선의 세모를 누르면 들려요',
    ],
  },
  {
    title: '콕 찌르기와 이모티콘',
    lines: [
      '콕 찌르면 상대 폰이 짧게 떨려요. 설정 → 알림에서 끌 수 있어요',
      '이모티콘은 길게 누르면 무슨 뜻인지 옆에 떠요',
    ],
  },
  {
    title: '비행기와 남은 시간',
    lines: [
      '설정에서 출발·도착 시각을 넣으면 대화 화면 위에 비행기가 떠요',
      '한쪽이 넣으면 상대 화면에도 같이 떠요',
      '남은 시간 글을 누르면 출발한 지 얼마나 됐는지로 바뀌어요',
    ],
  },
  {
    title: '이름과 상태 메시지',
    lines: [
      '설정 → 이름에서 상대에게 보일 이름과 한마디를 정할 수 있어요',
      '바꾸면 상대 화면에 바로 반영돼요',
      '상태 메시지는 상대 화면의 내 이름 옆에 늘 떠 있어요',
    ],
  },
  {
    title: '통화는 되나요',
    lines: [
      '아직 준비 중이에요. 블루투스로는 목소리를 나를 수 없어요',
      '지금은 글·사진·음성 메시지로 이야기해 주세요',
    ],
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
    title: '대화를 꺼내고 싶어요',
    lines: [
      '설정 → 대화 꺼내기에서 파일로 저장할 수 있어요',
      '"되돌릴 수 있는 파일"은 다른 폰에서 다시 불러올 수 있어요',
      '공유 창에서 Google Drive 같은 곳에 바로 올릴 수 있어요',
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
