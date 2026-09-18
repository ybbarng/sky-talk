import { describe, expect, it, vi } from 'vitest'
import { show } from '../support/screen'

/**
 * 메시지 입력칸.
 *
 * 도구(콕 찌르기·이모티콘·사진·낙서)는 **접어둔다.** 다 펼쳐두면
 * 입력칸이 손가락 두 개 폭밖에 안 남았다. 더보기를 누르면 펼쳐지고,
 * 하나를 고르거나 글을 쓰기 시작하면 다시 접힌다.
 *
 * 여기서 보는 것은 **펼쳐지는가, 접히는가, 골랐을 때 그 일이 되는가**다.
 * 폭은 눈으로 봐야 한다. (docs/09-testing.md)
 */

const { MessageInput } = await import('@/presentation/components/chat/MessageInput')
const { ThemeProvider } = await import('@/presentation/theme/ThemeProvider')

function open(overrides: Partial<Parameters<typeof MessageInput>[0]> = {}) {
  const handlers = {
    onSend: vi.fn(),
    onNudge: vi.fn(),
    onStickers: vi.fn(),
    onPhoto: vi.fn(),
    onDoodle: vi.fn(),
    ...overrides,
  }

  return {
    handlers,
    screen: show(
      <ThemeProvider>
        <MessageInput {...handlers} />
      </ThemeProvider>,
    ),
  }
}

describe('도구를 접고 펼친다', () => {
  it('처음에는 도구가 접혀 있다', async () => {
    const view = await open().screen

    // 입력칸 옆에는 더보기 하나뿐이다
    expect(view.hasText('콕 찌르기')).toBe(false)
    expect(view.hasText('낙서')).toBe(false)
    expect(view.disabled('도구 더보기')).toBe(false)
  })

  it('더보기를 누르면 도구 네 개가 펼쳐진다', async () => {
    const view = await open().screen

    await view.press('도구 더보기')

    for (const tool of ['콕 찌르기', '이모티콘', '사진', '낙서']) {
      expect(view.disabled(tool)).toBe(false)
    }
  })

  it('펼친 채로 다시 누르면 접힌다', async () => {
    const view = await open().screen

    await view.press('도구 더보기')
    await view.press('도구 접기')

    expect(view.hasText('콕 찌르기')).toBe(false)
  })

  it('도구를 고르면 그 일을 하고 접힌다', async () => {
    const { handlers, screen } = open()
    const view = await screen

    await view.press('도구 더보기')
    await view.press('낙서')

    expect(handlers.onDoodle).toHaveBeenCalledTimes(1)
    expect(view.hasText('콕 찌르기')).toBe(false)
  })

  it('글을 쓰기 시작하면 접힌다', async () => {
    // 글이 본업이다. 쓰기 시작했으면 도구는 방해다.
    const view = await open().screen

    await view.press('도구 더보기')
    await view.type('메시지', '안녕')

    expect(view.hasText('콕 찌르기')).toBe(false)
  })
})

describe('글을 보낸다', () => {
  it('빈 글은 보내기가 잠겨 있다', async () => {
    const view = await open().screen

    expect(view.disabled('보내기')).toBe(true)
  })

  it('글을 쓰면 보내기가 풀리고 누르면 나간다', async () => {
    const { handlers, screen } = open()
    const view = await screen

    await view.type('메시지', '안녕')
    await view.press('보내기')

    expect(handlers.onSend).toHaveBeenCalledWith('안녕')
  })
})
