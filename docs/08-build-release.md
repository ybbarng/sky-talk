# 빌드와 배포

> 상태: 확정 · 최종 수정 2026-09-19 (두 폰에 릴리스 빌드를 실제로 올린 날 기준)

두 대의 폰에 앱을 올리는 일이다. 안드로이드는 쉽고, 아이폰은 까다롭다.
**바쁘면 4장과 5.1 만 읽는다.** 거기 적힌 명령이 2026-09-19 에 실제로 돌아간 것이다.

## 1. 개발 환경

| 도구 | 필요한 버전 | 왜 |
|---|---|---|
| Node.js | 20 이상 | 지금 24.14.1이 깔려 있다 |
| pnpm | 10 이상 | 지금 10.32.1 |
| JDK | **17** | React Native 0.85 가 요구한다 |
| Xcode | **26.2** | 아래 1.1 을 읽는다. SDK 와 짝이 있다 |
| Android SDK | 35 이상 | 이미 설치됨 |
| CocoaPods | 1.15 이상 | 아이폰 쪽 라이브러리 설치용 |


### 1.1 Expo SDK 를 56 에 묶어둔다 — 57 은 맥이 못 따라간다

**2026-09-18 에 하루를 여기서 썼다.** 다음 사람(그리고 미래의 나)이 같은 길을
되밟지 않게 적어둔다.

SDK 57 은 아이폰 빌드에 **Xcode 26.4 이상**을 요구한다. 26.4 부터 Expo 가 미리
컴파일한 Swift 6 프레임워크를 내주기 때문이다. 그보다 낮은 Xcode 는 그걸 소스에서
직접 만들다가 터진다.

```
Expo SDK 57  →  Xcode 26.4 이상 필요
Xcode 26.4   →  macOS Tahoe 26.2 이상 필요
이 맥         →  macOS Sequoia 15.7
```

**그래서 SDK 57 을 쓰려면 macOS 를 통째로 올려야 한다.** 비행 날짜가 정해져 있는데
시스템을 흔들 이유가 없어서 **SDK 56 으로 내렸다.**

SDK 56 은 문제의 그 Swift 코드를 안 만든다. Xcode 26.2 로 두 폰 다 빌드된다.

| Xcode | SDK 57 | SDK 56 |
|---|---|---|
| 16.2 | 안 됨 | 안 됨 (iOS 26 기기에 설치 자체가 안 된다) |
| 26.2 | 안 됨 | **됨 ← 이 조합을 쓴다** |
| 26.3 | 안 됨 | 아마 됨 (안 해봤다) |
| 26.4 이상 | 됨 | — (macOS 를 올려야 깔 수 있다) |

**SDK 를 함부로 올리지 않는다.** 올리려면 macOS 부터 올려야 하고, 그러면 안드로이드
빌드와 서명까지 전부 다시 확인해야 한다.

> SDK 57 에서 나던 오류 두 가지를 적어둔다. 같은 증상을 보면 원인을 바로 안다.
>
> ```
> RuntimeScheduler.h       SWIFT_RETURNS_RETAINED ... not a SWIFT_SHARED_REFERENCE
> JavaScriptRuntime.swift  sending 'argumentsPtr' risks causing data races
> ```
>
> 앞엣것은 [expo/expo#49740](https://github.com/expo/expo/pull/49740) 과 같은
> 패치로 넘어간다. 뒤엣것은 못 넘어간다. Swift 언어 모드를 5 로 낮춰봤더니
> **더 나빠졌다** — 전혀 다른 오류가 새로 난다. Expo 의 동시성 코드를 손대는 것은
> **비행기에서 터질 위험을 만드는 일**이라 하지 않는다.

**App Store 는 26.2 를 안 내준다.** 늘 최신판만 내보내는데 그게 macOS 26 을
요구하면 아무것도 안 보여준다. [Xcodes](https://github.com/XcodesOrg/XcodesApp)
같은 도구로 버전을 골라 받거나 developer.apple.com 에서 직접 받는다.

### 1.2 SDK 를 내려도 우리 코드는 안 고쳤다

57 에서 56 으로 내리면서 **`src/` 와 `app/` 은 한 줄도 안 고쳤다.** 검사 1636 개가
그대로 통과했다.

층을 나눠두고([03-architecture.md](./03-architecture.md)) 네이티브를 전부 감싸 둔
덕이다. 바깥이 흔들려도 안쪽이 안 흔들린다. 다음에 SDK 를 올리거나 내릴 때도
같기를 기대할 수 있다.

## 2. 처음 한 번 하는 일

```bash
pnpm install
pnpm expo prebuild          # 네이티브 프로젝트를 만든다
```

`prebuild`는 `app.config.ts`를 읽어 `ios/`와 `android/` 폴더를 만든다. **이 두 폴더는 저장소에 넣지 않는다.** 설정 파일에서 다시 만들 수 있고, 손으로 고치면 다음 `prebuild`에서 날아가기 때문이다.

네이티브를 고쳐야 할 일이 생기면 `app.config.ts`의 플러그인으로 처리한다. 지금 있는 것:

| 플러그인 | 무엇을 하나 |
|---|---|
| `plugins/withoutPushEntitlement.js` | 무료 계정으로 서명이 안 되는 원격 푸시 권한을 뗀다 (5.2) |
| `plugins/withDisplayName.js` | 홈 화면 이름을 **SkyTalk** 로 (2.2) |
| `modules/ble-peripheral` | 블루투스 알리는 쪽 네이티브 모듈 (Kotlin·Swift). 플러그인이 아니라 로컬 Expo 모듈이다 |

### 2.1 `pnpm prebuild` 와 `expo prebuild` 는 다르다

`pnpm prebuild` 는 아이콘을 먼저 만들고 **`--clean` 으로 폴더를 지우고 새로 만든다.**
서명 설정이나 Podfile 손질이 있으면 날아간다. 이미 한 번 만든 뒤에는 이렇게 쓴다.

```bash
pnpm icons:generate
CI=1 pnpm expo prebuild        # --clean 없이. 바뀐 것만 덮어쓴다
```

`CI=1` 은 "지울까요?" 같은 물음을 안 띄우게 한다. 물음이 뜨면 자동화한 명령이 거기서
멈춰 있다. `ios/` 안 프로젝트 이름은 `app.config.ts` 의 `name`(`SkyTalk`)을 따른다. 아래 명령들이 그 이름을
쓴다. 이름을 바꾼 뒤에는 옛 이름의 `ios/`·`android/` 가 남지 않게 `pnpm expo prebuild --clean` 으로 한 번 새로 만든다.

### 2.2 아이콘이나 이름을 바꿨을 때

아이콘 원본은 `assets/icon/*.svg` 다 ([07-design-system.md](./07-design-system.md) 7장).
바꾸면 이 세 가지를 순서대로 한다. 하나라도 빠지면 **홈 화면은 그대로다.**

```bash
pnpm icons:generate            # SVG → assets/icon/generated/*.png
CI=1 pnpm expo prebuild        # PNG → android/ mipmap, ios/ Images.xcassets, 스플래시
# 그다음 4장·5.1 대로 다시 빌드해서 설치
```

홈 화면 이름은 `plugins/withDisplayName.js` 가 정한다(`CFBundleDisplayName`, `app_name`).
2026-09-19 에 Skywalkie 에서 **SkyTalk** 로 바꿨다. 패키지·번들 이름도 2026-10-12 에
`com.ybbarng.skytalk` 로 맞췄다. **이걸 또 바꾸면 다른 앱으로 취급돼 새로 깔리고 대화가 날아간다.**

**아이폰은 스플래시(실행 화면)를 저장해 둔다.** 아이콘과 스플래시를 바꿔 설치해도 앱을
열 때 옛 그림이 뜬다. 앱을 지우면 대화가 날아가니 **아이폰을 껐다 켠다.** 그러면
새 그림이 나온다.

## 3. 개발하면서 쓰는 앱

WebRTC 와 블루투스가 들어가서 Expo Go 로는 못 돌린다. **개발용 앱을 한 번 만들어 두 폰에 설치**하고, 그 위에서 코드만 바꿔가며 개발한다.

```bash
pnpm dev:android        # 안드로이드에 개발용 앱 설치 후 실행
pnpm dev:ios            # 아이폰 흉내(시뮬레이터)에 설치
pnpm dev:ios:device     # USB로 이은 진짜 아이폰에 설치
pnpm start              # 이미 설치했다면 이것만
```

**두 폰은 각각 따로 만든다.** 안드로이드용으로 만든 것을 아이폰에 넣을 수 없고
그 반대도 안 된다. 폰마다 한 번씩 돌려야 한다.

**블루투스는 시뮬레이터에서 안 된다.** 맥에는 블루투스 저전력 장치가 흉내
나지 않는다. 비행기 안에서 쓰는 길이 곧 블루투스이므로, 연결과 관련된 것은
**진짜 아이폰에 꽂아서만** 시험할 수 있다.

네이티브 라이브러리를 새로 넣거나 권한을 바꿀 때만 다시 만들면 된다.

**비행기에 들고 갈 것은 개발용이 아니라 릴리스 빌드다.** 개발용(Debug)은 맥의 Metro
서버에서 자바스크립트를 받아오므로 맥이 없으면 안 열린다. 2026-09-19 이후 두 폰에는
릴리스 빌드만 있다.

## 4. 안드로이드 배포

### 만들기와 설치 — 2026-09-19 에 실제로 쓴 명령

```bash
pnpm apk
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

`pnpm apk` 는 `android/` 에서 `gradlew assembleRelease` 를 돌린다(JDK 17 을 고른다). 코드만
바꿨으면 이 둘이면 된다. 아이콘·이름·네이티브 모듈을 바꿨으면 2.2 의 `prebuild` 를 먼저
한다. `adb install -r` 은 **지우지 않고 덮어써서 대화가 남는다.**

`pnpm build:android` 는 `expo run:android --variant release` 를 돌려 같은 일을 하지만
장치를 고르고 앱을 여는 데까지 관여해서 더 느리고, 자주 멈춰 물어봤다. 위 두 줄이 확실하다.

### 서명

`release.keystore`를 한 번 만들어 **저장소 바깥**에 둔다. 비밀번호는 `.env.local`에 넣고 역시 저장소에 넣지 않는다.

같은 열쇠로 서명해야 **앱을 지우지 않고 덮어쓸 수 있다.** 열쇠가 바뀌면 지우고 다시 깔아야 하고, 그러면 대화가 날아간다. 그래서 열쇠 파일을 따로 안전하게 백업해둔다.

### 맥 없이 설치

GitHub 릴리스에서 APK를 내려받아 누르면 끝이다. "출처를 알 수 없는 앱" 설치를 한 번 허용해야 한다. (아직 릴리스를 올린 적은 없다. 7장.)

### 안드로이드에서 뭐가 안 될 때 보는 곳

```bash
adb logcat | grep -E "BLE_GAP.*skytalk|ReactNativeJS"   # 블루투스 광고와 JS 로그
adb shell uiautomator dump && adb pull /sdcard/window_dump.xml  # 지금 화면에 뭐가 있나
adb shell input swipe 540 1200 542 1202 150                   # 그 자리를 누른다
```

`adb shell input tap` 은 이 폰에서 절반쯤 먹히지 않았다. **2픽셀 끌기(swipe)로 누른다.**
릴리스 빌드는 `adb` 로 앱 안 `/data/data` 를 못 읽는다. 대화를 꺼낼 때는 앱 안
"꺼내두기"(설정 → 대화)를 쓴다([05-messaging-spec.md](./05-messaging-spec.md)).

## 5. 아이폰 배포

여기가 어렵다. 유료 개발자 계정이 없기 때문이다.

### 무료 계정으로 할 수 있는 것과 없는 것

| | 무료 계정 | 유료 계정 (연 129,000원) |
|---|---|---|
| 기기에 설치 | 가능 | 가능 |
| **앱이 사는 기간** | **7일** | 1년 |
| 등록 가능한 기기 | 3대 | 100대 |
| 인터넷으로 배포 | 불가 | 가능 (TestFlight) |
| 앱 개수 제한 | 10개 | 없음 |

**가장 아픈 건 7일이다.** 그리고 인터넷으로 배포할 수 없어서 **USB로 연결해 설치해야 한다.**

### 5.1 방법 1 — Xcode 명령줄로 직접 (권장)

**2026-09-19 에 실제로 성공한 순서다.** 처음 하는 폰이면 여기 다섯 단계를
빠짐없이 밟아야 한다. 하나라도 빠지면 앞뒤가 안 맞는 오류가 난다.

```
1. 아이폰을 맥에 USB로 연결하고 잠금을 푼다
2. Xcode → Window → Devices and Simulators (⇧⌘2) 에서 페어링
   · 아이폰에 뜨는 "이 컴퓨터를 신뢰" 를 누르고 암호를 넣는다
   · 꽂기만 해서는 안 된다. 이 창에서 한 번 맺어야 한다
3. 아이폰 → 설정 → 개인정보 보호 및 보안 → 개발자 모드 → 켜기
   · 재시동을 요구한다. 재시동 뒤 한 번 더 켜기를 누른다
   · 이 항목은 맥에 한 번 꽂은 뒤에야 나타난다
4. 아래 명령 셋 (만들기 → 설치 → 열기)
5. 아이폰 → 설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 → 신뢰
   · 이 항목은 앱이 깔린 뒤에 생긴다. 그 전에 찾으면 없다
```

4번은 이 세 줄이다. `<UDID>`·`<기기-ID>` 는 `xcrun devicectl list devices` 로, `<팀-ID>` 는
Xcode 의 계정 설정(Signing & Capabilities)에서 본다. 저장소가 공개라 여기에 적지 않는다.

```bash
# 만들기 (Release, 실기기용). 5~10분 걸린다
xcodebuild -workspace ios/SkyTalk.xcworkspace -scheme SkyTalk \
  -configuration Release -destination 'id=<UDID>' \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<팀-ID> CODE_SIGN_STYLE=Automatic build

# 설치. 지우지 않고 덮어써서 대화가 남는다
xcrun devicectl device install app --device <기기-ID> \
  ~/Library/Developer/Xcode/DerivedData/SkyTalk-<맥마다 다름>/Build/Products/Release-iphoneos/SkyTalk.app

# 열기 (돌고 있으면 껐다 켠다)
xcrun devicectl device process launch --device <기기-ID> \
  --terminate-existing com.ybbarng.skytalk
```

`DerivedData` 밑의 폴더 이름(`SkyTalk-...`)은 맥마다 다르다. 없으면
`ls ~/Library/Developer/Xcode/DerivedData/` 로 찾는다.

5번을 빠뜨리면 아이콘은 생기는데 눌러도 안 열린다.

`pnpm build:ios` (`expo run:ios --device --configuration Release`) 도 같은 일을 하지만
기기 고르기에서 멈춰 서는 일이 있었다. 위 세 줄이 확실하다.

**막히는 것들**

- 열기에서 `Locked` 가 나오면 **아이폰이 잠겨 있는 것이다.** 잠금을 풀고 다시 한다.
  설치는 잠긴 채로도 되고 열기만 안 된다.
- macOS 에는 `timeout` 명령이 없다. 빌드가 오래 걸린다고 `timeout 600 xcodebuild` 로
  감싸면 명령을 못 찾았다고 한다. 그냥 돌리거나 `gtimeout`(coreutils)을 쓴다.
- 앱 아이콘·스플래시가 옛것이면 2.2 를 본다. 아이폰을 껐다 켠다.
- 아이폰이 인증서 확인 때문에 Wi-Fi 를 켜 달라고 할 때가 있다. 5번(신뢰)을 할 때
  한 번 인터넷이 필요하다. **비행 전에 집에서 해둔다.**

**개발자 모드는 계속 켜둬야 한다.** 끄면 이렇게 깐 앱이 안 열린다. 비행 중에
꺼지면 손쓸 수 없으므로 **두 폰 다 켜둔 채로 두고 끄지 않도록 알려둔다.**

### 5.2 무료 계정은 원격 푸시 권한을 못 쓴다

`expo-notifications` 가 `aps-environment` 를 자동으로 붙이는데, 무료 계정으로는
서명이 아예 안 된다.

```
Personal development teams do not support
the Push Notifications capability.
```

`plugins/withoutPushEntitlement.js` 가 이걸 뗀다. **떼도 잃는 것이 없다.**
그 권한은 바깥 서버가 보내는 알림에만 필요한데 비행기에는 인터넷이 없다.
우리가 쓰는 것은 기기가 스스로 띄우는 알림이고 그건 이 권한 없이 된다.

### 5.3 방법 2 — Sideloadly (맥 없이 재설치할 때)

여행지에서 맥 없이 다시 깔아야 하면 쓸 수 있다. 다만 윈도우나 맥 컴퓨터는 있어야 한다.

릴리스에 `.ipa` 파일을 같이 올려둔다. Sideloadly에 애플 ID를 넣고 파일을 끌어다 놓으면 설치된다.

### 5.4 7일 문제 다루기

이게 제품 설계에 영향을 준다. 자세한 건 [05-messaging-spec.md](./05-messaging-spec.md)의 보관 항목에 있다.

- **출발 하루 전에 다시 설치한다.** 여행 일정에 맞춰 날짜를 계산해 알려주는 안내를 README에 적는다.
- **지우지 말고 덮어쓴다.** 같은 열쇠로 서명하면 덮어쓸 수 있고, 그러면 대화가 남는다.
- 만료 3일 전부터 앱이 먼저 알리고 내보내기를 권한다.
- 그래도 날아갈 수 있으니 내보내기와 되돌리기가 항상 동작해야 한다.

### 5.5 만약 유료 계정을 살 거라면

여행이 길거나 앞으로도 쓸 거라면 연 129,000원이 시간을 크게 아껴준다. TestFlight로 인터넷에서 바로 설치할 수 있고 1년 동안 만료되지 않는다. 결정은 나중에 해도 되고, 사더라도 코드는 그대로다.

## 6. 버전 붙이기

`1.2.3` 꼴로 붙인다.

- 앞자리: 저장한 대화를 못 읽게 되는 변화
- 가운뎃자리: 기능 추가
- 뒷자리: 고침

빌드 번호는 태그를 붙일 때마다 자동으로 하나씩 올린다.

**두 폰의 앞자리와 가운뎃자리가 같아야 한다.** 다르면 인사 단계에서 경고를 띄운다. 규약이 달라 대화가 안 될 수 있기 때문이다.

## 7. 내보내는 절차

```bash
pnpm release 1.0.0
```

이 명령 하나가 다음을 한다.

1. 검사와 테스트를 돌린다. 하나라도 실패하면 멈춘다
2. `package.json`과 `app.config.ts`의 버전을 고친다
3. 바뀐 내용을 정리해 `CHANGELOG.md`에 적는다
4. 커밋하고 `v1.0.0` 태그를 붙인다
5. 안드로이드 APK를 만든다
6. 아이폰 `.ipa`를 만든다
7. GitHub 릴리스를 만들고 두 파일을 올린다

릴리스 설명에는 **설치 방법을 매번 같이 적는다.** 반년 뒤에 다시 깔 때 절차를 기억하지 못할 것이기 때문이다.

**2026-09-19 기준으로 이 명령은 아직 끝까지 돌려본 적이 없다.** 두 폰에는 4장과 5.1 의
명령으로 직접 올렸다. 첫 비행은 그걸로 간다. GitHub 릴리스는 돌아온 뒤 첫 태그를 붙일 때
써본다.

## 8. 자동 검사

GitHub Actions로 코드를 올릴 때마다 검사한다.

```yaml
검사 항목:
  - biome  (코드 형식과 흔한 실수)
  - tsc    (타입)
  - vitest (테스트)
  - 의존 방향 검사 (안쪽 층이 바깥을 참조하지 않는지)
```

앱을 만드는 일은 자동으로 하지 않는다. 서명 열쇠를 GitHub에 올려야 하는데 그럴 이유가 없다. 릴리스는 내 컴퓨터에서 만든다.

## 9. 여행 전 점검표

출발 전에 이것만 확인하면 된다.

```
D-7   두 폰에 릴리스 빌드를 깔고 집에서 연결해본다
      · 블루투스만 켜고 붙기 (비행기에서 쓰는 유일한 길이다)
      · 글·이모티콘·콕 찌르기 주고받기
      · 사진 "작게" 한 장, 음성 메시지 하나 (몇십 초 걸리는 게 정상)
      · 이름·상태 메시지를 바꾸면 상대 화면에 바로 뜨는지
D-3   비행기 모드에서만 연결되는지 확인한다  ← 이게 진짜 시험이다
      · 두 폰 다 비행기 모드 + 블루투스만 켜기
      · 비행기 모드에서는 핫스팟이 안 켜진다(02-tech-decisions.md)
      · 다른 블루투스 대화 앱(bitchat 같은 것)은 두 폰 다 완전히 끈다
      · 아이폰을 잠근 채 멀어졌다 돌아와도 저절로 붙는지
      · 한쪽 앱을 껐다 켜도 30초 안에 다시 붙는지
D-1   아이폰에 앱을 다시 설치한다 (7일 시계를 되감는다)
      · 대화가 남아 있는지 확인
      · 안 남았으면 미리 내보낸 파일로 되돌린다
      · "개발자 앱 신뢰" 에 인터넷이 필요할 수 있다. 집에서 한다
D-1   두 폰을 완충한다
      · 보조 배터리도 챙긴다. 블루투스는 화면보다 덜 먹지만 비행이 길다
당일   탑승 전에 한 번 더 연결해본다
```

**D-3의 비행기 모드 시험이 가장 중요하다.** 집에서 잘 되던 것이 비행기 모드에서 안 되는 경우가 있다. 이때 발견하면 고칠 시간이 있다.

**다른 블루투스 대화 앱이 켜져 있으면 안 붙는다.** 2026-09-19 에 두 폰에 bitchat 이 떠
있는 동안 링크가 계속 끊겼다. 같은 블루투스 연결을 나눠 쓰다 한쪽이 끊으면 우리 것도
같이 끊긴다. 화면에서 밀어 닫는 것으로는 모자랄 수 있으니 확인한다. 연결 상세와 도움말에도
적어두었다.

통화·영상은 점검표에서 뺐다. 지금 앱에 여는 단추가 없다([tasks/README.md](./tasks/README.md)).

## 10. 관련 문서

- 제품 명세: [01-product-spec.md](./01-product-spec.md)
- 대화 보관: [05-messaging-spec.md](./05-messaging-spec.md)
- 테스트: [09-testing.md](./09-testing.md)
