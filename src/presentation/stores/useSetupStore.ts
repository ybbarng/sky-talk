import { Platform } from 'react-native'
import { create } from 'zustand'
import {
  defaultPreferences,
  type KnownPeer,
  makePeerId,
  type Preferences,
  type Profile,
  settings,
} from '@/composition/services'
import type { CharacterId } from '@/domain/peer/Character'

/**
 * 첫 실행에서 정한 것들.
 *
 * 화면 여러 곳에서 같이 보는 값이라 한곳에 모은다.
 * 바뀔 때마다 기기에 저장해서 앱을 껐다 켜도 남는다.
 */

interface SetupState {
  /** 기기에서 되살리는 중인가 */
  loading: boolean
  profile: Profile | null
  peer: KnownPeer | null
  preferences: Preferences

  load(): Promise<void>
  /**
   * 프로필이 없으면 만든다.
   *
   * **역할은 기기가 정한다.** 아이폰은 앱에서 핫스팟을 켤 수 없으니
   * 안드로이드가 여는 쪽, 아이폰이 붙는 쪽이다. 고르게 하면 헷갈림만 는다.
   */
  ensureProfile(): Promise<void>
  chooseCharacter(character: CharacterId): Promise<void>
  setDisplayName(displayName: string): Promise<void>
  /** 상대를 뭐라고 부를지. 비우면 "상대" 로 쓴다 */
  setPeerNickname(nickname: string): Promise<void>
  chooseAudioMode(audioMode: Preferences['audioMode']): Promise<void>
  /** 새 말이 왔을 때 소리로 알릴까 진동으로 알릴까 */
  chooseAlertMode(alertMode: Preferences['alertMode']): Promise<void>
  /** 앱을 보고 있을 때도 짧게 떨까 */
  setTapWhileWatching(on: boolean): Promise<void>
  /** 상대가 콕 찌르면 떨까 */
  setNudgeVibration(on: boolean): Promise<void>
  /** 보고 있을 때 음성 메시지를 저절로 틀까 */
  setAutoPlayVoice(on: boolean): Promise<void>
  /** 뒤로 가도 연결을 붙들까. 아이폰에만 쓰인다 */
  setKeepAwakeWhileAway(on: boolean): Promise<void>
  /** 도착 시각과 전체 길이를 적어둔다. 비우면 화면에서 치운다 */
  setFlight(at: number | null, totalMs: number | null): Promise<void>
  finishOnboarding(): Promise<void>
  restartOnboarding(): Promise<void>
  rememberPeer(peer: KnownPeer): Promise<void>
}

export const useSetupStore = create<SetupState>((set, get) => ({
  loading: true,
  profile: null,
  peer: null,
  preferences: defaultPreferences,

  async load() {
    const [profile, peer, preferences] = await Promise.all([
      settings.readProfile(),
      settings.readPeer(),
      settings.readPreferences(),
    ])

    set({
      loading: false,
      profile: profile.ok ? profile.value : null,
      peer: peer.ok ? peer.value : null,
      preferences: preferences.ok ? preferences.value : defaultPreferences,
    })
  },

  async ensureProfile() {
    if (get().profile !== null) return

    // 식별자는 한 번만 만들어 계속 쓴다.
    // 바뀌면 상대가 우리를 못 알아본다.
    const role: Profile['role'] = Platform.OS === 'ios' ? 'guest' : 'host'

    await persistProfile(set, {
      peerId: makePeerId(),
      // 이름은 첫 실행 안내에서 직접 적는다
      displayName: '',
      character: role === 'host' ? 'orion' : 'aria',
      role,
    })
  },

  async chooseCharacter(character) {
    // 프로필이 아직 없을 수 있다. 화면이 뜨자마자 누르면 그렇다.
    await get().ensureProfile()

    const current = get().profile
    if (current === null) return
    await persistProfile(set, { ...current, character })
  },

  async setDisplayName(displayName) {
    await get().ensureProfile()

    const current = get().profile
    if (current === null) return
    await persistProfile(set, {
      ...current,
      displayName: displayName.trim().slice(0, 20),
    })
  },

  async setPeerNickname(nickname) {
    await get().ensureProfile()

    const current = get().profile
    if (current === null) return

    const trimmed = nickname.trim().slice(0, 20)
    await persistProfile(set, {
      ...current,
      // 비웠으면 아예 지운다. 빈 글자를 들고 있으면 판단이 늘어난다.
      ...(trimmed.length > 0 ? { peerNickname: trimmed } : { peerNickname: undefined }),
    })
  },

  async chooseAudioMode(audioMode) {
    await persistPreferences(set, { ...get().preferences, audioMode })
  },

  async chooseAlertMode(alertMode) {
    await persistPreferences(set, { ...get().preferences, alertMode })
  },

  async setTapWhileWatching(on) {
    await persistPreferences(set, { ...get().preferences, tapWhileWatching: on })
  },

  async setNudgeVibration(on) {
    await persistPreferences(set, { ...get().preferences, nudgeVibration: on })
  },

  async setAutoPlayVoice(on) {
    await persistPreferences(set, { ...get().preferences, autoPlayVoice: on })
  },

  async setKeepAwakeWhileAway(on) {
    await persistPreferences(set, { ...get().preferences, keepAwakeWhileAway: on })
  },

  async setFlight(at, totalMs) {
    await persistPreferences(set, {
      ...get().preferences,
      ...(at === null ? { arrivesAt: undefined } : { arrivesAt: at }),
      ...(totalMs === null ? { flightTotalMs: undefined } : { flightTotalMs: totalMs }),
    })
  },

  async finishOnboarding() {
    await persistPreferences(set, {
      ...get().preferences,
      onboardingDone: true,
      installedAt: get().preferences.installedAt ?? Date.now(),
    })
  },

  async restartOnboarding() {
    await persistPreferences(set, { ...get().preferences, onboardingDone: false })
  },

  async rememberPeer(peer) {
    await settings.writePeer(peer)
    set({ peer })
  },
}))

type Setter = (partial: Partial<SetupState>) => void

async function persistProfile(set: Setter, profile: Profile): Promise<void> {
  await settings.writeProfile(profile)
  set({ profile })
}

async function persistPreferences(set: Setter, preferences: Preferences): Promise<void> {
  await settings.writePreferences(preferences)
  set({ preferences })
}
