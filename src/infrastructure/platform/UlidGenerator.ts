import { monotonicFactory } from 'ulid'
import type { IdGenerator } from '@/domain/shared/IdGenerator'

/**
 * 실제 ULID 를 만든다.
 *
 * 앞 10자리가 시각이라 정렬만 하면 시간순이 되고, 두 기기가 각자 만들어도
 * 겹치지 않는다. 그 성질 덕에 보관 파일을 합칠 때 중복 판단 기준으로 쓴다.
 *
 * ## 난수를 직접 줘야 한다
 *
 * **이걸 안 주면 앱이 통째로 안 돈다.** `ulid` 는 기본으로 브라우저의
 * `crypto.getRandomValues` 를 찾는데 React Native 에는 그게 없다. 그러면
 * 이렇게 던진다.
 *
 * ```
 * ULIDError: Failed to find a reliable PRNG (PRNG_DETECT)
 * ```
 *
 * 식별자를 못 만들면 프로필도 못 만들고 메시지도 못 만든다. 실제로 첫
 * 실행 안내에서 "다음" 이 안 먹었고, **오류가 화면에 안 떠서** 버튼이
 * 고장 난 것처럼 보였다. 테스트는 전부 가짜 생성기를 넣어 시험하니
 * 이 자리만 비어 있었다.
 *
 * ## 왜 `Math.random` 인가
 *
 * 이 값은 **겹치지 않으면 되는 이름**이지 못 맞히게 할 비밀이 아니다.
 * 두 사람이 몇천 개를 만들어도 겹칠 일이 없다.
 *
 * 제대로 된 난수를 쓰려면 네이티브 모듈(`expo-crypto` 등)을 들여와야
 * 하는데, **이건 앱이 켜지자마자 도는 길이다.** 거기서 네이티브를 들이면
 * 빌드가 어긋났을 때 앱이 통째로 안 켜진다. 덤 하나 때문에 대화를 못 하게
 * 되는 것이 이 앱에서 가장 나쁜 일이다. (`CLAUDE.md`)
 */

/** `ulid` 가 쓸 난수. 0 이상 1 미만을 준다 */
const prng = (): number => Math.random()

/**
 * 같은 밀리초 안에서도 순서를 지킨다.
 *
 * 그냥 `ulid()` 를 쓰면 같은 밀리초에 만든 것들의 앞뒤가 뒤바뀔 수 있다.
 * 빨리 보낸 두 마디가 뒤집혀 보이면 대화가 이상해진다.
 */
const nextUlid = monotonicFactory(prng)

export const ulidGenerator: IdGenerator = {
  next: () => nextUlid(),
}

/**
 * 상대 식별자를 만든다.
 *
 * 앱을 처음 켤 때 한 번만 부른다. 이 값이 사라지면 상대와 다시
 * 짝을 맺어야 한다.
 */
export function makePeerId(): string {
  // ULID 를 그대로 쓴다. 26자에 겹치지 않고, 영문과 숫자뿐이라
  // 파일 이름과 주소에 그대로 들어간다.
  return nextUlid()
}
