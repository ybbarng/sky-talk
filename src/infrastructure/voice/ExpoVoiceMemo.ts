import type { Recorded, VoicePlayer, VoiceRecorder } from '@/application/ports/VoiceMemo'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'

/**
 * 목소리를 녹음하고 듣는다.
 *
 * ## 맨 위에서 들여오지 않는다
 *
 * `expo-audio` 는 네이티브 모듈이다. 빌드가 어긋나면 들여오는 순간
 * 터진다. **음성 메시지를 못 쓰는 것은 아쉬울 뿐이고, 그것 때문에
 * 글도 못 쓰게 되면 훨씬 나쁘다.**
 *
 * ## 음악을 안 끊는다
 *
 * 녹음하는 동안에도 상대는 음악을 듣고 있을 수 있다. `mixWithOthers`
 * 로 다른 앱 소리를 끄지 않는다. (`audioPlan.ts` 와 같은 생각이다)
 *
 * ## 작게 녹음한다
 *
 * 좁은 길로도 건너가야 한다. 말소리는 높은 음질이 필요 없어서
 * 한 채널 22kHz 로 줄인다. 1분에 100KB 쯤 된다.
 *
 * (docs/05-messaging-spec.md 음성 항목)
 */

type LoadResult =
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈이라 타입을 우리가 정하지 않는다
  { readonly available: true; readonly module: any } | { readonly available: false }

let cached: LoadResult | null = null

function load(): LoadResult {
  if (cached !== null) return cached

  try {
    const loaded = require('expo-audio')
    cached =
      loaded !== null && typeof loaded.setAudioModeAsync === 'function'
        ? { available: true, module: loaded }
        : { available: false }
  } catch {
    cached = { available: false }
  }

  return cached
}

/** 말소리에 맞춘 설정. 음악이 아니라 작아도 된다 */
function recordingOptions(): Record<string, unknown> {
  return {
    extension: '.m4a',
    sampleRate: 22_050,
    numberOfChannels: 1,
    bitRate: 32_000,
    android: {
      extension: '.m4a',
      outputFormat: 'mpeg4',
      audioEncoder: 'aac',
    },
    ios: {
      extension: '.m4a',
      audioQuality: 32,
      outputFormat: 'aac ',
    },
  }
}

export class ExpoVoiceRecorder implements VoiceRecorder {
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 객체다
  private recorder: any = null
  private startedAt = 0

  isAvailable(): boolean {
    return load().available
  }

  isRecording(): boolean {
    return this.recorder !== null
  }

  async start(): Promise<Result<void, DomainError>> {
    const audio = load()
    if (!audio.available) {
      return err(domainError('not-found', '녹음할 수 없는 기기예요', 'voice'))
    }

    if (this.recorder !== null) {
      return err(domainError('invalid-transition', '이미 녹음 중이다', 'voice'))
    }

    try {
      const permitted = await audio.module.requestRecordingPermissionsAsync()
      if (permitted?.granted !== true) {
        return err(domainError('not-found', '마이크를 쓸 수 없어요', 'voice'))
      }

      // **음악을 끄지 않는다.** 상대가 듣고 있을 수 있다.
      await audio.module.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'mixWithOthers',
      })

      // **`AudioRecorder` 는 겉으로 안 내보낸다.** `expo-audio` 는 훅 안에서만
      // `AudioModule.AudioRecorder` 를 쓴다. 겉의 이름으로 부르면 생성자가 없어
      // 조용히 실패했고, 마이크를 눌러도 아무 반응이 없었다(2026-09-19).
      const Recorder = recorderClass(audio.module)
      if (Recorder === null) {
        return err(domainError('not-found', '녹음 장치를 못 찾았어요', 'voice'))
      }
      const recorder = new Recorder(recordingOptions())
      await recorder.prepareToRecordAsync(recordingOptions())
      recorder.record()

      this.recorder = recorder
      this.startedAt = Date.now()
      return ok(undefined)
    } catch (cause) {
      this.recorder = null
      const detail = cause instanceof Error ? cause.message : String(cause)
      return err(domainError('not-found', `녹음을 시작하지 못했어요: ${detail}`, 'voice'))
    }
  }

  async stop(): Promise<Result<Recorded, DomainError>> {
    const recorder = this.recorder
    this.recorder = null

    if (recorder === null) {
      return err(domainError('invalid-transition', '녹음 중이 아니다', 'voice'))
    }

    try {
      await recorder.stop()

      const uri: string | null = recorder.uri ?? null
      if (uri === null) {
        return err(domainError('not-found', '녹음한 것이 없어요', 'voice'))
      }

      const durationMs = Date.now() - this.startedAt
      const read = await readFile(uri)
      if (!read.ok) return read

      return ok({
        base64: read.value.base64,
        byteLength: read.value.byteLength,
        durationMs,
      })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      return err(domainError('not-found', `녹음을 마치지 못했어요: ${detail}`, 'voice'))
    } finally {
      // 녹음을 마쳤으니 마이크를 놓아준다. 잡고 있으면 음악이 계속 눌린다.
      await releaseMic()
    }
  }

  async cancel(): Promise<void> {
    const recorder = this.recorder
    this.recorder = null
    if (recorder === null) return

    try {
      await recorder.stop()
    } catch {
      // 이미 멎었다
    }

    await releaseMic()
  }
}

export class ExpoVoicePlayer implements VoicePlayer {
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 객체다
  private player: any = null
  private path: string | null = null
  private readonly listeners = new Set<() => void>()
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 구독이다
  private subscription: any = null

  playingPath(): string | null {
    return this.path
  }

  onFinished(handler: () => void): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  async play(path: string): Promise<Result<void, DomainError>> {
    const audio = load()
    if (!audio.available) {
      return err(domainError('not-found', '들을 수 없는 기기예요', 'voice'))
    }

    // **하나만 나온다.** 두 개가 겹치면 둘 다 못 알아듣는다.
    await this.stop()

    try {
      await audio.module.setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'mixWithOthers',
      })

      const player = audio.module.createAudioPlayer({ uri: path })

      /**
       * 다 들으면 알린다.
       *
       * `didJustFinish` 가 한 번 뜨는 것이 끝난 신호다. 이걸 놓치면
       * **다음 음성이 안 이어져서** 저절로 들려주기가 한 번에 멎는다.
       */
      this.subscription = player.addListener?.(
        'playbackStatusUpdate',
        (status: { didJustFinish?: boolean }) => {
          if (status?.didJustFinish !== true) return

          this.path = null
          for (const listener of this.listeners) listener()
        },
      )

      player.play()

      this.player = player
      this.path = path
      return ok(undefined)
    } catch (cause) {
      this.player = null
      this.path = null
      const detail = cause instanceof Error ? cause.message : String(cause)
      return err(domainError('not-found', `듣지 못했어요: ${detail}`, 'voice'))
    }
  }

  async stop(): Promise<void> {
    const player = this.player
    this.player = null
    this.path = null

    try {
      this.subscription?.remove?.()
    } catch {
      // 이미 없어졌다
    }
    this.subscription = null

    if (player === null) return

    try {
      player.pause()
      player.remove?.()
    } catch {
      // 이미 없어졌다
    }
  }
}

/** 마이크를 놓아준다. 안 놓으면 음악이 계속 눌린 채로 남는다 */
async function releaseMic(): Promise<void> {
  const audio = load()
  if (!audio.available) return

  try {
    await audio.module.setAudioModeAsync({ allowsRecording: false })
  } catch {
    // 못 놓았다. 다음 재생에서 다시 잡는다.
  }
}

async function readFile(
  uri: string,
): Promise<Result<{ base64: string; byteLength: number }, DomainError>> {
  try {
    const FileSystem = require('expo-file-system/legacy')

    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' })
    const info = await FileSystem.getInfoAsync(uri)

    return ok({
      base64,
      byteLength: typeof info?.size === 'number' ? info.size : base64.length,
    })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return err(domainError('not-found', `녹음 파일을 읽지 못했어요: ${detail}`, 'voice'))
  }
}

/** 녹음기 생성자를 찾는다. 겉에 없으면 안쪽 모듈에서 꺼낸다 */
// biome-ignore lint/suspicious/noExplicitAny: 네이티브 모듈이라 타입을 우리가 정하지 않는다
function recorderClass(loaded: any): (new (options: unknown) => any) | null {
  const direct = loaded?.AudioModule?.AudioRecorder ?? loaded?.AudioRecorder
  if (typeof direct === 'function') return direct

  try {
    const inner = require('expo-audio/build/AudioModule')
    const fromInner = inner?.default?.AudioRecorder ?? inner?.AudioRecorder
    return typeof fromInner === 'function' ? fromInner : null
  } catch {
    return null
  }
}
