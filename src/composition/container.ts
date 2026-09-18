import { openDatabaseAsync } from 'expo-sqlite'
import type {
  AssetStore,
  ImagePicker,
  ImageResizer,
} from '@/application/ports/AssetTransfer'
import type { ConversationRepository } from '@/application/ports/ConversationRepository'
import type { MessageTransport } from '@/application/ports/MessageTransport'
import type { AudioSession, VoiceLink } from '@/application/ports/VoiceLink'
import type { VoicePlayer, VoiceRecorder } from '@/application/ports/VoiceMemo'
import type { DomainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'
import {
  ExpoAssetStore,
  ExpoImagePicker,
  ExpoImageResizer,
} from '@/infrastructure/assets/ExpoImageTools'
import { DeviceAudioSession } from '@/infrastructure/call/DeviceAudioSession'
import { WebRtcVoiceLink } from '@/infrastructure/call/WebRtcVoiceLink'
import { ExpoSqlDatabase } from '@/infrastructure/persistence/ExpoSqlDatabase'
import { migrate } from '@/infrastructure/persistence/migrations'
import { SqliteConversationRepository } from '@/infrastructure/persistence/SqliteConversationRepository'
import { BleMessageTransport } from '@/infrastructure/transport/ble/BleMessageTransport'
import { CompositeTransport } from '@/infrastructure/transport/CompositeTransport'
import type { ConnectionRole } from '@/infrastructure/transport/wifi/DiscoveryPlan'
import { WifiLink } from '@/infrastructure/transport/wifi/WifiLink'
import { ExpoVoicePlayer, ExpoVoiceRecorder } from '@/infrastructure/voice/ExpoVoiceMemo'

/**
 * 어떤 구현을 끼울지 정하는 유일한 곳.
 *
 * **이 파일만이 "지금 Wi-Fi 를 쓸지 블루투스를 쓸지"를 안다.** 나머지
 * 코드는 약속만 보고 일한다. 그래서 길을 하나 더 붙일 때 고치는 곳이
 * 여기 한 줄이다. (docs/03-architecture.md)
 */

export interface Container {
  readonly repository: ConversationRepository
  readonly transport: MessageTransport
  /**
   * 통화 길.
   *
   * **없을 수도 있다는 전제로 쓴다.** 통화 모듈이 안 들어갔거나
   * 빌드가 어긋나도 여기서 앱이 죽으면 안 된다. `isAvailable()` 이
   * false 를 답할 뿐이고 메시지는 그대로 오간다.
   */
  readonly voice: VoiceLink
  readonly audio: AudioSession
  /** 사진을 두고 꺼내는 곳. 메시지 표에는 어떤 사진인지만 담긴다 */
  readonly assets: AssetStore
  readonly picker: ImagePicker
  readonly resizer: ImageResizer
  /** 목소리를 녹음하고 듣는다. 모듈이 없으면 isAvailable 이 false 다 */
  readonly recorder: VoiceRecorder
  readonly voicePlayer: VoicePlayer
  dispose(): Promise<void>
}

let current: Container | null = null

export async function createContainer(
  options: ContainerOptions,
): Promise<Result<Container, DomainError>> {
  if (current !== null) return ok(current)

  const raw = await openDatabaseAsync('skywalkie.db').catch(() => null)
  if (raw === null) {
    return err({
      code: 'not-found',
      detail: '대화를 담을 곳을 열지 못했다',
      field: 'database',
    })
  }

  const db = new ExpoSqlDatabase(raw)

  const migrated = await migrate(db)
  if (!migrated.ok) return migrated

  const repository = new SqliteConversationRepository(db)

  // Wi-Fi 를 먼저 쓰고, 안 되면 블루투스로 간다.
  //
  // WifiLink 가 찾기와 다시 붙기를 맡는다. TcpMessageTransport 를 그대로
  // 쓰면 붙는 쪽이 상대 주소를 몰라 아무것도 못 한다.
  //
  // 블루투스는 **핫스팟을 못 쓸 때만** 쓰는 보조 길이다. 항공사가
  // 개인 핫스팟을 금지할 수 있어서 둔다. 좁아서 글만 간다.
  // 모듈이 없거나 빌드가 어긋났으면 그냥 실패할 뿐, 앱은 그대로 돈다.
  const transport = new CompositeTransport([
    new WifiLink(options.role, {
      peerAddress: options.peerAddress,
    }),
    new BleMessageTransport(options.role),
  ])

  // 만들어만 둔다. 실제 모듈은 통화를 걸 때 비로소 불러온다.
  // 여기서 불러오면 통화 모듈이 깨졌을 때 앱이 아예 안 켜진다.
  const voice = new WebRtcVoiceLink()
  const audio = new DeviceAudioSession()

  const container: Container = {
    repository,
    transport,
    voice,
    audio,
    assets: new ExpoAssetStore(),
    picker: new ExpoImagePicker(),
    resizer: new ExpoImageResizer(),
    recorder: new ExpoVoiceRecorder(),
    voicePlayer: new ExpoVoicePlayer(),
    async dispose() {
      await voice.close()
      await audio.deactivate()
      await transport.disconnect()
      await db.close()
      current = null
    },
  }

  current = container
  return ok(container)
}

export interface ContainerOptions {
  readonly role: ConnectionRole
  /** 이미 아는 주소. 시험할 때 넘긴다 */
  readonly peerAddress?: string
}

/** 이미 만들어 둔 것. 없으면 null */
export function currentContainer(): Container | null {
  return current
}
