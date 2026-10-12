# SkyTalk 작업 지침

비행기에서 두 사람이 인터넷 없이 대화하는 앱. React Native + Expo.
홈 화면 이름은 SkyTalk, 저장소는 `sky-talk`, 앱 식별자는 `com.ybbarng.skytalk` 다. 2026-10-12 에 `skywalkie` 에서 바꿨다. **식별자를 또 바꾸면 폰에서는 새 앱이 되어 대화가 사라진다.**

## 먼저 읽을 것

작업 전에 관련된 명세를 읽는다. **명세에 없는 것을 임의로 만들지 않고, 명세와 다르게 만들어야 하면 명세부터 고친다.**

| 무엇을 할 때 | 무엇을 읽나 |
|---|---|
| 무엇이든 | [docs/01-product-spec.md](./docs/01-product-spec.md) |
| 코드를 어디에 둘지 고민될 때 | [docs/03-architecture.md](./docs/03-architecture.md) |
| 통신을 건드릴 때 | [docs/04-transport-spec.md](./docs/04-transport-spec.md) |
| 메시지·저장·내보내기 | [docs/05-messaging-spec.md](./docs/05-messaging-spec.md) |
| 음성·영상(준비 중) | [docs/06-voice-video-spec.md](./docs/06-voice-video-spec.md) |
| 화면 | [docs/07-design-system.md](./docs/07-design-system.md) |
| 빌드·배포 | [docs/08-build-release.md](./docs/08-build-release.md) |
| 테스트 | [docs/09-testing.md](./docs/09-testing.md) |
| 이 저장소가 어떻게 됐나 | [docs/10-retrospective.md](./docs/10-retrospective.md) |

## 작업 방식

**작업 카드 단위로 진행한다.** [docs/tasks/README.md](./docs/tasks/README.md)에 있다. 카드 밖의 일(실기기에서 잡은 버그, 사용자 요청)은 카드 번호 없이 커밋한다.

```
1. 카드를 고르고 상태를 "진행 중"으로 바꾼다
2. 카드에 적힌 "할 일"을 만든다
3. 카드에 적힌 "끝난 걸 어떻게 아는가"를 전부 확인한다
4. pnpm verify 를 돌린다
5. 커밋한다
6. 카드 상태를 "완료"로 바꾼다
```

여러 카드를 한 커밋에 섞지 않는다.

## 절대 어기면 안 되는 것

### 층의 의존 방향

```
presentation ──▶ application ──▶ domain
                      ▲
              infrastructure
```

- `domain`은 **아무것도 import 하지 않는다.** React, Expo, Node 모듈 전부 금지
- `application`은 `domain`만
- `presentation`은 `infrastructure`를 직접 참조하지 않는다
- 조립은 `composition/container.ts` 한 곳에서만

`pnpm check:deps`가 검사한다. 이 검사를 우회하는 코드를 쓰지 않는다.

### 네이티브 모듈을 맨 위에서 들여오지 않는다

`expo-*`, `react-native-*` 는 **빌드가 어긋나면 들여오는 순간 터진다.** 그게 앱을 켜자마자 도는 파일이면 앱이 통째로 안 켜진다. **글도 못 쓴다.**

```ts
// ❌ 맨 위에서
import * as Haptics from 'expo-haptics'

// ✅ 쓸 때, 감싸서
try {
  const haptics = require('expo-haptics')
} catch {
  // 없으면 없는 대로
}
```

`pnpm check:native`가 `composition/services.ts`에서 출발해 닿는 파일을 전부 본다. 덤 하나가 없어서 대화 자체를 못 하게 되는 것이 이 앱에서 가장 나쁜 일이다.

라이브러리가 겉으로 내보내는 이름도 믿지 않는다. `expo-audio` 의 녹음기는 `AudioModule.AudioRecorder` 로만 만들어진다. 겉 이름으로 `new` 하면 조용히 실패해 마이크가 아무 반응이 없었다(2026-09-19).

### 저장이 먼저, 전송이 나중

`SendMessage`는 반드시 이 순서다.

```
Message 만들기 → 저장 → 전송 → 상태 고치기
```

반대로 하면 전송 도중 앱이 죽었을 때 메시지가 사라진다. 사진·음성도 같다: 줄이기 → 기기에 두기 → 메시지 저장 → 메시지 보내기 → 조각 보내기.

### 메시지를 지우지 않는다

동기화 순번을 메시지 행에서 센다. 지우면 순번이 0으로 돌아가 다음 인사 때 상대가 전부 다시 보낸다. "대화 비우기" 는 지우지 않고 화면에서만 감춘다. 표를 고칠 때도 예전 대화가 살아남아야 한다. 아이폰 앱은 7일마다 만료되는데, **대화가 앱보다 오래 산다.**

### 시간과 식별자를 직접 만들지 않는다

`Date.now()`와 ULID 생성을 도메인·응용 코드에서 직접 부르지 않는다. `Clock`과 `IdGenerator`를 주입받는다. 안 그러면 테스트가 어떤 날 갑자기 실패한다.

### 색을 직접 적지 않는다

화면 코드에 `#RRGGBB`나 `rgba(...)`가 나오면 안 된다. 반드시 `useTheme()`의 토큰을 거친다. `pnpm check:tokens`가 검사한다. 색을 정하는 곳은 `src/presentation/theme/` 뿐이다.

### 예외를 던지지 않는다

도메인과 응용 계층은 `Result`로 실패를 돌려준다. `infrastructure`는 바깥 세계의 예외를 전부 잡아 `Result`로 바꾼다. 예외가 위층으로 새지 않는다.

### 모르는 봉투가 와도 연결을 끊지 않는다

상대가 다른 버전의 앱일 수 있다. 모르는 종류는 조용히 무시하고, 모르는 항목은 버리고 읽는다. 봉투에 항목을 더할 때는 **선택 항목**으로 둔다. 이 규칙이 없으면 한쪽만 업데이트했을 때 대화가 통째로 안 된다.

### 인터넷을 쓰지 않는다

외부 서버에 의존하는 코드를 넣지 않는다. STUN·TURN, 푸시 알림, 오류 수집, 원격 설정, 글꼴 내려받기 전부 금지. **비행기에서 인터넷이 없다.**

새 라이브러리를 넣을 때 인터넷을 쓰는지 확인한다.

### 화면에서 — 실기기에서 잡힌 것들

흉내로는 안 잡히고 두 폰으로 써봐야 잡혔다(2026-09-19). 다시 밟지 않는다.

- **`Modal` 을 직접 만들지 않는다. `Sheet` 를 쓴다.** 안드로이드 edge-to-edge 에서 자리가 어긋나고, 뒤를 덮는 `Pressable` 이 창 안의 단추를 가로챈다. 함정이 `src/presentation/components/Sheet.tsx` 주석에 다 있다.
- **reanimated 의 레이아웃 움직임(`entering`/`exiting`)을 쓰지 않는다.** 그려지는 자리와 눌리는 자리가 어긋난다.
- **대화 목록은 뒤집힌(`inverted`) `FlatList` 다.** 날짜 구분선은 말풍선 칸 안에 넣지 않고 따로 한 칸으로 둔다.
- **`KeyboardAvoidingView behavior="padding"` 을 두 운영체제 모두에 준다.** 안드로이드 edge-to-edge 에서는 `adjustResize` 가 안 먹는다.
- 자산 파일은 사진이든 소리든 `.jpg` 로 놓인다(`ExpoAssetStore.pathOf`). 소리를 틀 때는 `.m4a` 로 복사해서 튼다.

### 블루투스에서 — 실기기에서 잡힌 것들

- 찾기는 **켜진 것을 보고 나서** 시작한다. iOS 는 "모름" 상태에서 찾기를 시작하면 즉시 실패한다. 꺼져 있으면 반대쪽으로 돌아서지 않는다.
- 못 찾아도 접지 않는다. 끊기면 다시 찾는다. 심장박동으로 진짜 연결 상태를 본다. **찾는 쪽만 움직인다.**
- 알리는 쪽(Kotlin·Swift 모듈)의 조각 줄은 두 스레드가 건드린다. **잠금 없이 만지지 않는다.** 조각 하나가 사라지면 사진이 영영 못 모인다.
- 듣고 있던 상대가 떨어졌을 때만 끊김으로 본다. 다른 기기가 붙었다 떨어지는 일은 늘 있다.
- 앱이 다시 켜지면 옛 링크가 남아 있을 수 있다. 알리는 쪽이 켜질 때 떼어낸다.
- 조각은 응답을 받는 쓰기로 보낸다. 사진 조각은 줄이 짧을 때만 넣어 글에 양보한다.
- ble-plx 관리자는 앱에 하나뿐이다. `destroy()` 하지 않는다.

## 판단이 필요할 때 기준

### 두 기기 사이가 가장 위험하다

이 앱의 버그는 대부분 "두 기기가 다르게 생각할 때" 생긴다. 그래서 통신 규약 코드([T07](./docs/tasks/T07-protocol.md))와 연결 관리([T09](./docs/tasks/T09-link-manager.md), [T20](./docs/tasks/T20-ble-transport.md))의 테스트가 가장 값지다. 여기는 넉넉히 시험한다.

### 고칠 기회가 한 번뿐이다

비행기 안에서 버그를 발견하면 그걸로 끝이다. 앱 스토어 업데이트도 서버 수정도 없다. **"나중에 고치지"가 통하지 않는다.**

### 화면은 설명이다

말을 나눌 수 없는 두 사람이 각자 화면만 보고 연결에 성공해야 한다([T12](./docs/tasks/T12-onboarding.md)). 오류 메시지에 코드나 영어를 띄우지 않고, **무엇이 잘못됐고 무엇을 누르면 되는지**를 적는다. 안 되는 기능의 단추는 숨기지 않고, 누르면 왜 안 되는지 적는다.

### 대화가 앱보다 오래 산다

아이폰 앱은 7일마다 만료된다. 메시지를 지우거나 못 읽게 만드는 변경은 하지 않는다.

## 글쓰기

사용자에게 보이는 글(화면 문구, 커밋 메시지, 문서, 주석)은 **일상 한국어**로 쓴다.

- 영어를 음역하지 않는다: 스킵 ❌ → 건너뛰다
- 한자어를 무겁게 조합하지 않는다: 회귀 ❌ → 기존 동작이 깨진다
- 명사로 끝내지 않는다: "연결 실패" ❌ → "연결하지 못했어요"
- 코드 식별자(함수명·타입명)는 원문 그대로

## 의존성을 새로 넣을 때

`pnpm add` 를 그냥 쓰면 막힌다. pnpm 이 **배포된 지 7일이 안 된 버전을 설치하지 않기** 때문이다(공급망 공격 방어, pnpm 10.32 기본값). 이 보호는 그대로 두고 넣을 때만 푼다.

```bash
pnpm deps:add <패키지>       새로 넣기
pnpm deps:remove <패키지>    빼기
pnpm deps:expo <패키지>      Expo SDK 버전에 맞춰 넣기
```

`pnpm install` 은 그냥 된다. 잠금 파일에 있는 버전은 검사하지 않는다.

## 핫스팟 값

집에서 Wi-Fi 로 준비할 때 쓰는 핫스팟 이름과 비밀번호는 `.env` 에 둔다. 저장소가 공개라 코드에 적지 않는다. 비행기에서는 핫스팟이 안 켜지므로 화면에서는 안내를 뺐다.

```bash
cp .env.example .env
```

`EXPO_PUBLIC_` 로 시작하는 값은 **빌드할 때 앱 안에 박힌다.** 읽을 때는 `process.env.EXPO_PUBLIC_...` 를 글자 그대로 적는다.

## 명령

```bash
pnpm verify          # 전부 (커밋 전에 이것만 돌리면 된다)
pnpm test            # 테스트
pnpm test:watch
pnpm typecheck
pnpm lint
pnpm check:deps      # 층 규칙
pnpm check:native    # 켜자마자 도는 길에 네이티브 모듈
pnpm check:tokens    # 화면 코드에 색

pnpm start           # 개발
pnpm dev:android
pnpm dev:ios

pnpm apk             # 안드로이드 릴리즈 APK
pnpm expo prebuild   # 아이콘·홈 화면 이름을 바꿨을 때. 스플래시도 같이 갱신된다
```

아이폰 릴리즈 빌드와 설치 명령은 [docs/08-build-release.md](./docs/08-build-release.md)에 있다. Xcode 26.2 여야 한다.

## 실기기로 확인할 때

- 두 폰 모두 **bitchat 같은 다른 블루투스 대화 앱을 완전히 끈다.** 같은 링크를 써서 우리 연결이 끊긴다.
- 안드로이드 단추는 `adb shell input swipe X Y X+2 Y+2 150` 으로 누른다. `input tap` 은 안 먹는 경우가 있다. 화면 글은 `uiautomator dump` 로 읽는다.
- 아이폰은 잠겨 있으면 앱을 못 켠다. 덮어 설치하면 옛 시작 화면이 캐시로 남는데 재부팅하면 사라진다.
- 안드로이드 릴리즈 빌드의 대화 DB 는 `adb` 로 못 꺼낸다. 앱의 대화 꺼내기를 쓴다.

## 커밋

- 한국어로 쓴다
- 작업 카드가 있으면 번호를 앞에 붙인다: `T07: 봉투 형식과 바이트 자르기`
- 하나의 카드 = 하나 이상의 커밋. 여러 카드를 한 커밋에 섞지 않는다
- `git checkout` 대신 `git switch` / `git restore`
