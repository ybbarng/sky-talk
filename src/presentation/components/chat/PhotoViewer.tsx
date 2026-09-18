import { Image, Modal, useWindowDimensions } from 'react-native'
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../../theme/ThemeProvider'

/**
 * 다 받은 사진을 화면 가득 본다.
 *
 * 두 손가락으로 벌리면 커지고, 커진 채로 끌면 움직인다. 한 번 누르거나
 * 뒤로 가면 닫힌다. 손을 떼었을 때 원래보다 작으면 원래 크기로 돌아온다.
 *
 * `Modal` 안에서는 손짓을 따로 받아야 한다. 바깥의 손짓 뿌리가 창 안까지
 * 안 들어와서 `GestureHandlerRootView` 를 하나 더 둔다.
 *
 * 움직임은 손짓이 직접 끄는 값이라 그리는 자리와 눌리는 자리가 어긋나는
 * 레이아웃 움직임(들고 나는 효과)과는 다르다.
 */
interface PhotoViewerProps {
  /** 보여줄 파일 자리. 없으면 닫혀 있다 */
  uri: string | null
  onClose: () => void
}

export function PhotoViewer({ uri, onClose }: PhotoViewerProps) {
  const theme = useTheme()
  const { width, height } = useWindowDimensions()

  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)

  const reset = () => {
    'worklet'
    scale.value = withTiming(1)
    x.value = withTiming(0)
    y.value = withTiming(0)
    savedScale.value = 1
    savedX.value = 0
    savedY.value = 0
  }

  const pinch = Gesture.Pinch()
    .onUpdate(event => {
      scale.value = Math.max(0.5, Math.min(6, savedScale.value * event.scale))
    })
    .onEnd(() => {
      if (scale.value < 1) {
        reset()
        return
      }
      savedScale.value = scale.value
    })

  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate(event => {
      // 원래 크기일 때는 끌어도 안 움직인다. 그때는 닫는 손짓과 헷갈린다.
      if (savedScale.value <= 1) return
      x.value = savedX.value + event.translationX
      y.value = savedY.value + event.translationY
    })
    .onEnd(() => {
      savedX.value = x.value
      savedY.value = y.value
    })

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_event, success) => {
      if (success) runOnJS(onClose)()
    })

  // 벌리기와 끌기는 같이 되고, 누르기는 그 둘과 겨룬다
  const gesture = Gesture.Race(Gesture.Simultaneous(pinch, pan), tap)

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }))

  return (
    <Modal
      visible={uri !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={() => reset()}
    >
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <GestureDetector gesture={gesture}>
          <Animated.View
            style={[{ width, height, justifyContent: 'center' }, animated]}
            accessibilityRole="image"
            accessibilityLabel="사진. 두 손가락으로 벌리면 커지고, 한 번 누르면 닫혀요"
          >
            {uri !== null && (
              <Image source={{ uri }} resizeMode="contain" style={{ width, height }} />
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  )
}
