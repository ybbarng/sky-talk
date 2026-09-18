import type { Vibration } from '@/application/ports/Vibration'
import type { IdGenerator } from '@/domain/shared/IdGenerator'
import { loadWebRtc } from '@/infrastructure/call/webrtcModule'
import { HapticVibration } from '@/infrastructure/platform/HapticVibration'
import { LocalNotifier } from '@/infrastructure/platform/LocalNotifier'
import {
  defaultPreferences,
  type KnownPeer,
  type Preferences,
  type Profile,
  settings as settingsImpl,
} from '@/infrastructure/platform/Settings'
import {
  makePeerId as makePeerIdImpl,
  ulidGenerator,
} from '@/infrastructure/platform/UlidGenerator'
import type { LocalHttpServerHandlers } from '@/infrastructure/transport/web/LocalHttpServer'

/**
 * 화면이 쓰는 것들을 여기서 한 번 거친다.
 *
 * **화면은 구현을 직접 가져오지 않는다.** 층 검사(`pnpm check:deps`)가
 * 이걸 막는다. 조립하는 곳만이 "지금 무엇을 끼웠는지" 안다.
 *
 * 이 파일에는 **조립만 있고 판단이 없다.** 무엇을 할지 정하는 코드가
 * 여기 들어오기 시작하면 층 구분이 의미를 잃는다.
 * (docs/03-architecture.md)
 */

export const ids: IdGenerator = ulidGenerator

/**
 * 폰을 내려놔도 상대가 말을 걸면 알려준다.
 *
 * 하나만 두고 계속 쓴다. 매번 새로 만들면 권한을 다시 물어본다.
 */
export const notifier = new LocalNotifier()

/**
 * 폰을 떨게 한다.
 *
 * 콕 찌르기, 마이크가 열렸을 때, 그리고 **앱을 보고 있는 동안 새 말이
 * 왔을 때** 쓴다. 보고 있으면 잠금 화면 알림은 안 띄우는데, 다른
 * 곳을 보고 있었을 수 있어서 손끝으로는 알린다.
 */
export const vibration: Vibration = new HapticVibration()

export const makePeerId = makePeerIdImpl

export const settings = settingsImpl

/** 블루투스가 켜져 있나. 꺼진 것은 사람이 켜야 풀리므로 화면이 알려준다 */
export { readBluetooth } from '@/infrastructure/transport/ble/bluetoothState'
/** 이만큼 지나도 상대를 못 찾으면 코드 입력을 권한다 */
export { OFFER_MANUAL_AFTER_MS } from '@/infrastructure/transport/wifi/DiscoveryPlan'

/**
 * 영상을 그리는 것.
 *
 * 통화 모듈이 주는 것이라 **없을 수 있다.** 없으면 화면이 캐릭터를
 * 대신 띄운다. 검은 네모보다 낫고, 무엇보다 앱이 죽지 않는다.
 */
export function videoView(): unknown {
  const loaded = loadWebRtc()
  return loaded.available ? loaded.module.RTCView : undefined
}

export type { KnownPeer, Preferences, Profile }
export { defaultPreferences }

/**
 * 비상용 웹 채팅을 띄운다.
 *
 * **아이폰 앱이 만료돼도 대화할 수 있는 마지막 길이다.** 못 띄워도
 * `null` 을 돌려줄 뿐 앱은 그대로 돈다. 덤이기 때문이다.
 */
export interface WebChatHandle {
  stop(): Promise<void>
  /** 새 말이 생겼다. 기다리는 사파리를 깨운다 */
  notify(): void
}

export async function startWebChat(
  handlers: LocalHttpServerHandlers,
): Promise<WebChatHandle | null> {
  /**
   * 쓸 때 들여온다.
   *
   * `LocalHttpServer` 는 `react-native-tcp-socket` 을 맨 위에서 들여온다.
   * 이 파일은 거의 모든 화면이 들고 있어서, 여기서 같이 들여오면
   * **소켓 모듈이 어긋났을 때 앱이 통째로 안 켜진다.** 웹 채팅은
   * 덤이라 그것 때문에 글도 못 쓰게 되면 안 된다.
   */
  try {
    // 상대 경로로 적는다. `@/` 별칭이 `require()` 에서도 풀리는지는
    // 묶는 도구에 달렸는데, 여기서 못 풀면 웹 채팅이 통째로 죽는다.
    const { LocalHttpServer } = require('../infrastructure/transport/web/LocalHttpServer')
    const server = new LocalHttpServer(handlers)

    const started = await server.start()
    if (!started.ok) return null

    return {
      stop: () => server.stop(),
      notify: () => server.notify(),
    }
  } catch {
    // 못 띄웠다. 앱으로 대화하는 것은 그대로 된다.
    return null
  }
}

/**
 * 뒤로 가도 연결을 지킨다. 안드로이드만.
 *
 * **앱이 뒤로 가면 RN 이 JS 타이머를 통째로 끈다.** 심장박동이 멎고
 * 상대가 15초 뒤 끊겼다고 본다. 전경 서비스 안에서 헤드리스 작업을
 * 하나 띄워두면 타이머가 살아 있다.
 *
 * 없으면 아무 일도 안 한다. 아이폰에는 이 모듈이 아예 없다.
 * (modules/stay-alive · docs/04-transport-spec.md 2.7)
 */
export const stayAlive = {
  available(): boolean {
    try {
      const module = require('../../modules/stay-alive/src/index')
      return module.canStayAlive() === true
    } catch {
      return false
    }
  },

  start(): boolean {
    try {
      const module = require('../../modules/stay-alive/src/index')
      return module.startStayAlive() === true
    } catch {
      return false
    }
  },

  stop(): void {
    try {
      const module = require('../../modules/stay-alive/src/index')
      module.stopStayAlive()
    } catch {
      // 못 껐다. 서비스가 남아도 알림 하나가 더 떠 있을 뿐이다.
    }
  },
}

/**
 * 아이폰이 앱을 안 재우게 붙든다.
 *
 * **들리지 않는 소리를 계속 흘린다.** `audio` 배경 모드를 가진 앱이
 * 소리를 내고 있으면 iOS 가 안 재운다. 아이폰에는 이 길밖에 없다.
 *
 * 하나만 두고 계속 쓴다. 두 개가 각자 붙들면 하나를 놓아도 소리가
 * 계속 난다. (src/infrastructure/voice/SilentKeepAlive.ts)
 */
export const keepLinkAwake = {
  async start(): Promise<boolean> {
    try {
      const { SilentKeepAlive } = require('../infrastructure/voice/SilentKeepAlive')
      holder ??= new SilentKeepAlive()

      const started = await holder.start()
      return started.ok
    } catch {
      return false
    }
  },

  async stop(): Promise<void> {
    try {
      await holder?.stop()
    } catch {
      // 못 놓았다. 다음에 다시 해본다.
    }
  },
}

// biome-ignore lint/suspicious/noExplicitAny: 쓸 때 들여오므로 타입을 여기서 못 쓴다
let holder: any = null

/**
 * 지금 배터리가 얼마나 남았나.
 *
 * **비행기에서 폰이 죽으면 대화가 끝난다.** 미리 알면 보조 배터리를
 * 꽂거나 통화를 접을 수 있다.
 *
 * 못 읽으면 `null` 이다. 배터리를 못 읽는다고 앱이 멈출 이유가 없다.
 */
export async function readBattery(): Promise<{
  level: number
  charging: boolean
} | null> {
  try {
    const battery = require('expo-battery')

    const level = await battery.getBatteryLevelAsync()
    const state = await battery.getBatteryStateAsync()

    if (typeof level !== 'number' || level < 0) return null

    return {
      level,
      // 1 은 충전 중, 2 는 다 참
      charging: state === 1 || state === 2,
    }
  } catch {
    return null
  }
}

/**
 * 화면이 꺼지지 않게 붙든다.
 *
 * 통화 중에만 쓴다. 화면이 꺼지면 아이폰이 앱을 재우려 하고, 그러면
 * 목소리가 끊긴다. 못 붙들어도 통화는 되므로 조용히 넘어간다.
 */
export const keepAwake = {
  async hold(why: string): Promise<void> {
    try {
      const module = require('expo-keep-awake')
      await module.activateKeepAwakeAsync(why)
    } catch {
      // 못 붙들었다. 화면이 꺼지면 통화가 끊길 수 있지만 앱은 그대로다.
    }
  },

  async release(why: string): Promise<void> {
    try {
      const module = require('expo-keep-awake')
      await module.deactivateKeepAwake(why)
    } catch {
      // 이미 풀렸다
    }
  },
}
