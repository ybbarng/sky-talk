import { AppRegistry, Platform } from 'react-native'

/**
 * 안드로이드가 뒤로 가도 연결을 지킨다.
 *
 * ## 왜 필요한가
 *
 * 앱이 뒤로 가면 React Native 가 **JS 타이머를 통째로 끈다.**
 * 5초마다 보내던 심장박동이 멎고, 상대는 15초 뒤 "끊겼다" 고 보고
 * 소켓을 닫는다. 붙었다 끊겼다를 되풀이하게 된다.
 *
 * 헤드리스 작업이 도는 동안에는 타이머가 살아 있다. 그래서 전경
 * 서비스 안에서 아무 일도 안 하는 작업을 하나 띄워둔다.
 *
 * ## 없을 수 있다는 전제로 쓴다
 *
 * 아이폰에는 이 모듈이 아예 없다. 안드로이드에서도 빌드가 어긋나면
 * 안 들어온다. 그때는 "못 한다" 고만 답해야 하고, **여기서 앱이
 * 죽으면 안 된다.**
 *
 * (docs/04-transport-spec.md 2.7)
 */

/** 네이티브 서비스가 찾는 이름. `StayAliveService.TASK_NAME` 과 같아야 한다 */
const TASK_NAME = 'SkyTalkStayAlive'

export interface StayAliveModule {
  isSupported(): boolean
  start(): boolean
  stop(): boolean
}

type LoadResult =
  | { readonly available: true; readonly module: StayAliveModule }
  | { readonly available: false; readonly why: string }

let cached: LoadResult | null = null

/**
 * 모듈을 안전하게 들여온다.
 *
 * 맨 위에서 `import` 하면 아이폰에서 앱이 통째로 안 켜진다.
 * 이 모듈은 안드로이드에만 있기 때문이다.
 */
export function loadStayAlive(): LoadResult {
  if (cached !== null) return cached

  if (Platform.OS !== 'android') {
    cached = { available: false, why: '안드로이드에만 있다' }
    return cached
  }

  try {
    const { requireNativeModule } = require('expo-modules-core')
    const loaded = requireNativeModule('StayAlive')

    if (loaded === null || typeof loaded.start !== 'function') {
      cached = { available: false, why: '연결 지키기 모듈이 제대로 안 들어 있다' }
      return cached
    }

    cached = { available: true, module: loaded as StayAliveModule }
    return cached
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    cached = { available: false, why: `연결 지키기 모듈이 없다: ${detail}` }
    return cached
  }
}

/**
 * 헤드리스 작업을 등록한다.
 *
 * **아무 일도 안 한다.** 도는 것 자체가 목적이다. 이게 돌고 있는 동안
 * RN 이 타이머를 살려두고, 그 타이머로 심장박동과 다시 붙기가 돈다.
 *
 * 앱이 켜질 때 딱 한 번 부른다. 서비스가 켜질 때 RN 이 이 이름으로
 * 찾는다.
 */
let finish: (() => void) | null = null
let registered = false

export function registerStayAliveTask(): void {
  if (registered || Platform.OS !== 'android') return
  registered = true

  try {
    AppRegistry.registerHeadlessTask(TASK_NAME, () => async () => {
      // **끝나지 않는 약속.** `stop()` 이 풀어줄 때까지 기다린다.
      // 풀리면 RN 이 서비스를 알아서 멈춘다.
      await new Promise<void>(resolve => {
        finish = resolve
      })
      finish = null
    })
  } catch {
    // 등록에 실패했다. 연결 지키기만 못 할 뿐이다.
    registered = false
  }
}

/** 이 기기에서 연결을 지킬 수 있나 */
export function canStayAlive(): boolean {
  return loadStayAlive().available
}

/** 켠다. 못 켜면 `false` */
export function startStayAlive(): boolean {
  const loaded = loadStayAlive()
  if (!loaded.available) return false

  registerStayAliveTask()

  try {
    return loaded.module.start()
  } catch {
    return false
  }
}

/**
 * 끈다.
 *
 * **JS 작업을 먼저 풀어준다.** 서비스만 멈추면 작업은 계속 돌고 있는
 * 것으로 남아, 타이머가 영영 안 꺼진다. (`HeadlessJsTaskService.onDestroy`
 * 는 작업을 끝내주지 않는다)
 */
export function stopStayAlive(): boolean {
  finish?.()
  finish = null

  const loaded = loadStayAlive()
  if (!loaded.available) return false

  try {
    return loaded.module.stop()
  } catch {
    return false
  }
}
