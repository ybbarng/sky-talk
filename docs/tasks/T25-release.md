# T25 — 배포와 릴리스

**단계** 배포 · **상태** 손으로 설치함 · `pnpm release` 는 아직 · **먼저** T14 (그 뒤로는 언제든)

## 목표

두 폰에 앱이 설치되고, 다시 깔아야 할 때 절차를 기억하지 못해도 된다.

## 근거

[08-build-release.md](../08-build-release.md)

## 할 일

> 이 카드는 **T14가 끝나면 한 번 하고**, 기능이 늘 때마다 다시 한다. 마지막까지 미루지 않는다. 배포가 막히는 문제를 일찍 발견해야 한다.

### 먼저 할 일

지금 깔린 JDK가 11이다. React Native 0.86은 17이 필요하다.

```bash
brew install --cask temurin@17
```

### 안드로이드 서명 열쇠

```bash
keytool -genkeypair -v -keystore release.keystore ...
```

- 저장소 **바깥**에 둔다
- 비밀번호는 `.env.local`에
- **열쇠 파일을 안전하게 백업한다.** 잃어버리면 덮어쓰기가 안 되고, 그러면 앱을 지우고 다시 깔아야 하고, 그러면 대화가 날아간다

### 빌드 명령

```bash
pnpm build:android        # APK
pnpm build:ios:device     # 아이폰에 USB로 직접 설치
pnpm build:ios:ipa        # .ipa 파일 (Sideloadly용)
```

### 릴리스 명령

```bash
pnpm release 1.0.0
```

[08-build-release.md](../08-build-release.md) 7장의 일곱 단계를 자동으로 한다. 검사가 실패하면 멈춘다.

**릴리스 설명에 설치 방법을 매번 같이 적는다.** 반년 뒤에 절차를 기억하지 못한다.

### 자동 검사

GitHub Actions로 올릴 때마다 `biome`, `tsc`, `vitest`, `check:deps`를 돌린다.

**앱을 만드는 일은 자동으로 하지 않는다.** 서명 열쇠를 GitHub에 올려야 하는데 그럴 이유가 없다.

### 바뀐 내용 정리

`CHANGELOG.md`에 버전별로 적는다. 사용자가 읽을 글이라 한국어로, 기능 위주로 쓴다.

### 여행 전 점검표

[08-build-release.md](../08-build-release.md) 9장의 점검표를 README에도 넣는다. **D-3의 비행기 모드 시험이 가장 중요하다.** 집에서 잘 되던 것이 비행기 모드에서 안 되는 경우가 있고, 이때 발견하면 고칠 시간이 있다.

## 끝난 걸 어떻게 아는가

- [ ] 안드로이드 폰에 GitHub 릴리스에서 받아 설치된다 — 릴리스를 안 만들었다. `pnpm apk` + `adb install -r` 로 넣었다
- [x] 아이폰에 USB로 설치되고 열린다 — 2026-09-19 `xcodebuild` + `devicectl` 로 (08-build-release.md 5.1)
- [x] 같은 열쇠로 덮어쓰기했을 때 대화가 남는다 — 2026-09-19 하루에 수십 번 덮어썼고 대화가 남았다 (두 폰 다)
- [ ] `pnpm release`가 끝까지 돈다 — 안 돌려봤다
- [ ] 릴리스 설명만 보고 설치할 수 있다 — 릴리스가 없다. 대신 08-build-release.md 4장·5.1 에 실제 명령을 적었다

## 하면서 알게 된 것

### 첫 비행은 손으로 넣은 빌드로 간다 — 2026-09-19

출발 당일까지 화면을 고치느라 릴리스 절차를 돌릴 틈이 없었다. 두 폰에는 **릴리스
빌드(Release)** 가 명령줄로 직접 들어가 있다. Debug 는 맥의 Metro 가 있어야 열려서
비행기에서는 못 쓴다. 명령과 막히는 것(`Locked`, macOS 에 `timeout` 없음, 아이폰
스플래시 저장)은 [08-build-release.md](../08-build-release.md) 에 있다.

아이콘·이름을 바꿨을 때 `pnpm prebuild`(`--clean`)를 쓰면 서명 설정이 날아간다.
`CI=1 pnpm expo prebuild` 로 덮어쓴다.
