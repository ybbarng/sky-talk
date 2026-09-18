import Constants from 'expo-constants'
import { router } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { createContainer, currentContainer } from '@/composition/container'
import { startFlight } from '@/domain/flight/FlightTimer'
import type { Message } from '@/domain/message/Message'
import type { PeerId } from '@/domain/peer/PeerId'
import { peerId } from '@/domain/peer/PeerId'
import { Character } from '@/presentation/characters/Character'
import { peerFace, peerLabel, peerName } from '@/presentation/characters/peerFace'
import { ConnectingView } from '@/presentation/components/ConnectingView'
import { ConnectionBar } from '@/presentation/components/ConnectionBar'
import { CallOverlay } from '@/presentation/components/call/CallOverlay'
import { FlightBar } from '@/presentation/components/chat/FlightBar'
import { MessageBubble } from '@/presentation/components/chat/MessageBubble'
import { MessageInput } from '@/presentation/components/chat/MessageInput'
import { StickerPanel } from '@/presentation/components/chat/StickerPanel'
import { TypingIndicator } from '@/presentation/components/chat/TypingIndicator'
import { Icon } from '@/presentation/components/Icon'
import { Text } from '@/presentation/components/Text'
import { myBatteryNote, peerBatteryNote } from '@/presentation/copy/battery'
import { useAwayReminder } from '@/presentation/hooks/useAwayReminder'
import { useBatteryWatch } from '@/presentation/hooks/useBatteryWatch'
import { useBluetoothWatch } from '@/presentation/hooks/useBluetoothWatch'
import { useKeepAwake } from '@/presentation/hooks/useKeepAwake'
import { useKeepLinkAwake } from '@/presentation/hooks/useKeepLinkAwake'
import { useLinkNotifications } from '@/presentation/hooks/useLinkNotifications'
import { useMessageNotifications } from '@/presentation/hooks/useMessageNotifications'
import { useReconnectOnForeground } from '@/presentation/hooks/useReconnectOnForeground'
import { useStayAlive } from '@/presentation/hooks/useStayAlive'
import { useVoiceAutoplay } from '@/presentation/hooks/useVoiceAutoplay'
import { useWebFallback } from '@/presentation/hooks/useWebFallback'
import { decidePhase } from '@/presentation/stores/connectPhase'
import { useCallStore } from '@/presentation/stores/useCallStore'
import { useChatStore } from '@/presentation/stores/useChatStore'
import { useSetupStore } from '@/presentation/stores/useSetupStore'
import { useTheme } from '@/presentation/theme/ThemeProvider'

const APP_VERSION = Constants.expoConfig?.version ?? '0.1.0'

/**
 * 대화 화면.
 *
 * 이 화면이 되면 **글로 대화하는 앱이 완성된다.** 목적의 절반이다.
 */
export default function Chat() {
  const theme = useTheme()
  const profile = useSetupStore(s => s.profile)
  const peer = useSetupStore(s => s.peer)

  const ready = useChatStore(s => s.ready)
  const messages = useChatStore(s => s.messages)
  const connection = useChatStore(s => s.connection)
  const peerTyping = useChatStore(s => s.peerTyping)
  const pendingCount = useChatStore(s => s.pendingCount)
  const start = useChatStore(s => s.start)
  const rememberPeer = useSetupStore(s => s.rememberPeer)
  const setFlight = useSetupStore(s => s.setFlight)
  const stop = useChatStore(s => s.stop)
  const send = useChatStore(s => s.send)
  const loadOlder = useChatStore(s => s.loadOlder)
  const markVisibleAsRead = useChatStore(s => s.markVisibleAsRead)
  const sendTyping = useChatStore(s => s.sendTyping)
  const sendNudgeToPeer = useChatStore(s => s.sendNudge)
  const sendSticker = useChatStore(s => s.sendSticker)
  const sendPhoto = useChatStore(s => s.sendPhoto)
  const recording = useChatStore(s => s.recording)
  const startRecording = useChatStore(s => s.startRecording)
  const stopRecordingAndSend = useChatStore(s => s.stopRecordingAndSend)
  const cancelRecording = useChatStore(s => s.cancelRecording)
  const playingVoice = useChatStore(s => s.playingVoice)
  const playVoice = useChatStore(s => s.playVoice)
  const stopVoice = useChatStore(s => s.stopVoice)
  const shareBattery = useChatStore(s => s.shareBattery)
  const peerBattery = useChatStore(s => s.peerBattery)
  const assetPaths = useChatStore(s => s.assetPaths)
  const assetProgress = useChatStore(s => s.assetProgress)
  const searchingTooLong = useChatStore(s => s.searchingTooLong)
  const everConnected = useChatStore(s => s.everConnected)
  const announceDisconnect = useChatStore(s => s.announceDisconnect)
  const peerFound = useChatStore(s => s.peerFound)

  const me = useMe(profile?.peerId)
  const listRef = useRef<FlatList<Message>>(null)

  const call = useCallStore()
  const preferences = useSetupStore(s => s.preferences)
  const [stickersOpen, setStickersOpen] = useState(false)

  // 이어져 있는 동안은 지켜볼 필요가 없다. 블루투스가 꺼지면 어차피 끊긴다.
  // 끊겼을 때만 보면서 **왜 끊겼는지**를 알아낸다.
  const connected = connection?.isUsable() ?? false
  const bluetooth = useBluetoothWatch(!connected)

  useEffect(() => {
    if (profile === null || me === null) return

    let cancelled = false

    void (async () => {
      const container = await createContainer({
        role: profile.role,
      })
      if (!container.ok || cancelled) return

      await start({
        me,
        transport: container.value.transport,
        repository: container.value.repository,
        assets: container.value.assets,
        picker: container.value.picker,
        resizer: container.value.resizer,
        recorder: container.value.recorder,
        voicePlayer: container.value.voicePlayer,
        profile: {
          displayName: profile.displayName,
          character: profile.character,
          appVersion: APP_VERSION,
        },
        // 상대를 알게 되면 기억해 둔다. 다음에 켤 때 이름과 캐릭터가 바로 뜬다.
        onPeerKnown: peer => {
          void rememberPeer(peer)
        },
        // 통화 봉투는 통화 쪽으로 넘긴다
        onCallSignal: payload => useCallStore.getState().handleSignal(payload),
        // 상대가 남은 시간을 정했다. **내 시계로 다시 센다.**
        onFlightShared: remaining => {
          const timer = startFlight(remaining, Date.now())
          void setFlight(timer?.arrivesAt ?? null, timer === null ? null : remaining)
        },
      })

      // 통화를 쓸 수 있게 붙여둔다. 모듈이 없으면 available 이 false 다.
      useCallStore.getState().attach({
        transport: container.value.transport,
        voice: container.value.voice,
        audio: container.value.audio,
        audioMode: preferences?.audioMode ?? 'push-to-talk-brief',
      })

      // 연결은 실패해도 화면은 뜬다. 쓴 메시지는 쌓였다가 나중에 나간다.
      void container.value.transport.connect()
    })()

    return () => {
      cancelled = true
      useCallStore.getState().detach()
      stop()
    }
  }, [profile, me, start, stop, rememberPeer, preferences?.audioMode, setFlight])

  // 앱이 앞으로 돌아오면 바로 다시 붙는다.
  // 아이폰은 앱을 닫으면 몇 초 안에 소켓이 끊긴다.
  useReconnectOnForeground(() => {
    const container = currentContainer()
    if (container === null) return

    const transport = container.transport as {
      reconnectNow?: () => Promise<unknown>
    }
    void transport.reconnectNow?.()
  })

  // 통화 중에는 화면이 꺼지지 않게 붙든다.
  //
  // 대화할 때는 안 붙든다. 세 시간 내내 화면을 켜두면 배터리가 먼저
  // 죽고, 그러면 대화 자체가 끝난다.
  useKeepAwake(call.state.isLive(), '통화 중')

  // 배터리를 지켜보고 상대에게도 알린다.
  //
  // **비행기에서 폰이 죽으면 대화가 끝난다.** 상대가 갑자기 조용해졌을
  // 때 잠든 것인지 폰이 죽은 것인지 알 수 있어야 한다.
  const battery = useBatteryWatch(ready)

  useEffect(() => {
    if (!ready || battery.level === null) return
    void shareBattery(battery.level)
  }, [ready, battery.level, shareBattery])

  // 폰을 내려놔도 상대가 말을 걸면 알려준다.
  //
  // **이게 없으면 앱을 보고 있을 때만 대화가 된다.** 세 시간 동안
  // 화면만 보고 있을 수는 없다.
  useMessageNotifications({
    enabled: ready,
    me,
    peerName: peerLabel(peer, profile?.peerNickname),
    messages,
    alertMode: preferences.alertMode,
    tapWhileWatching: preferences.tapWhileWatching,
    nudgeVibration: preferences.nudgeVibration,
  })

  // 끊긴 채로 오래 있으면 잠금 화면에 알린다.
  //
  // **주머니에 넣어두면 끊긴 줄도 모른다.** 그동안 상대는 내 말을
  // 못 받는다. 특히 블루투스가 꺼진 것은 사람이 켜야 풀리므로 더 빨리
  // 알린다. 이건 앱이 살아 있는 동안만 돈다. 잠든 뒤는 아래가 맡는다.
  useLinkNotifications({
    enabled: ready,
    role: profile?.role ?? 'host',
    connected,
    bluetoothOn: bluetooth.on,
    everConnected,
    peerName: peerName(peer, profile?.peerNickname),
  })

  // 뒤로 가도 연결을 지킨다. 안드로이드만.
  //
  // **앱이 뒤로 가면 RN 이 JS 타이머를 통째로 끈다.** 심장박동이
  // 멎어서 상대가 15초 뒤 끊겼다고 본다. 전경 서비스 안에서 헤드리스
  // 작업을 띄워두면 타이머가 살아 있다. 아이폰에는 이런 길이 없다.
  useStayAlive(ready)

  // 아이폰은 전경 서비스가 없어서 들리지 않는 소리로 붙든다.
  //
  // **배터리를 먹어서 기본은 꺼둔다.** 연결이 자꾸 끊길 때만 켠다.
  useKeepLinkAwake(ready && preferences.keepAwakeWhileAway)

  // 음성 메시지가 오면 저절로 들려준다. **이게 무전기를 만든다.**
  //
  // 켠 뒤에 온 것만 튼다. 한 번 튼 것은 다시 안 튼다.
  useVoiceAutoplay({
    enabled: ready && preferences.autoPlayVoice,
    me,
    messages,
    assetPaths,
    playingVoice,
    play: assetId => void playVoice(assetId),
  })

  // 앱이 잠든 뒤에도 알리는 유일한 길.
  //
  // **미리 걸어두고 도는 동안 계속 거둔다.** 우리가 멈추면 그때
  // 터진다. 아이폰이 앱을 잠재워도 운영체제가 대신 띄워준다.
  useAwayReminder({
    enabled: ready,
    role: profile?.role ?? 'host',
    peerName: peerName(peer, profile?.peerNickname),
  })

  // 비상용 웹 채팅.
  //
  // **핫스팟을 연 쪽만 띄운다.** 붙는 쪽에서 띄워봐야 아무도 못 들어온다.
  // 아이폰 앱이 죽어도 사파리로 들어와 대화를 이을 수 있다.
  useWebFallback({
    enabled: profile?.role === 'host' && ready,
    me,
    peerName: profile?.displayName ?? '나',
    messages,
    onSend: send,
  })

  // 아직 안 읽은 상대 메시지가 몇 건인가.
  //
  // **이 수가 바뀔 때마다 읽음으로 친다.** 예전에는 화면을 켤 때
  // 한 번만 했는데, 그러면 보고 있는 동안 새로 온 것이 읽음으로
  // 안 바뀌어 상대 쪽에 ✓✓ 가 영영 안 떴다.
  //
  // 건수를 세는 이유는 `messages` 를 그대로 보면 글자 하나 바뀐
  // 것에도 다시 돌기 때문이다. 다 읽으면 0 이 되어 저절로 멎는다.
  const unread = useUnreadCount(messages, me)
  const appActive = useAppActive()

  useEffect(() => {
    // 앱이 뒤에 있으면 읽은 게 아니다. 알림만 보고 안 열었을 수 있다.
    if (!ready || !appActive || unread === 0) return
    void markVisibleAsRead()
  }, [ready, appActive, unread, markVisibleAsRead])

  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      if (me === null) return null

      const previous = messages[index - 1]
      const next = messages[index + 1]
      const grouped = previous !== undefined && previous.author === item.author
      const showTime = next === undefined || next.author !== item.author

      // 날이 바뀌면 사이에 날짜를 넣는다. 비행기가 날짜선을 넘거나
      // 밤 비행이면 어제 말과 오늘 말이 붙어 버린다.
      const showDate =
        previous === undefined || !isSameDay(previous.orderedAt(), item.orderedAt())

      // 사진과 음성이면 어디까지 왔는지 같이 넘긴다
      const assetId =
        item.content.kind === 'photo' || item.content.kind === 'voice'
          ? item.content.assetId
          : null

      return (
        <>
          {showDate && <DateDivider at={item.orderedAt()} />}
          <MessageBubble
            message={item}
            me={me}
            grouped={grouped}
            showTime={showTime}
            assetPath={assetId === null ? null : (assetPaths[assetId] ?? null)}
            assetProgress={assetId === null ? null : (assetProgress[assetId] ?? null)}
            playingVoice={assetId !== null && playingVoice === assetId}
            onPlayVoice={id => void playVoice(id)}
            onStopVoice={() => void stopVoice()}
          />
        </>
      )
    },
    [me, messages, assetPaths, assetProgress, playingVoice, playVoice, stopVoice],
  )

  if (profile === null || me === null) {
    return <Redirecting />
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} edges={['top']}>
      <ConnectionBar
        state={connection}
        pendingCount={pendingCount}
        announceDisconnect={announceDisconnect}
        onPress={() => router.push('/connection-detail')}
      />

      <BatteryNotice
        mine={battery.level}
        charging={battery.charging}
        peer={peerBattery}
        peerName={peerLabel(peer, profile?.peerNickname)}
        role={profile.role}
        callActive={call.state.isLive()}
      />

      {/*
        가로폭이 여정 전체다. 비행기가 왼쪽에서 오른쪽으로 간다.
        정해두지 않았으면 아무것도 안 뜬다.
      */}
      {preferences.arrivesAt !== undefined && preferences.flightTotalMs !== undefined && (
        <FlightBar
          arrivesAt={preferences.arrivesAt}
          totalMs={preferences.flightTotalMs}
        />
      )}

      <PeerHeader
        peerCharacter={peerFace(peer)}
        typing={peerTyping}
        connected={connected}
        name={peerLabel(peer, profile?.peerNickname)}
        // 블루투스로는 목소리를 못 나른다. 통화 모듈이 있어도 Wi-Fi 일 때만 건다.
        canCall={call.available && connected && connection?.link === 'wifi'}
        onCall={() => void call.call('voice')}
        cannotCallBecause={cannotCallBecause(call.available, connected, connection?.link)}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
            flexGrow: 1,
            justifyContent: 'flex-end',
          }}
          onEndReachedThreshold={0.2}
          ListHeaderComponent={<LoadMore onPress={() => void loadOlder()} />}
          ListEmptyComponent={
            connected ? (
              <EmptyState />
            ) : (
              <ConnectingView
                phase={decidePhase({
                  role: profile.role,
                  connection,
                  bluetoothOn: bluetooth.on,
                  peerFound,
                  everConnected,
                })}
                role={profile.role}
                peerName={peerName(peer, profile?.peerNickname)}
                peerCharacter={peerFace(peer)}
                showHint={searchingTooLong}
              />
            )
          }
          ListFooterComponent={peerTyping ? <TypingIndicator /> : null}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        {stickersOpen && (
          <StickerPanel
            character={profile.character}
            onPick={pose => {
              void sendSticker(pose)
              setStickersOpen(false)
            }}
            onClose={() => setStickersOpen(false)}
          />
        )}

        <MessageInput
          onSend={text => void send(text)}
          onTyping={typing => sendTyping(typing)}
          onNudge={() => void sendNudgeToPeer()}
          onStickers={() => setStickersOpen(open => !open)}
          // 누르면 앨범, 길게 누르면 카메라.
          // 기내식이나 창밖을 바로 찍어 보낼 때가 있다.
          onPhoto={() => void sendPhoto('library')}
          onCamera={() => void sendPhoto('camera')}
          // 꾹 누르는 동안 녹음하고 손을 떼면 보낸다
          onRecordStart={() => void startRecording()}
          onRecordStop={() => void stopRecordingAndSend()}
          onRecordCancel={() => void cancelRecording()}
          recording={recording}
          onDoodle={() => router.push('/doodle')}
          offline={!connected}
        />
      </KeyboardAvoidingView>

      <CallOverlay
        state={call.state}
        peerName={peerLabel(peer, profile?.peerNickname)}
        peerCharacter={peerFace(peer)}
        myCharacter={profile.character}
        localUrl={call.localUrl}
        remoteUrl={call.remoteUrl}
        cameraOn={call.cameraOn}
        onToggleCamera={call.toggleCamera}
        onSwitchCamera={() => void call.switchCamera()}
        talking={call.talking}
        locked={call.locked}
        muted={call.muted}
        notice={call.notice}
        onAccept={() => void call.accept()}
        onDecline={() => void call.decline()}
        onHangUp={() => void call.hangUp()}
        onTalkStart={call.startTalking}
        onTalkEnd={call.stopTalking}
        onToggleLock={call.toggleLock}
        onToggleMute={call.toggleMute}
        onRetry={() => void call.call('voice')}
        onDismissNotice={call.dismissNotice}
        onClose={call.dismissEnded}
      />
    </SafeAreaView>
  )
}

/** 아직 안 읽은 상대 메시지 수. 다 읽으면 0 이 되어 읽음 처리가 멎는다 */
function useUnreadCount(messages: readonly Message[], me: PeerId | null): number {
  if (me === null) return 0

  let count = 0
  for (const message of messages) {
    if (!message.isMine(me) && message.delivery !== 'read') count += 1
  }
  return count
}

/** 앱이 앞에 있나. 뒤에 있는 동안 읽었다고 치면 안 된다 */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active')

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      setActive(next === 'active')
    })
    return () => subscription.remove()
  }, [])

  return active
}

/**
 * 날짜 구분선.
 *
 * 밤 비행이거나 날짜선을 넘으면 어제 말과 오늘 말이 그냥 붙어 버린다.
 * 나중에 대화를 다시 볼 때 언제 한 말인지 알 수 없다.
 */
function DateDivider({ at }: { at: Date }) {
  const theme = useTheme()

  return (
    <View style={{ alignItems: 'center', marginVertical: theme.spacing.lg }}>
      <View
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: 4,
        }}
      >
        <Text variant="caption" color="textMuted">
          {formatDay(at)}
        </Text>
      </View>
    </View>
  )
}

function formatDay(at: Date): string {
  const today = new Date()
  if (isSameDay(at, today)) return '오늘'

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(at, yesterday)) return '어제'

  const weekday = ['일', '월', '화', '수', '목', '금', '토'][at.getDay()]
  return `${at.getMonth() + 1}월 ${at.getDate()}일 ${weekday}요일`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 상대 캐릭터와 이름. 글씨를 안 읽어도 상태를 알 수 있어야 한다 */
function PeerHeader({
  peerCharacter,
  typing,
  connected,
  name,
  canCall,
  onCall,
  cannotCallBecause,
}: {
  peerCharacter: Parameters<typeof Character>[0]['id']
  typing: boolean
  connected: boolean
  name: string
  canCall: boolean
  onCall: () => void
  /** 걸 수 없을 때 왜 안 되는지. 눌렀을 때 잠깐 띄운다 */
  cannotCallBecause: string
}) {
  const theme = useTheme()
  const [explain, setExplain] = useState(false)

  // 몇 초 뒤에 저절로 접는다. 닫기 단추까지 두면 머리 부분이 시끄럽다.
  useEffect(() => {
    if (!explain) return
    const timer = setTimeout(() => setExplain(false), 5_000)
    return () => clearTimeout(timer)
  }, [explain])

  const expression = !connected ? 'disconnected' : typing ? 'typing' : 'idle'

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Character id={peerCharacter} expression={expression} size={40} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{name}</Text>
        <Text variant="caption" color="textMuted">
          {!connected ? '연결을 기다리는 중' : typing ? '입력 중...' : '연결됨'}
        </Text>
      </View>

      {/*
        통화 단추는 늘 보인다. 못 걸 때 눌리면 **왜 안 되는지** 적는다.
        숨기면 "통화가 있긴 한가" 싶고, 눌러도 조용하면 "고장났나" 싶다.

        영상 통화는 뺐다. 비행기에서는 블루투스뿐이라 목소리도 못
        나르는데 얼굴까지 있으면 과하다.
      */}
      <Pressable
        onPress={() => {
          if (canCall) onCall()
          else setExplain(true)
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="통화 걸기"
        style={{ opacity: canCall ? 1 : 0.45 }}
      >
        <Icon name="phone" size={22} />
      </Pressable>

      {explain && !canCall && (
        <View
          style={{
            position: 'absolute',
            right: theme.spacing.lg,
            top: '100%',
            maxWidth: '80%',
            backgroundColor: theme.colors.surfaceRaised,
            borderRadius: theme.radius.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            zIndex: 1,
          }}
        >
          <Text variant="caption">{cannotCallBecause}</Text>
        </View>
      )}
    </View>
  )
}

/**
 * 배터리 안내.
 *
 * **늘 띄우지 않는다.** 줄어들었을 때만 나온다. 숫자를 내내 띄워두면
 * 잔소리가 되고, 정작 급할 때 눈에 안 들어온다.
 */
function BatteryNotice({
  mine,
  charging,
  peer,
  peerName,
  role,
  callActive,
}: {
  mine: number | null
  charging: boolean
  peer: number | null
  peerName: string
  role: 'host' | 'guest'
  callActive: boolean
}) {
  const theme = useTheme()

  // 꽂혀 있으면 걱정할 것이 없다
  const myNote = charging || mine === null ? null : myBatteryNote(mine, role, callActive)
  const peerNote = peer === null ? null : peerBatteryNote(peer, peerName)
  const note = myNote ?? peerNote

  if (note === null) return null

  return (
    <View
      style={{
        backgroundColor: theme.colors.surfaceRaised,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
      }}
    >
      <Icon name="alert" size={14} color="textMuted" />
      <Text variant="caption" color="textMuted">
        {note}
      </Text>
    </View>
  )
}

function EmptyState() {
  const theme = useTheme()

  return (
    <View
      style={{
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing['3xl'],
      }}
    >
      <Text variant="heading" color="textMuted">
        아직 주고받은 말이 없어요
      </Text>
      <Text variant="caption" color="textFaint" align="center">
        연결되지 않았어도 괜찮아요.{'\n'}써두면 연결될 때 전해집니다.
      </Text>
    </View>
  )
}

function LoadMore({ onPress }: { onPress: () => void }) {
  const theme = useTheme()

  return (
    <View style={{ alignItems: 'center', paddingVertical: theme.spacing.md }}>
      <Text variant="caption" color="textFaint" onPress={onPress}>
        위로 올려 옛 메시지 보기
      </Text>
    </View>
  )
}

function Redirecting() {
  const theme = useTheme()

  useEffect(() => {
    router.replace('/onboarding/welcome')
  }, [])

  return <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />
}

/** 저장된 식별자를 도메인 값으로 바꾼다 */
function useMe(raw: string | undefined): PeerId | null {
  if (raw === undefined) return null
  const parsed = peerId(raw)
  return parsed.ok ? parsed.value : null
}

/**
 * 왜 지금 통화를 못 거나.
 *
 * 통화는 아직 준비가 덜 됐다. 그래서 어떤 이유든 "준비 중" 을 앞세우고,
 * 그 뒤에 지금 상황에서 무엇 때문인지 한 줄 덧붙인다.
 */
function cannotCallBecause(
  available: boolean,
  connected: boolean,
  link: string | null | undefined,
): string {
  if (!available) return '통화는 아직 준비 중이에요. 지금은 글로 이야기해 주세요.'
  if (!connected) return '통화는 아직 준비 중이에요. 상대와 이어진 뒤에 걸 수 있어요.'
  if (link !== 'wifi') {
    return '통화는 아직 준비 중이에요. 블루투스로는 목소리를 나를 수 없어서 집에서 Wi-Fi 로 이었을 때만 돼요.'
  }
  return '통화는 아직 준비 중이에요.'
}
