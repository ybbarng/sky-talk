import { type RefObject, useCallback, useRef } from 'react'
import type {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native'
import { isNearBottom } from '../components/chat/listBottom'

/**
 * 대화 목록을 바닥에 붙여둔다.
 *
 * ## 왜 마지막 말이 잘렸나
 *
 * 전에는 내용 크기가 바뀔 때 한 번만 끝으로 내렸다. 두 가지가 빠졌다.
 *
 *   · **목록 자체의 키가 줄 때.** 도구 줄이 펼쳐지거나 이모티콘 서랍이
 *     열리면 목록이 그만큼 짧아지는데, 내용은 그대로라 아무 일도 안
 *     일어났다. 그래서 마지막 말의 아랫부분이 가려졌다.
 *   · **그림이 든 말풍선.** 이모티콘과 사진은 한 프레임 뒤에 키가
 *     확정된다. 첫 번째 끝내리기가 그 전에 돌아서 조금 못 미쳤다.
 *
 * 그래서 목록의 키가 바뀔 때도 내리고, 한 프레임 뒤에 한 번 더 내린다.
 *
 * ## 옛 말을 보고 있으면 안 끌어내린다
 *
 * 바닥 근처에 있을 때만 따라 내려간다. 위로 올려 옛 말을 읽는 중에
 * 새 말이 왔다고 끌어내리면 읽던 자리를 잃는다. **내가 보낸 말은
 * 예외다.** 어디를 보고 있었든 내가 쓴 말은 보여야 한다.
 */
export function useStickToBottom<T>(listRef: RefObject<FlatList<T> | null>) {
  const pinned = useRef(true)

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: false })

    // 그림이 든 말풍선은 한 프레임 뒤에 키가 확정된다. 한 번 더 내린다.
    requestAnimationFrame(() => {
      if (pinned.current) listRef.current?.scrollToEnd({ animated: false })
    })
  }, [listRef])

  const follow = useCallback(() => {
    if (pinned.current) scrollToEnd()
  }, [scrollToEnd])

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    pinned.current = isNearBottom(
      contentOffset.y,
      contentSize.height,
      layoutMeasurement.height,
    )
  }, [])

  const onLayout = useCallback(
    (_event: LayoutChangeEvent) => {
      follow()
    },
    [follow],
  )

  /** 내가 보냈다. 어디를 보고 있었든 내려간다 */
  const pin = useCallback(() => {
    pinned.current = true
    scrollToEnd()
  }, [scrollToEnd])

  return {
    onScroll,
    onContentSizeChange: follow,
    onLayout,
    pin,
    /** 바닥 근처인지 제때 알려면 이 정도는 받아야 한다 */
    scrollEventThrottle: 16,
  }
}
