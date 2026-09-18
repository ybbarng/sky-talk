import Constants from 'expo-constants'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, FlatList, KeyboardAvoidingView, Pressable, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  narrowSeconds,
  PHOTO_SIZES,
  type PhotoSize,
} from '@/application/assets/AssetChunks'
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
import { PhotoViewer } from '@/presentation/components/chat/PhotoViewer'
import { StickerPanel } from '@/presentation/components/chat/StickerPanel'
import { TypingIndicator } from '@/presentation/components/chat/TypingIndicator'
import { showsTime } from '@/presentation/components/chat/timeMarks'
import { VoiceRecordSheet } from '@/presentation/components/chat/VoiceRecordSheet'
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
import { useStickToBottom } from '@/presentation/hooks/useStickToBottom'
import { useVoiceAutoplay } from '@/presentation/hooks/useVoiceAutoplay'
import { useWebFallback } from '@/presentation/hooks/useWebFallback'
import { decidePhase } from '@/presentation/stores/connectPhase'
import { useCallStore } from '@/presentation/stores/useCallStore'
import { MAX_VOICE_MS, useChatStore } from '@/presentation/stores/useChatStore'
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
  const hasMore = useChatStore(s => s.hasMore)
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
  const pendingVoice = useChatStore(s => s.pendingVoice)
  const sendPendingVoice = useChatStore(s => s.sendPendingVoice)
  const discardPendingVoice = useChatStore(s => s.discardPendingVoice)
  const voiceNotice = useChatStore(s => s.voiceNotice)
  const clearVoiceNotice = useChatStore(s => s.clearVoiceNotice)
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
  const lastLinkedAt = useChatStore(s => s.lastLinkedAt)

  const me = useMe(profile?.peerId)
  const listRef = useRef<FlatList<ChatRow>>(null)
  // 바닥을 보고 있을 때만 새 말을 따라 내려간다. 내가 보낸 말은 늘 보인다.
  const bottom = useStickToBottom(listRef)

  const call = useCallStore()
  const preferences = useSetupStore(s => s.preferences)
  const [stickersOpen, setStickersOpen] = useState(false)
  // 사진을 어디서 고를지 들고 있다가, 크기를 고르면 연다
  const [pendingPhoto, setPendingPhoto] = useState<'library' | 'camera' | null>(null)
  // 다 받은 사진을 눌러 크게 보는 중이면 그 파일 자리
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null)
  // 녹음 창이 열려 있나
  const [recordSheetOpen, setRecordSheetOpen] = useState(false)
  const narrowLink = connection?.link === 'ble'

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
        onFlightShared: (remaining, total) => {
          const timer = startFlight(remaining, Date.now())
          void setFlight(timer?.arrivesAt ?? null, timer === null ? null : total)
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

  // **목록은 뒤집어 그린다.** 가장 새 말이 0번이고 화면 아래에 붙는다. 그래서
  // 도구 줄이나 키보드로 목록 키가 바뀌어도 보던 아래쪽이 그대로 따라오고,
  // 새 말은 바닥에 있을 때만 보인다. 위로 올려 옛 말을 읽는 중이면 안 움직인다.
  const ordered = useMemo(() => [...messages].reverse(), [messages])

  // 날짜 구분선은 **따로 한 칸**이다. 말풍선 칸 안에 같이 넣으면 뒤집힌
  // 목록에서 순서가 뒤바뀌어 말 아래에 떴다(2026-09-19). 뒤집혀 있으니
  // 더 큰 번호가 위다. 그날의 가장 옛 말 다음에 넣으면 그 말 위에 보인다.
  const rows = useMemo(() => {
    const out: ChatRow[] = []
    ordered.forEach((message, index) => {
      out.push({ kind: 'message', key: message.id, message, index })
      const older = ordered[index + 1]
      if (older === undefined || !isSameDay(older.orderedAt(), message.orderedAt())) {
        out.push({ kind: 'day', key: `day-`, at: message.orderedAt() })
      }
    })
    return out
  }, [ordered])

  const renderItem = useCallback(
    ({ item: row }: { item: ChatRow }) => {
      if (me === null) return null
      if (row.kind === 'day') return <DateDivider at={row.at} />

      const { message: item, index } = row
      // 뒤집혀 있으니 다음 칸이 더 옛날 말이다
      const previous = ordered[index + 1]
      const next = ordered[index - 1]
      const grouped = previous !== undefined && previous.author === item.author
      const showTime = showsTime(
        { author: item.author, at: item.orderedAt().getTime() },
        next === undefined
          ? undefined
          : { author: next.author, at: next.orderedAt().getTime() },
      )

      // 사진과 음성이면 어디까지 왔는지 같이 넘긴다
      const assetId =
        item.content.kind === 'photo' || item.content.kind === 'voice'
          ? item.content.assetId
          : null

      return (
        <>
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
            onOpenPhoto={path => setViewingPhoto(path)}
          />
        </>
      )
    },
    [me, ordered, assetPaths, assetProgress, playingVoice, playVoice, stopVoice],
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
        peerBattery={peerBattery}
        lastLinkedAt={lastLinkedAt}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // 안드로이드도 밀어 올린다. edge-to-edge 에서는 창이 저절로 안 줄어서
        // 키보드가 입력칸을 덮었다(2026-09-19). 목록이 뒤집혀 있어 보던 아래쪽이
        // 키보드 위로 그대로 따라 올라온다.
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={rows}
          inverted
          keyExtractor={row => row.key}
          renderItem={renderItem}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: theme.spacing.lg,
          }}
          onEndReachedThreshold={0.2}
          // 뒤집힌 목록에서는 끝이 위다. 위로 올리면 옛 말을 더 불러온다.
          onEndReached={() => {
            if (hasMore) void loadOlder()
          }}
          // 뒤집힌 목록에서는 머리가 아래, 꼬리가 위다. 더 없으면 안 보인다.
          ListFooterComponent={
            hasMore ? <LoadMore onPress={() => void loadOlder()} /> : null
          }
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
          ListHeaderComponent={peerTyping ? <TypingIndicator /> : null}
          onScroll={bottom.onScroll}
          scrollEventThrottle={bottom.scrollEventThrottle}
          onContentSizeChange={bottom.onContentSizeChange}
          // 도구 줄이나 이모티콘 서랍이 열려 목록이 짧아져도 마지막 말이 보인다
          onLayout={bottom.onLayout}
        />

        {stickersOpen && (
          <StickerPanel
            character={profile.character}
            onPick={pose => {
              bottom.pin()
              void sendSticker(pose)
              setStickersOpen(false)
            }}
            onClose={() => setStickersOpen(false)}
          />
        )}

        {pendingPhoto !== null && (
          <PhotoSizePrompt
            narrow={narrowLink}
            onPick={size => {
              const from = pendingPhoto
              setPendingPhoto(null)
              void sendPhoto(from, undefined, size)
            }}
            onCancel={() => setPendingPhoto(null)}
          />
        )}

        <MessageInput
          onSend={text => {
            bottom.pin()
            void send(text)
          }}
          onTyping={typing => sendTyping(typing)}
          onNudge={() => {
            bottom.pin()
            void sendNudgeToPeer()
          }}
          onStickers={() => setStickersOpen(open => !open)}
          // 누르면 앨범, 길게 누르면 카메라.
          // 기내식이나 창밖을 바로 찍어 보낼 때가 있다.
          // 크기를 먼저 고른다. 블루투스면 얼마나 걸릴지도 같이 보인다.
          onPhoto={() => setPendingPhoto('library')}
          onCamera={() => setPendingPhoto('camera')}
          // 마이크를 누르면 녹음 창이 열린다. 거기서 녹음하고 보낼지 고른다
          onRecord={() => setRecordSheetOpen(true)}
          onDoodle={() => router.push('/doodle')}
          offline={!connected}
        />
      </KeyboardAvoidingView>

      {/* 다 받은 사진을 누르면 화면 가득 본다. 아무 데나 누르면 닫힌다 */}
      <PhotoViewer uri={viewingPhoto} onClose={() => setViewingPhoto(null)} />

      <VoiceRecordSheet
        open={recordSheetOpen}
        recording={recording}
        recorded={pendingVoice}
        narrow={narrowLink}
        notice={voiceNotice}
        maxMs={MAX_VOICE_MS}
        onStart={() => void startRecording()}
        onStop={() => void stopRecordingAndSend()}
        onSend={() => {
          bottom.pin()
          void sendPendingVoice()
          setRecordSheetOpen(false)
        }}
        onDiscard={() => {
          discardPendingVoice()
          setRecordSheetOpen(false)
        }}
        onClose={() => {
          // 녹음 중에 닫으면 버린다. 보낼지 고르는 중이면 그것도 버린다.
          if (recording) void cancelRecording()
          discardPendingVoice()
          clearVoiceNotice()
          setRecordSheetOpen(false)
        }}
      />

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
  peerBattery,
  lastLinkedAt,
}: {
  peerCharacter: Parameters<typeof Character>[0]['id']
  typing: boolean
  connected: boolean
  name: string
  /** 상대 배터리. 0~1, 모르면 null */
  peerBattery: number | null
  /** 마지막으로 이어져 있던 시각 */
  lastLinkedAt: number | null
}) {
  const theme = useTheme()

  const expression = !connected ? 'disconnected' : typing ? 'typing' : 'idle'
  const subtitle = typing
    ? '입력 중...'
    : connected
      ? peerBattery === null
        ? ''
        : `배터리 ${Math.round(peerBattery * 100)}%`
      : lastLinkedAt === null
        ? '아직 못 이었어요'
        : `${agoWords(Date.now() - lastLinkedAt)} 전까지 이어져 있었어요`

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
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
        >
          <Text variant="bodyStrong">{name}</Text>
          {/* 이어져 있으면 초록 점, 끊겼으면 빨간 점. 띠가 사라진 뒤에도 이것은 남는다 */}
          <View
            accessibilityLabel={connected ? '이어져 있어요' : '끊겨 있어요'}
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: connected ? theme.colors.success : theme.colors.danger,
            }}
          />
        </View>
        {/*
          "연결됨" 은 옆의 점과 겹친다. 대신 쓸모 있는 것을 적는다.
          보고 있으면 입력 중, 이어져 있으면 상대 배터리, 끊겼으면 언제까지
          이어져 있었는지. 그래야 "잠깐 화장실 갔나" 를 가늠할 수 있다.
        */}
        {subtitle !== '' && (
          <Text variant="caption" color="textMuted">
            {subtitle}
          </Text>
        )}
      </View>
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
 * 사진을 얼마나 줄여 보낼지 고른다.
 *
 * 블루투스에서는 크기가 곧 시간이다. 그래서 크기마다 얼마나 걸릴지 적는다.
 * Wi-Fi 에서는 금방이라 시간은 안 적는다.
 */
function PhotoSizePrompt({
  narrow,
  onPick,
  onCancel,
}: {
  narrow: boolean
  onPick: (size: PhotoSize) => void
  onCancel: () => void
}) {
  const theme = useTheme()

  const choices: ReadonlyArray<{ size: PhotoSize; label: string; detail: string }> = [
    { size: 'small', label: '작게', detail: '화질이 떨어져요' },
    { size: 'medium', label: '중간', detail: '보통 이 정도면 돼요' },
    { size: 'original', label: '원본', detail: '그대로 보내요' },
  ]

  return (
    <View
      style={{
        marginHorizontal: theme.spacing.lg,
        marginBottom: theme.spacing.sm,
        padding: theme.spacing.md,
        gap: theme.spacing.sm,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceRaised,
      }}
    >
      <Text variant="bodyStrong">사진을 얼마나 크게 보낼까요</Text>
      {narrow && (
        <Text variant="caption" color="textMuted">
          블루투스라 천천히 가요. 큰 사진은 몇 분이 걸릴 수 있어요.
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {choices.map(choice => (
          <Pressable
            key={choice.size}
            onPress={() => onPick(choice.size)}
            accessibilityRole="button"
            style={{
              flex: 1,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.me,
              paddingVertical: theme.spacing.sm,
              alignItems: 'center',
              gap: 2,
            }}
          >
            <Text variant="label" style={{ color: theme.colors.meText }}>
              {choice.label}
            </Text>
            <Text variant="caption" style={{ color: theme.colors.meText }}>
              {narrow
                ? `약 ${roughTime(narrowSeconds(PHOTO_SIZES[choice.size].typicalBytes))}`
                : choice.detail}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        style={{
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingVertical: theme.spacing.sm,
          alignItems: 'center',
        }}
      >
        <Text variant="label">그만두기</Text>
      </Pressable>
    </View>
  )
}

/** 초를 사람이 읽는 말로. 90초는 "1분 30초" 보다 "2분" 이 낫다 */
function roughTime(seconds: number): string {
  if (seconds < 60) return `${seconds}초`
  return `${Math.ceil(seconds / 60)}분`
}

/** 목록의 한 칸. 말풍선이거나 날짜 구분선이다 */
type ChatRow =
  | {
      readonly kind: 'message'
      readonly key: string
      readonly message: Message
      readonly index: number
    }
  | { readonly kind: 'day'; readonly key: string; readonly at: Date }

/** 얼마나 지났나를 사람이 읽는 말로. "3분", "2시간" */
function agoWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  return `${hours}시간`
}
