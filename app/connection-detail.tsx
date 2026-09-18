import { router } from 'expo-router'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { ConnectionState } from '@/domain/connection/ConnectionState'
import { Button } from '@/presentation/components/Button'
import { Card } from '@/presentation/components/Card'
import { HelpTip } from '@/presentation/components/HelpTip'
import { Text } from '@/presentation/components/Text'
import { useChatStore } from '@/presentation/stores/useChatStore'
import { useTheme } from '@/presentation/theme/ThemeProvider'

/**
 * 연결 자세히 보기.
 *
 * 문제가 생겼을 때 **무엇이 잘못됐는지** 여기서 알 수 있어야 한다.
 * (docs/07-design-system.md 9장)
 */
export default function ConnectionDetail() {
  const theme = useTheme()
  const connection = useChatStore(s => s.connection)
  const pendingCount = useChatStore(s => s.pendingCount)

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ flex: 1, padding: theme.spacing.xl, gap: theme.spacing.lg }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
        >
          <Text variant="title">연결 상태</Text>
          <HelpTip topic="linkKind" />
        </View>

        <Card style={{ gap: theme.spacing.md }}>
          <Field label="지금 상태" value={phaseText(connection)} />
          <Field label="연결 방식" value={linkText(connection)} />
          <Field
            label="보낼 것"
            value={pendingCount === 0 ? '없음' : `${pendingCount}개 기다리는 중`}
          />
        </Card>

        {connection !== null && !connection.isUsable() && <Troubleshoot />}

        <View style={{ flex: 1 }} />

        <Button label="닫기" tone="ghost" fullWidth onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text color="textMuted">{label}</Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  )
}

/** 안 될 때 무엇을 해보면 되는지. 오류 코드를 띄우지 않는다 */
function Troubleshoot() {
  const theme = useTheme()

  const checks = [
    '두 폰 다 블루투스가 켜져 있나요?',
    '비행기 모드에서도 블루투스는 따로 켤 수 있어요',
    '두 폰이 몇 미터 안에 있나요? 벽이나 금속이 사이에 있으면 안 닿아요',
    '상대 쪽 앱도 열려 있어야 해요',
    'bitchat 같은 다른 블루투스 대화 앱은 두 폰 모두 완전히 꺼주세요. 같은 블루투스 선을 써서 우리 연결을 끊어요',
    '잠시 기다리면 앱이 스스로 다시 찾아요',
  ]

  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <Text variant="heading">연결이 안 되나요</Text>
      {checks.map(check => (
        <Text key={check} variant="caption" color="textMuted">
          · {check}
        </Text>
      ))}
    </Card>
  )
}

function phaseText(state: ConnectionState | null): string {
  if (state === null) return '준비 중'

  switch (state.phase) {
    case 'idle':
      return '꺼짐'
    case 'searching':
      return '상대를 찾는 중'
    case 'handshaking':
      return '연결하는 중'
    case 'connected':
      return '연결됨'
    case 'switching':
      return '더 좋은 길로 옮기는 중'
  }
}

function linkText(state: ConnectionState | null): string {
  if (state?.link === null || state === null) return '-'

  switch (state.link) {
    case 'wifi':
      return 'Wi-Fi'
    case 'ble':
      return '블루투스'
    case 'web':
      return '웹'
  }
}
