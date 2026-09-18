# 코드 구조

> 상태: 확정 · 최종 수정 2026-09-19

## 왜 이렇게 나누는가

이 앱의 핵심 난제는 하나다. **메시지가 지나갈 길이 여러 개이고, 어디에 있느냐에 따라 길이 바뀐다.**

- 비행기에서는 블루투스로 간다. 이것이 정상 연결이다.
- 집에서 준비할 때는 Wi-Fi(핫스팟 + TCP)로 간다.
- 아이폰 앱이 만료되면 웹으로 간다.

"메시지를 보낸다"는 뜻은 이 셋 모두에서 같다. 달라지는 건 **어떻게 보내느냐**뿐이다.
그래서 **뜻은 안쪽에, 방법은 바깥쪽에** 둔다. 이게 이 문서 전체를 관통하는 원칙이다.

## 네 겹

```
┌─────────────────────────────────────────────────────┐
│  presentation   화면. 사람이 보고 누르는 것          │
│                 React 컴포넌트, 화면 상태            │
├─────────────────────────────────────────────────────┤
│  application    할 일. "메시지를 보낸다" 같은 절차   │
│                 유스케이스, 포트(약속)               │
├─────────────────────────────────────────────────────┤
│  domain         뜻. 메시지란 무엇인가                │
│                 엔티티, 값 객체, 도메인 규칙         │
├─────────────────────────────────────────────────────┤
│  infrastructure 방법. 실제로 어떻게 하는가           │
│                 블루투스, 소켓, 데이터베이스, 녹음기 │
└─────────────────────────────────────────────────────┘
```

의존 방향은 한쪽이다.

```
presentation ──▶ application ──▶ domain
                      ▲
                      │ (약속을 지킨다)
              infrastructure
```

`domain`은 아무것도 import 하지 않는다. React도, SQLite도, 소켓도 모른다.
`infrastructure`는 `application`이 정한 약속(인터페이스)을 지키는 쪽이다. 화살표가 위를 향하는 이유가 이것이다 — **의존성 역전**.

### 이게 실제로 무슨 이득인가

2026-09-19 에 사진·음성을 블루투스로도 나르기로 바꿨을 때, 손댄 곳은 `infrastructure/transport/ble` 와 `application/assets` 의 크기 규칙, 그리고 묻는 화면뿐이었다. 도메인은 한 줄도 안 바뀌었다.

테스트도 같은 이유로 쉬워진다. 진짜 블루투스 없이 가짜 연결을 끼우면 대화 전 과정을 컴퓨터에서 시험할 수 있다.

## 폴더

실제 폴더다. 파일은 대표적인 것만 적는다.

```
app/                            expo-router 화면 (presentation 의 진입점)
├── _layout.tsx
├── index.tsx                   첫 실행 안내로 보낼지 대화로 갈지
├── onboarding/                 환영 → 캐릭터와 이름 → 연결 안내 (세 단계)
├── (tabs)/
│   ├── chat.tsx                대화. 뒤집힌 목록, 입력칸, 녹음 창, 사진 크기 고르기
│   └── settings.tsx            연결·이름·상태 메시지·화면·알림·비행·음성·대화·도움말
├── connection-detail.tsx       연결 상태 자세히
├── doodle.tsx / export.tsx / help.tsx

src/
├── domain/                     아무것도 모르는 순수한 층
│   ├── message/                Message, MessageContent(글·이모티콘·콕찌르기·사진·음성·낙서), Conversation
│   ├── peer/                   PeerId, Character
│   ├── connection/             ConnectionState(상태 전이), LinkKind, LinkQuality
│   ├── flight/                 FlightTimer — 출발·도착 시각, 남은 시간, 출발한 지
│   ├── call/                   CallState (통화는 준비 중이지만 규칙은 남아 있다)
│   └── shared/                 Result, Clock, IdGenerator, DomainError
│
├── application/                할 일과 약속
│   ├── ports/                  Envelope(봉투 생김새), MessageTransport, ConversationRepository,
│   │                           AssetTransfer, VoiceMemo, VoiceLink, Vibration …
│   ├── messaging/              SendMessage, ReceiveMessage, ConversationSync(인사·되찾기),
│   │                           FlushPendingMessages, LoadConversation, MarkAsRead
│   ├── assets/                 SendPhoto(작게·중간·원본), SendVoice, ChunkSender, ReceiveAsset
│   ├── archive/                ExportConversation, ImportConversation
│   ├── call/                   통화 절차 (준비 중)
│   └── shared/                 SerialQueue
│
├── infrastructure/             실제 방법
│   ├── transport/
│   │   ├── ble/                BleMessageTransport(찾기·알리기·심장박동·양보), bleModule,
│   │   │                       blePermission, bluetoothState, chunk/(자르기·다시 붙이기)
│   │   ├── wifi/               WifiLink, TcpMessageTransport, WifiPeerDiscovery, DiscoveryPlan
│   │   ├── web/                LocalHttpServer — 비상용 웹 채팅
│   │   ├── protocol/           EnvelopeSchema(zod), FrameCodec, FrameDecoder, Handshake
│   │   └── CompositeTransport.ts  여러 길을 하나로. 못 연 길도 지켜본다
│   ├── persistence/            SqliteConversationRepository, migrations/, mappers/
│   ├── assets/                 ExpoImageTools — 사진 줄이기, 자산 파일 창고
│   ├── voice/                  ExpoVoiceMemo(녹음·재생), SilentKeepAlive
│   ├── call/                   WebRtcVoiceLink (준비 중)
│   ├── archive/                ExpoFileStore — 파일로 꺼내고 공유
│   └── platform/               Settings, settingsSchema, HapticVibration, LocalNotifier, UlidGenerator
│
├── presentation/               화면
│   ├── components/             Sheet, Button, ConnectionBar, ConnectingView, Icon, …
│   │   ├── chat/               MessageBubble, MessageInput, VoiceRecordSheet, PhotoViewer,
│   │   │                       FlightBar, StickerPanel, timeMarks, listBottom
│   │   ├── call/ doodle/ onboarding/
│   ├── stores/                 useChatStore, useSetupStore, useCallStore, connectPhase, linkNotice
│   ├── hooks/                  useStickToBottom, useBluetoothWatch, useMessageNotifications, …
│   ├── copy/                   화면 문구. connecting, help, link, notify, onboarding, stickers
│   ├── characters/             SVG 캐릭터, peerFace
│   └── theme/                  색·글자·간격 토큰
│
└── composition/                조립
    ├── container.ts            어떤 구현을 끼울지 정하는 곳
    └── services.ts             화면이 쓰는 것들을 한 번 거쳐 내보낸다

modules/
├── ble-peripheral/             알리는 쪽 BLE 모듈. Kotlin·Swift 로 직접 만듦
└── stay-alive/                 안드로이드 전경 서비스

plugins/                        expo 설정 플러그인 (홈 화면 이름, 푸시 권한 떼기)
```

## 층별로 지키는 규칙

### domain — 아무것도 모른다

- `import`는 같은 `domain` 안에서만. React, Expo, Node 모듈 전부 금지.
- 클래스는 항상 **올바른 상태로만** 만들어진다. 반쯤 채워진 메시지는 존재할 수 없다.
- 상태를 바꾸는 대신 새 값을 만든다(불변).
- 실패는 예외를 던지지 않고 `Result` 값으로 돌려준다. 부르는 쪽이 반드시 다루게 만든다.
- `Date.now()` 와 ULID 를 직접 부르지 않는다. `Clock` 과 `IdGenerator` 를 받는다.

### application — 절차를 적는다

- 유스케이스 하나는 **하나의 일**을 한다. `execute` 하나만 밖으로 낸다.
- 필요한 것은 전부 생성자로 받는다(의존성 주입). 안에서 직접 만들지 않는다.
- 여기서도 React와 Expo를 모른다.

```ts
// application/messaging/SendMessage.ts — 느낌만
export class SendMessage {
  async execute(input: SendMessageInput): Promise<Result<Message>> {
    // 1. 메시지를 만든다
    // 2. 먼저 저장한다 (전송에 실패해도 남는다)
    // 3. 보낸다
    // 4. 결과에 따라 상태를 고친다
  }
}
```

**먼저 저장하고 나중에 보내는 순서**가 중요하다. 반대로 하면 전송 도중 앱이 죽었을 때 메시지가 사라진다.

사진·음성도 같다. 줄이기 → 기기에 두기 → 메시지 저장 → 메시지 보내기 → 조각 보내기. 메시지가 먼저 가야 상대 화면에 미리보기라도 바로 뜬다.

### infrastructure — 약속을 지킨다

- `application/ports`의 인터페이스를 구현한다.
- 바깥 세계의 오류를 전부 잡아서 `Result`로 바꾼다. 예외가 위층으로 새지 않는다.
- **네이티브 모듈은 맨 위에서 `import` 하지 않는다.** 쓸 때 `require` 로 감싸서 들여온다. 빌드가 어긋나면 들여오는 순간 터지는데, 그게 앱이 켜지자마자 도는 파일이면 글도 못 쓴다. `pnpm check:native` 가 검사한다.
- 라이브러리가 겉으로 내보내는 이름을 믿지 않는다. `expo-audio` 는 녹음기 생성자를 `AudioModule` 안에만 둔다. 겉 이름으로 `new` 하면 조용히 실패해 마이크가 아무 반응이 없었다.
- 자산 파일은 사진이든 소리든 같은 창고에 `.jpg` 로 놓인다. 소리는 재생기가 확장자로 형식을 고르므로 틀기 전에 `.m4a` 로 복사한다.

### presentation — 보여주고 받는다

- 화면은 유스케이스를 부르기만 한다. 규칙을 화면에 쓰지 않는다.
- 도메인 객체를 화면이 직접 다루지 않는다. 보기 좋은 형태로 바꿔서 넘긴다.
- 스타일은 반드시 토큰을 거친다. 색을 직접 적지 않는다. `pnpm check:tokens` 가 검사한다.

## 화면에서 지키는 것 — 실기기에서 배운 것

2026-09-19 에 두 폰으로 써보며 잡은 함정들이다. 흉내로는 안 잡혔다.

- **`Modal` 을 직접 만들지 않는다. `Sheet` 를 쓴다.** 안드로이드 edge-to-edge 에서 자리가 어긋나고, 뒤를 덮는 `Pressable` 이 창 안의 단추를 가로챈다. 함정과 해법이 `components/Sheet.tsx` 주석에 다 있다.
- **레이아웃 움직임(reanimated 의 `entering`/`exiting`)은 쓰지 않는다.** 그려지는 자리와 눌리는 자리가 어긋난다. 움직임은 네이티브 `animationType` 에 맡긴다. 손짓이 직접 끄는 값(사진 확대)은 괜찮다.
- **대화 목록은 뒤집힌(`inverted`) `FlatList` 다.** 가장 새 말이 0번이고 바닥이 곧 0이다. 그래서 키보드나 도구 줄로 목록 키가 바뀌어도 보던 아래쪽이 그대로 따라온다. 날짜 구분선은 말풍선 칸 안에 넣지 않고 **따로 한 칸**으로 둔다. 안에 넣으면 순서가 뒤집혀 말 아래에 뜬다.
- **키보드는 두 운영체제 모두 `KeyboardAvoidingView behavior="padding"`.** 안드로이드 edge-to-edge 에서는 `adjustResize` 가 창을 안 줄여 키보드가 입력칸을 덮었다.
- **뜻이 같은 표시를 두 번 하지 않는다.** 이름 옆 점이 연결 상태를 말하므로 그 밑에 "연결됨" 을 또 적지 않는다. 대신 배터리나 마지막으로 이어져 있던 때를 적는다.
- 안 되는 기능의 단추를 숨기지 않는다. 눌렀을 때 왜 안 되는지 적는다. 숨기면 "있긴 한가" 싶고, 눌러도 조용하면 "고장났나" 싶다.

## 조립하는 곳

모든 부품을 어디서 끼울지는 `composition/container.ts` 한 곳에서 정한다.
이 파일만이 "지금 Wi-Fi를 쓸지 블루투스를 쓸지"를 안다.

```ts
// composition/container.ts — 느낌만
const transport = new CompositeTransport([
  new WifiLink(role),              // 집에서
  new BleMessageTransport(role),   // 비행기에서. 사실상 이것
])
```

`CompositeTransport` 는 열 수 있는 길을 **다 열어두고** 먼저 진짜로 이어지는 쪽을 쓴다. 처음에 못 연 길도 지켜보다가 스스로 이어지면 옮긴다. 이미 이어져 있으면 다시 열어도 건드리지 않는다.

### 화면은 어떻게 받아 쓰나

화면도 결국 저장소와 연결이 필요하다. 그런데 구현을 직접 가져오면 층 구분이 무너진다. 그래서 **`composition`을 한 번 거친다.**

```
presentation ──▶ composition ──▶ infrastructure
```

`composition/services.ts`가 화면이 쓸 것들(진동, 알림, 블루투스 상태 읽기, 배터리 …)을 모아 내보내고, 화면은 거기서 받는다. **`composition`에는 조립만 있고 판단이 없어야 한다.**

## 두 기기가 주고받는 말

연결 방식이 달라도 **주고받는 내용의 형식은 같다.** 그래야 Wi-Fi에서 블루투스로 갈아타도 코드가 그대로다.

| 무엇 | 어디 |
|---|---|
| **봉투의 생김새** — 무엇을 주고받는가 | `application/ports/Envelope.ts` |
| **바이트로 바꾸고 형식을 검사하는 일** | `infrastructure/transport/protocol/` |

형식 검사는 `zod`로 하고 받을 때마다 확인한다. **모르는 항목은 버리고 읽는다.** 예전 앱이 여섯 자리 코드를 실어 보내도, 새 앱이 상태 메시지나 비행 전체 길이를 실어 보내도 양쪽 다 그대로 붙는다. 한쪽만 업데이트했을 때 대화가 통째로 안 되는 일을 막는다.

자세한 규약은 [04-transport-spec.md](./04-transport-spec.md)에 있다.

## 코드가 규칙을 어기지 못하게 막기

사람이 조심하는 것으로는 부족하다. 도구로 막는다.

- **의존 방향 검사** `pnpm check:deps`: `domain`이 바깥을 import 하면 걸린다.
- **네이티브 모듈 검사** `pnpm check:native`: 켜자마자 도는 길에 네이티브 `import` 가 있으면 걸린다.
- **색 검사** `pnpm check:tokens`: 화면 코드에 `#RRGGBB` 가 있으면 걸린다.
- **타입 엄격 모드**: `strict: true`에 더해 `noUncheckedIndexedAccess`까지 켠다.
- **커밋 전 자동 검사**: lefthook으로 커밋할 때 검사와 타입을 돌린다.

## 관련 문서

- 제품이 무엇인지: [01-product-spec.md](./01-product-spec.md)
- 왜 이 기술인지: [02-tech-decisions.md](./02-tech-decisions.md)
- 연결 규약: [04-transport-spec.md](./04-transport-spec.md)
- 테스트: [09-testing.md](./09-testing.md)
