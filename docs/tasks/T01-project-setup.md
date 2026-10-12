# T01 — 프로젝트 뼈대와 개발 도구

**단계** 기반 · **상태** 완료 · **먼저 끝나야 하는 카드** 없음

## 목표

코드를 쓸 수 있는 상태를 만든다. 폴더 구조가 서고, 검사 도구가 돌고, 커밋할 때 자동으로 확인된다.

## 근거

[03-architecture.md](../03-architecture.md) 폴더 구조 · [02-tech-decisions.md](../02-tech-decisions.md) D3, D9 · [08-build-release.md](../08-build-release.md) 개발 환경

## 할 일

### 뼈대 세우기

```bash
pnpm create expo-app . --template blank-typescript
```

`app.config.ts`에 이름(SkyTalk), 식별자(`com.ybbarng.skytalk`. 2026-10-12 까지는 Skywalkie, `com.ybbarng.skywalkie`), 권한, 배경 모드를 적는다.

### 폴더 만들기

[03-architecture.md](../03-architecture.md)의 구조 그대로 빈 폴더와 `index.ts`를 둔다.

```
src/{domain,application,infrastructure,presentation,composition}
test/{fakes,integration}
```

### 타입 규칙

`tsconfig.json`에 엄격하게 잡는다.

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,   // 배열에서 꺼낸 값이 없을 수 있음을 강제
  "noImplicitOverride": true,
  "exactOptionalPropertyTypes": true,
  "paths": { "@/*": ["./src/*"] }
}
```

`noUncheckedIndexedAccess`는 처음에 귀찮지만, 없는 값을 꺼내 쓰는 실수를 컴파일 단계에서 막는다. 비행기에서 터질 오류 하나를 미리 잡는 값어치가 있다.

### 검사 도구

biome를 넣는다. 들여쓰기 공백 2칸, 나머지는 권장 설정을 따른다.

### 층이 규칙을 어기는지 검사하기

`scripts/check-deps.ts`를 만든다. 각 층의 파일이 무엇을 import 하는지 훑어서 아래를 어기면 실패시킨다.

```
domain         → 아무것도 import 하지 않는다 (domain 안쪽만 허용)
application    → domain 만
infrastructure → domain, application 만
presentation   → domain, application 만 (infrastructure 직접 참조 금지)
composition    → 전부 허용
```

이 검사가 없으면 층 구분은 지켜지지 않는다. 사람은 반드시 어긴다.

### 테스트 도구

vitest를 넣는다. 설정은 최소로 두고, React Native 코드를 다루는 테스트만 별도 환경을 쓴다.

### 커밋 전 자동 검사

lefthook을 넣는다.

```yaml
pre-commit:  biome + tsc
pre-push:    전체 검사 (verify)
```

### 명령 모음

`package.json`에 [09-testing.md](../09-testing.md)에 적은 명령들을 넣는다.

### git 설정

`.gitignore`에 `ios/`, `android/`, `node_modules/`, `.env.local`, `*.keystore`를 넣는다.
네이티브 폴더를 넣지 않는 이유는 [08-build-release.md](../08-build-release.md)에 적혀 있다.

## 끝난 걸 어떻게 아는가

- [x] `pnpm verify`가 통과한다
- [x] `pnpm check:deps`가 돌고, 일부러 규칙을 어긴 파일을 넣으면 실패한다
- [x] 커밋할 때 자동 검사가 돈다
- [x] `pnpm expo prebuild`가 성공한다
- [ ] 빈 화면이 두 폰에서 뜬다 — **기기 연결이 필요해 아직 확인하지 못했다**

## 하면서 알게 된 것

### pnpm 이 새 패키지 설치를 막았다

`minimumReleaseAge` 때문이다. **배포된 지 7일이 안 된 버전은 설치하지 않는**
장치이고, npm 에 악성 버전이 올라가는 사고는 대개 며칠 안에 발견되어 내려가므로
기다렸다 설치하는 것만으로 대부분을 피한다.

처음에는 이 프로젝트의 `.npmrc` 에서 통째로 껐다가(`minimum-release-age=0`)
되돌렸다. 확인해 보니 **잠금 파일에 이미 있는 버전을 설치할 때는 이 검사가
걸리지 않는다.** 걸리는 건 의존성을 건드릴 때(add / remove / 버전 올리기)뿐이다.
평소에 보호를 받고 그때만 푸는 편이 낫다.

```
pnpm install                  그냥 된다
pnpm deps:add <패키지>         새로 넣을 때만 푼다
pnpm deps:expo <패키지>        Expo SDK 버전에 맞춰 넣을 때
```

알아둘 것 세 가지.

- **10080분(7일)은 pnpm 10.32 의 기본값이다.** 누가 설정한 게 아니다
- `~/.npmrc` 의 `min-release-age=7` 은 pnpm 이 읽지 않는 키라 아무 효과가 없다.
  실제로 동작하는 이름은 `minimum-release-age`(`minimumReleaseAge`)다
- `expo install` 은 플래그를 pnpm 에 넘기지 못해서 환경변수로 푼다
  (`npm_config_minimum_release_age=0`)

### 설정에서 걸러낸 것들

- `baseUrl` — TypeScript 6 에서 폐기됐다. `paths` 만으로 충분하다
- `newArchEnabled`, `edgeToEdgeEnabled` — SDK 57 에서 기본이 되어 사라졌다
- 테스트 파일은 층 규칙 검사에서 뺐다. `vitest` 를 가져오는 건 당연하다

### 아직 안 한 것

- JDK 가 11 이라 안드로이드 빌드는 아직 안 된다. 17 이 필요하다 ([T25](./T25-release.md))
- 아이콘은 [T11](./T11-app-icon.md) 에서 만들어 `app.config.ts` 에 연결한다
