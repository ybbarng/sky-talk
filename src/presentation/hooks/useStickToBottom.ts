import { type RefObject, useCallback, useRef } from 'react'
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native'
import { isNearBottom } from '../components/chat/listBottom'

/**
 * 대화 목록을 바닥에 붙여둔다. **목록은 뒤집혀 있다.**
 *
 * 뒤집힌 목록에서는 바닥이 곧 0 이다. 그래서 도구 줄이 펼쳐지거나
 * 키보드가 올라와 목록이 짧아져도 보던 아래쪽이 그대로 따라오고, 새 말은
 * 바닥(0)에 있을 때만 보인다. 위로 올려 옛 말을 읽는 중이면 그 자리가
 * 그대로다. 예전에는 위에서부터 그리고 매번 끝으로 내렸는데, 그림이 든
 * 말풍선과 도구 줄 여닫기가 겹치면 조금씩 못 미쳐 마지막 말이 잘렸다.
 *
 * **내가 보낸 말은 예외다.** 어디를 보고 있었든 내가 쓴 말은 보여야 한다.
 */
export function useStickToBottom<T>(listRef: RefObject<FlatList<T> | null>) {
  const pinned = useRef(true)

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [listRef])

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    // 뒤집힌 목록이라 0 이 바닥이다. 내용·화면 크기는 볼 필요가 없다.
    pinned.current = isNearBottom(
      contentSize.height - layoutMeasurement.height - contentOffset.y,
      contentSize.height,
      layoutMeasurement.height,
    )
  }, [])

  /** 내가 보냈다. 어디를 보고 있었든 내려간다 */
  const pin = useCallback(() => {
    pinned.current = true
    scrollToEnd()
  }, [scrollToEnd])

  const onLayout = useCallback((_event: LayoutChangeEvent) => {
    // 뒤집힌 목록은 키가 바뀌어도 바닥이 그대로다. 할 일이 없다.
  }, [])

  return {
    onScroll,
    onContentSizeChange: () => undefined,
    onLayout,
    pin,
    scrollEventThrottle: 16,
  }
}
