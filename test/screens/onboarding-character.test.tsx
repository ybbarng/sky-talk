import { beforeEach, describe, expect, it, vi } from 'vitest'
import { show } from '../support/screen'

/**
 * 캐릭터와 이름 정하는 화면.
 *
 * **여기서 막히면 대화를 시작조차 못 한다.** 말을 나눌 수 없는 두 사람이
 * 각자 화면만 보고 넘어가야 하는 자리다.
 *
 * 실제로 여기서 막혔다. 이름을 넣어도 "다음" 이 안 눌렸고, **폰에 깔아본
 * 뒤에야 알았다.** 도메인과 응용 계층은 1600 개 넘게 시험해두고 정작
 * 사람이 만지는 화면은 한 번도 안 시험한 탓이다.
 *
 * (docs/09-testing.md)
 */

const pushed = vi.hoisted(() => ({ to: [] as string[] }))

/**
 * 기기에 남기는 저장소를 흉내 낸다.
 *
 * 진짜는 `expo-sqlite/kv-store` 라 맥에서 안 돈다. **여기서 보려는 것은
 * 저장이 되는가가 아니라 화면이 넘어가는가**라, 기억만 해두면 된다.
 */
const storage = vi.hoisted(() => ({ answers: true }))

vi.mock('expo-sqlite/kv-store', () => {
  const box = new Map<string, string>()
  const stall = () => new Promise<never>(() => undefined)

  return {
    default: {
      getItem: async (key: string) => {
        if (!storage.answers) return stall()
        return box.get(key) ?? null
      },
      setItem: async (key: string, value: string) => {
        if (!storage.answers) return stall()
        box.set(key, value)
      },
      removeItem: async (key: string) => {
        box.delete(key)
      },
    },
  }
})

vi.mock('expo-router', () => ({
  router: {
    push: (path: string) => pushed.to.push(path),
    replace: (path: string) => pushed.to.push(path),
    back: () => undefined,
  },
}))

const { default: ChooseCharacter } = await import('../../app/onboarding/character')
const { ThemeProvider } = await import('@/presentation/theme/ThemeProvider')
const { useSetupStore } = await import('@/presentation/stores/useSetupStore')

function open() {
  return show(
    <ThemeProvider>
      <ChooseCharacter />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  pushed.to.length = 0
  storage.answers = true
  useSetupStore.setState({ profile: null })
})

describe('이름을 넣으면 넘어간다', () => {
  it('이름이 없으면 다음이 잠겨 있다', async () => {
    const view = await open()

    // 이름 없이 넘어가면 상대 화면에 이름 없는 사람이 뜬다
    expect(view.disabled('다음')).toBe(true)
  })

  it('내 이름만 넣어도 넘어간다', async () => {
    const view = await open()

    await view.type('예: 지민', '용배')

    // **상대 별명은 안 적어도 된다.** 이어지면 상대가 보내준 이름을 쓴다.
    expect(view.disabled('다음')).toBe(false)

    await view.press('다음')

    await vi.waitFor(() => expect(pushed.to).toContain('/onboarding/connect'))
  })

  it('별명까지 넣어도 넘어간다', async () => {
    const view = await open()

    await view.type('예: 지민', '용배')
    await view.press('여자친구')
    await view.press('다음')

    await vi.waitFor(() => expect(pushed.to).toContain('/onboarding/connect'))
  })

  it('넣은 이름이 저장된다', async () => {
    const view = await open()

    await view.type('예: 지민', '용배')
    await view.press('다음')

    await vi.waitFor(() => {
      expect(useSetupStore.getState().profile?.displayName).toBe('용배')
    })
  })
})

describe('저장소가 답을 안 해도 넘어간다', () => {
  it('저장이 멎어도 다음 화면으로 간다', async () => {
    // **실제로 여기서 앱을 통째로 못 썼다.**
    //
    // 저장이 끝나기를 기다린 뒤에 넘어가게 해뒀는데, 저장이 답을 안
    // 하니 거기서 멎었다. 버튼만 안 먹는 것처럼 보이고 오류도 없었다.
    // 폰에 깔아본 뒤에야 알았다.
    storage.answers = false

    const view = await open()
    await view.type('예: 지민', '용배')
    await view.press('다음')

    await vi.waitFor(() => expect(pushed.to).toContain('/onboarding/connect'))
  })
})
