import type { ExpoConfig } from 'expo/config'

/**
 * 앱 설정. 여기서 ios/ 와 android/ 폴더가 만들어진다.
 * 네이티브를 고쳐야 할 일이 생기면 손으로 만지지 말고 여기 플러그인으로 처리한다.
 * (docs/08-build-release.md 참고)
 */
const config: ExpoConfig = {
  name: 'SkyTalk',
  slug: 'sky-talk',
  scheme: 'skytalk',
  version: '0.1.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',

  // 아이콘은 assets/icon/*.svg 가 원본이고 `pnpm icons:generate` 가 뽑는다.
  // generated 폴더는 저장소에 넣지 않는다. (docs/07-design-system.md 7장)
  icon: './assets/icon/generated/icon.png',
  backgroundColor: '#0B1020',

  ios: {
    bundleIdentifier: 'com.ybbarng.skytalk',
    supportsTablet: false,
    infoPlist: {
      // 소리가 흐르는 동안에는 앱이 뒤로 가도 살아 있어야 한다.
      // 화면을 끄고도 대화가 이어지려면 필요하다. (docs/06-voice-video-spec.md 4장)
      UIBackgroundModes: ['audio', 'bluetooth-central', 'bluetooth-peripheral'],

      NSMicrophoneUsageDescription: '상대에게 목소리를 전하려면 마이크가 필요해요.',
      NSCameraUsageDescription: '영상 통화로 얼굴을 보여주려면 카메라가 필요해요.',
      NSBluetoothAlwaysUsageDescription:
        'Wi-Fi를 쓸 수 없을 때 블루투스로 메시지를 주고받아요.',
      NSPhotoLibraryUsageDescription: '사진을 골라 보내려면 앨범이 필요해요.',
      NSLocalNetworkUsageDescription: '같은 Wi-Fi에 있는 상대 폰을 찾으려면 필요해요.',
      // 기기를 찾기 위해 사설망에 알리는 서비스 이름
      NSBonjourServices: ['_skytalk._tcp'],
    },
  },

  android: {
    package: 'com.ybbarng.skytalk',
    adaptiveIcon: {
      foregroundImage: './assets/icon/generated/icon-foreground.png',
      backgroundImage: './assets/icon/generated/icon-background.png',
      monochromeImage: './assets/icon/generated/icon-monochrome.png',
    },
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.CHANGE_WIFI_MULTICAST_STATE',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.CAMERA',
      // `BLUETOOTH_SCAN` 은 **여기 적지 않는다.** 아래 `react-native-ble-plx`
      // 플러그인이 `neverForLocation` 표시를 붙여서 넣어주는데, 그 플러그인은
      // 이미 있으면 건너뛴다. 여기 적어두면 표시 없는 쪽이 먼저 들어가고
      // **안드로이드 12 부터 아무것도 못 찾는다.**
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      // 뒤로 가도 연결을 지키는 서비스. 하는 일이 "곁에 있는 다른
      // 기기와 주고받기" 라 이 갈래를 쓴다. (modules/stay-alive)
      'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
      'android.permission.WAKE_LOCK',
    ],
  },

  // `expo install` 은 플러그인을 app.json 에 적으려 한다.
  // 설정이 두 곳으로 흩어지지 않게 여기로 옮기고 app.json 은 지운다.
  plugins: [
    'expo-router',
    [
      // 음성 메시지를 녹음하고 듣는다.
      //
      // **인터넷을 쓰지 않는다.** 기기 안에서 녹음해 파일로 만들고,
      // 그 파일을 사진과 같은 길(조각내어 보내기)로 나른다.
      'expo-audio',
      {
        microphonePermission: '음성 메시지를 녹음하려면 마이크가 필요해요.',
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/icon/generated/splash.png',
        imageWidth: 180,
        backgroundColor: '#0B1020',
        // 밝은 화면에서도 같은 그림을 쓰되 바탕만 바꾼다
        dark: { backgroundColor: '#0B1020' },
      },
    ],
    'expo-sqlite',
    // 대화를 꺼내 두고 다시 불러오는 데 쓴다 (T19)
    'expo-sharing',
    [
      'expo-image-picker',
      {
        photosPermission: '사진을 골라 보내려면 앨범이 필요해요.',
        cameraPermission: '사진을 찍어 보내려면 카메라가 필요해요.',
      },
    ],
    [
      // 핫스팟을 못 쓸 때 남는 길이다.
      //
      // **`neverForLocation` 이 없으면 안드로이드 12 부터 아무것도 못
      // 찾는다.** 블루투스 찾기를 위치 정보로 보기 때문에, 이 표시가
      // 없으면 위치 권한까지 받고 위치 서비스도 켜져 있어야 한다.
      // 오류도 안 나고 결과만 비어서 온다. 우리는 위치를 알아내지
      // 않으므로 표시해두는 것이 맞다.
      //
      // `isBackgroundEnabled` 는 화면이 꺼져도 찾기를 이어가게 한다.
      'react-native-ble-plx',
      {
        neverForLocation: true,
        isBackgroundEnabled: true,
        modes: ['central', 'peripheral'],
      },
    ],
    // 홈 화면 이름은 SkyTalk. 속 이름(패키지·번들)은 그대로다. 바꾸면 새 앱이 된다.
    './plugins/withDisplayName',
    // **맨 뒤여야 한다.** `expo-notifications` 가 붙여둔 원격 푸시 권한을
    // 떼는 일이라, 붙인 다음에 와야 지워진다.
    './plugins/withoutPushEntitlement',
  ],

  experiments: {
    typedRoutes: true,
  },
}

export default config
