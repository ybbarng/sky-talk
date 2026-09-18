import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { type CharacterId, selectableCharacters } from '@/domain/peer/Character'
import { Character } from '@/presentation/characters/Character'
import { Card } from '@/presentation/components/Card'
import { StepLayout } from '@/presentation/components/onboarding/StepLayout'
import { Text } from '@/presentation/components/Text'
import { useSetupStore } from '@/presentation/stores/useSetupStore'
import { useTheme } from '@/presentation/theme/ThemeProvider'

/**
 * 캐릭터와 이름 정하기.
 *
 * **고른 것이 곧바로 화면에 보여야 한다.** 저장소에 다녀오는 동안
 * 아무 반응이 없으면 눌리지 않은 줄 안다. 그래서 화면이 직접 값을 들고,
 * 저장은 다음으로 넘어갈 때 한 번만 한다.
 */
export default function ChooseCharacter() {
  const theme = useTheme()
  const profile = useSetupStore(s => s.profile)
  const ensureProfile = useSetupStore(s => s.ensureProfile)
  const chooseCharacter = useSetupStore(s => s.chooseCharacter)
  const setDisplayName = useSetupStore(s => s.setDisplayName)
  const setPeerNickname = useSetupStore(s => s.setPeerNickname)

  const [character, setCharacter] = useState<CharacterId>('aria')
  const [name, setName] = useState('')
  const [calling, setCalling] = useState('')

  useEffect(() => {
    void ensureProfile()
  }, [ensureProfile])

  // 전에 정해둔 게 있으면 그걸 보여준다
  useEffect(() => {
    if (profile === null) return
    setCharacter(profile.character)
    if (profile.displayName.length > 0) setName(profile.displayName)
    if (profile.peerNickname !== undefined) setCalling(profile.peerNickname)
  }, [profile])

  const trimmed = name.trim()
  const ready = trimmed.length > 0

  return (
    <StepLayout
      step={2}
      totalSteps={3}
      title="우리 둘을 정해요"
      description="내 모습과 이름, 그리고 상대를 뭐라고 부를지 정해요."
      primaryDisabled={!ready}
      onPrimary={() => {
        /*
          **넘어가는 것이 먼저다.**

          예전에는 저장을 다 마친 뒤에 넘어갔다. 그런데 저장이 답을 안
          하면 거기서 멎어버려서 **안내를 통째로 못 넘어갔다.** 오류도
          안 뜨고 버튼만 안 먹는 것처럼 보인다. 앱을 깔고도 대화를
          시작조차 못 한 것이 이것 때문이었다.

          정한 값은 화면이 이미 들고 있다. 저장은 뒤따라가면 된다.
          설정 한 줄을 못 남기는 것이 앱을 못 쓰는 것보다 훨씬 낫다.

          메시지는 여기 해당하지 않는다. 그쪽은 잃으면 안 되므로
          저장을 먼저 한다(CLAUDE.md).
        */
        router.push('/onboarding/connect')

        void (async () => {
          await chooseCharacter(character)
          await setDisplayName(trimmed)
          await setPeerNickname(calling)
        })()
      }}
    >
      <View style={{ alignItems: 'center', paddingVertical: theme.spacing.md }}>
        <Character id={character} expression="idle" size={150} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {selectableCharacters().map(id => {
          const active = character === id

          return (
            <Pressable
              key={id}
              onPress={() => setCharacter(id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              hitSlop={4}
              style={{
                borderRadius: theme.radius.lg,
                borderWidth: active ? 2 : 1,
                borderColor: active ? theme.colors.me : theme.colors.border,
                backgroundColor: active
                  ? theme.colors.surfaceRaised
                  : theme.colors.surface,
                padding: theme.spacing.sm,
              }}
            >
              <Character id={id} expression="idle" size={64} />
            </Pressable>
          )
        })}
      </View>

      <Card>
        <Text variant="heading" style={{ marginBottom: theme.spacing.xs }}>
          상대에게 보일 내 이름
        </Text>
        <Text
          variant="caption"
          color="textMuted"
          style={{ marginBottom: theme.spacing.sm }}
        >
          이것만 적으면 넘어갈 수 있어요.
        </Text>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="예: 지민"
          placeholderTextColor={theme.colors.textFaint}
          maxLength={20}
          autoCorrect={false}
          // 키보드에 완료를 띄운다. 이게 없으면 키보드를 내릴 길이 없다
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          style={{
            ...theme.typography.body,
            color: theme.colors.text,
            backgroundColor: theme.colors.bg,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: ready ? theme.colors.border : theme.colors.me,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
          }}
        />

        {!ready && (
          <Text
            variant="caption"
            color="textMuted"
            style={{ marginTop: theme.spacing.sm }}
          >
            상대 화면에 이 이름이 떠요. 한 글자라도 적어주세요.
          </Text>
        )}
      </Card>

      {/*
        **상대가 고른 이름은 이어져야 알 수 있다.**

        그런데 이어지기 전 화면이 첫 실행에서 반드시 뜬다. 그때
        "상대가 들어오기를 기다려요" 라고 하면 누구를 기다리는지
        모르는 것처럼 들린다. 사실은 안다. 옆자리에 앉은 사람이다.
      */}
      <Card>
        <Text variant="heading" style={{ marginBottom: theme.spacing.xs }}>
          상대를 뭐라고 부를까요 · 안 적어도 돼요
        </Text>
        <Text
          variant="caption"
          color="textMuted"
          style={{ marginBottom: theme.spacing.sm }}
        >
          이어지기 전까지만 쓰는 말이에요. 이어지면 상대가 정한 이름으로 바뀌고,
          상대에게는 안 보입니다.
        </Text>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.sm,
          }}
        >
          {['여자친구', '남자친구', '짝꿍'].map(word => {
            const active = calling === word

            return (
              <Pressable
                key={word}
                onPress={() => setCalling(active ? '' : word)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={{
                  borderRadius: theme.radius.lg,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? theme.colors.me : theme.colors.border,
                  backgroundColor: active
                    ? theme.colors.surfaceRaised
                    : theme.colors.surface,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                }}
              >
                <Text variant={active ? 'bodyStrong' : 'body'}>{word}</Text>
              </Pressable>
            )
          })}
        </View>

        <TextInput
          value={calling}
          onChangeText={setCalling}
          placeholder="직접 적어도 돼요"
          placeholderTextColor={theme.colors.textFaint}
          maxLength={20}
          autoCorrect={false}
          // 키보드에 완료를 띄운다. 이게 없으면 키보드를 내릴 길이 없다
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          style={{
            ...theme.typography.body,
            color: theme.colors.text,
            backgroundColor: theme.colors.bg,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.md,
          }}
        />

        <Text variant="caption" color="textMuted" style={{ marginTop: theme.spacing.sm }}>
          비워둬도 돼요. 그때는 그냥 "상대"라고 적습니다.
        </Text>
      </Card>
    </StepLayout>
  )
}
