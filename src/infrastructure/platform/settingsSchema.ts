import { z } from 'zod'
import { characterIds } from '@/domain/peer/Character'

/**
 * 기기에 남겨두는 설정의 형식.
 *
 * **저장소를 건드리지 않는 순수한 부분이다.** 실제로 읽고 쓰는 일만
 * `Settings.ts` 에 맡기고 형식은 여기서 시험한다.
 *
 * ## 여기를 고칠 때 지킬 것
 *
 * 새 값을 더할 때는 **반드시 `optional` 이나 `default` 로 둔다.**
 * 필수로 두면 예전에 저장해둔 설정이 형식에 안 맞아 통째로 버려진다.
 * 그러면 `onboardingDone` 까지 날아가서 **비행기 안에서 첫 실행
 * 안내부터 다시 하게 된다.**
 */

export const profileSchema = z.object({
  peerId: z.string().min(8).max(64),
  // 처음에는 비어 있다. 첫 실행 안내에서 채운다.
  displayName: z.string().max(20),
  character: z.enum(characterIds),
  // 예전 설정에는 여섯 자리 코드(pairingCode)가 남아 있다. 모르는 값은 버리고 읽는다.
  /** 핫스팟을 연 쪽인가 붙는 쪽인가 */
  role: z.enum(['host', 'guest']),
  /**
   * 상대를 내가 뭐라고 부르는가. "여자친구" 같은 것.
   *
   * **상대가 고른 이름은 인사를 주고받아야 안다.** 그런데 연결 화면은
   * 바로 그 전에 뜬다. 그때 "상대가 들어오기를 기다려요" 라고 하면
   * 누구를 기다리는지 모르는 것처럼 들린다. 사실은 안다.
   */
  peerNickname: z.string().max(20).optional(),
})

export const peerSchema = z.object({
  peerId: z.string().min(8).max(64),
  displayName: z.string().min(1).max(20),
  character: z.enum(characterIds),
})

export const preferencesSchema = z.object({
  audioMode: z.enum(['push-to-talk-brief', 'phone-mic', 'like-a-call']),
  duckMusic: z.boolean(),
  volumeKeyTalk: z.boolean(),
  onboardingDone: z.boolean(),
  /** 아이폰 앱을 설치한 날. 만료 3일 전에 알리는 데 쓴다 */
  installedAt: z.number().int().optional(),
  /** 앱을 **안 보고 있을 때** 새 말이 오면 어떻게 알릴까 */
  alertMode: z.enum(['sound', 'vibrate', 'silent']).default('vibrate'),
  /**
   * 앱을 **보고 있을 때** 새 말이 오면 짧게 떨까.
   *
   * 화면에 이미 떴는데 또 떨면 거슬릴 수 있다. 끌 수 있어야 한다.
   */
  tapWhileWatching: z.boolean().default(true),
  /**
   * 상대가 콕 찌르면 떨까.
   *
   * 콕 찌르기는 **말 없이 부르는 것**이라 진동이 곧 내용이다. 그래서
   * 보고 있든 안 보고 있든 떤다. 그래도 거슬리면 끌 수 있어야 한다.
   */
  nudgeVibration: z.boolean().default(true),
  /**
   * 대화 화면을 보고 있을 때 음성 메시지를 저절로 틀까.
   *
   * 켜두면 사실상 무전기가 된다. 상대가 말하면 바로 들리고 나는
   * 마이크를 꾹 눌러 답한다.
   */
  autoPlayVoice: z.boolean().default(true),
  /**
   * 뒤로 가도 연결을 붙들까. **아이폰에만 쓰인다.**
   *
   * 안드로이드는 전경 서비스로 늘 붙들고 있어서 이 값을 안 본다.
   * 아이폰은 들리지 않는 소리를 계속 내야 해서 배터리를 먹는다.
   * 그래서 기본은 꺼둔다.
   */
  keepAwakeWhileAway: z.boolean().default(false),
  /**
   * 목적지에 언제 도착하나. 이 폰의 시계로 잰 에폭 밀리초.
   *
   * **에폭 밀리초라 시간대와 상관없다.** 비행 중에 폰이 서울에서
   * 파리로 바뀌어도 이어서 흐른다. 벽시계 글자를 저장하면 그때
   * 어긋난다.
   */
  arrivesAt: z.number().int().positive().optional(),
  /**
   * 비행이 통째로 얼마나 긴가.
   *
   * **진행 막대를 그리려면 있어야 한다.** 남은 시간만으로는 얼마나
   * 왔는지 알 수 없다. 도착 시각과 짝으로 다닌다.
   */
  flightTotalMs: z.number().int().positive().optional(),
})

export type Profile = z.infer<typeof profileSchema>
export type KnownPeer = z.infer<typeof peerSchema>
export type Preferences = z.infer<typeof preferencesSchema>

export const defaultPreferences: Preferences = {
  // 기본은 "말할 때만 잠깐". 음악을 들으면서 쓰기에 가장 낫다.
  audioMode: 'push-to-talk-brief',
  duckMusic: true,
  volumeKeyTalk: true,
  onboardingDone: false,
  // 비행기는 시끄럽고 상대는 이어폰을 꽂고 있다. 소리보다 진동이 맞다.
  alertMode: 'vibrate',
  // 설정 화면이나 통화 화면에 있으면 새 말이 온 줄 모른다
  tapWhileWatching: true,
  // 콕 찌르기는 진동이 곧 내용이다
  nudgeVibration: true,
  // 무전기처럼 쓰는 것이 이 앱의 이름값이다
  autoPlayVoice: true,
  // 배터리를 먹는다. 연결이 자꾸 끊길 때만 켠다
  keepAwakeWhileAway: false,
}
