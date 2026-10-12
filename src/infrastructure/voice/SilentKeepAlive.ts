import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'

/**
 * 아이폰이 앱을 안 재우게 붙든다.
 *
 * ## 왜 필요한가
 *
 * 아이폰은 앱이 뒤로 가면 몇십 초 안에 잠재운다. 그러면 소켓이 끊기고
 * 우리 코드가 아예 안 돈다. **안드로이드처럼 전경 서비스를 띄우는
 * 길이 아이폰에는 없다.**
 *
 * 하나 있는 길은 **소리를 내는 것**이다. `audio` 배경 모드를 가진 앱이
 * 실제로 소리를 내고 있으면 iOS 가 안 재운다. 그래서 들리지 않는
 * 소리를 계속 흘린다.
 *
 * ## 음악을 안 끊는다
 *
 * `mixWithOthers` 라 다른 앱 소리를 끄지 않는다. 게다가 볼륨이 0 이고
 * 담긴 것도 무음이라 **들릴 것이 없다.**
 *
 * ## 대가는 배터리다
 *
 * 세 시간 내내 소리 장치를 깨워둔다. 그래서 기본은 꺼둔다.
 * **폰이 죽으면 대화가 아예 끝난다.** 연결이 자꾸 끊길 때만 켠다.
 *
 * ## 파일을 저장소에 두지 않는다
 *
 * 무음 파일은 규칙이 뻔해서 **쓸 때 만든다.** 저장소에 소리 파일을
 * 넣어두면 그게 왜 있는지 나중에 알기 어렵고, 아이콘처럼 다시
 * 만들어야 할 것이 하나 더 는다.
 *
 * (docs/04-transport-spec.md 2.7)
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
      loaded !== null && typeof loaded.createAudioPlayer === 'function'
        ? { available: true, module: loaded }
        : { available: false }
  } catch {
    cached = { available: false }
  }

  return cached
}

/** 1초짜리 무음. 8kHz 한 채널이라 16KB 면 된다 */
const SAMPLE_RATE = 8000
const SECONDS = 1

/**
 * 무음 WAV 를 만든다.
 *
 * 머리말 44바이트 뒤에 0 을 늘어놓으면 그게 무음이다. 규칙이 단순해서
 * 라이브러리 없이 만들 수 있다.
 */
export function silentWavBytes(): Uint8Array {
  const samples = SAMPLE_RATE * SECONDS
  const dataBytes = samples * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)

  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) bytes[at + i] = text.charCodeAt(i)
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')

  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // 이 조각의 길이
  view.setUint16(20, 1, true) // 1 = 압축하지 않은 PCM
  view.setUint16(22, 1, true) // 한 채널
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true) // 초당 바이트
  view.setUint16(32, 2, true) // 한 묶음의 바이트
  view.setUint16(34, 16, true) // 한 값의 비트

  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  // 나머지는 0 인 채로 둔다. 그게 무음이다.
  return bytes
}

function toBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''

  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const triple = (a << 16) | (b << 8) | c

    out += chars[(triple >> 18) & 63]
    out += chars[(triple >> 12) & 63]
    out += i + 1 < bytes.length ? chars[(triple >> 6) & 63] : '='
    out += i + 2 < bytes.length ? chars[triple & 63] : '='
  }

  return out
}

export class SilentKeepAlive {
  // biome-ignore lint/suspicious/noExplicitAny: 네이티브 객체다
  private player: any = null
  private path: string | null = null

  isHolding(): boolean {
    return this.player !== null
  }

  async start(): Promise<Result<void, DomainError>> {
    if (this.player !== null) return ok(undefined)

    const audio = load()
    if (!audio.available) {
      return err(domainError('not-found', '소리를 낼 수 없는 기기예요', 'keep-alive'))
    }

    try {
      const path = await this.ensureFile()
      if (path === null) {
        return err(domainError('not-found', '무음 파일을 못 만들었어요', 'keep-alive'))
      }

      // **여기가 핵심이다.** 배경에서도 계속 내야 iOS 가 안 재운다.
      await audio.module.setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'mixWithOthers',
      })

      const player = audio.module.createAudioPlayer({ uri: path })
      player.loop = true
      player.volume = 0
      player.play()

      this.player = player
      return ok(undefined)
    } catch (cause) {
      this.player = null
      const detail = cause instanceof Error ? cause.message : String(cause)
      return err(domainError('not-found', `붙들지 못했어요: ${detail}`, 'keep-alive'))
    }
  }

  async stop(): Promise<void> {
    const player = this.player
    this.player = null
    if (player === null) return

    try {
      player.pause()
      player.remove?.()
    } catch {
      // 이미 없어졌다
    }

    const audio = load()
    if (!audio.available) return

    try {
      // 배경 재생을 놓아준다. 안 놓으면 소리 장치가 계속 깨어 있다.
      await audio.module.setAudioModeAsync({ shouldPlayInBackground: false })
    } catch {
      // 못 놓았다. 다음에 다시 해본다.
    }
  }

  /** 무음 파일을 한 번만 만들어 두고 계속 쓴다 */
  private async ensureFile(): Promise<string | null> {
    if (this.path !== null) return this.path

    try {
      const FileSystem = require('expo-file-system/legacy')
      const path = `${FileSystem.cacheDirectory}skytalk-silence.wav`

      const info = await FileSystem.getInfoAsync(path)
      if (info?.exists !== true) {
        await FileSystem.writeAsStringAsync(path, toBase64(silentWavBytes()), {
          encoding: 'base64',
        })
      }

      this.path = path
      return path
    } catch {
      return null
    }
  }
}
