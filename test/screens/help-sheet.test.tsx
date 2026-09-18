import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { show } from '../support/screen'

/**
 * 설명 창을 닫을 수 있는가.
 *
 * **못 닫으면 거기서 갇힌다.** 말을 나눌 수 없는 두 사람에게 이건 앱이
 * 죽은 것과 같다. 물음표는 이 앱에서 안내를 대신하는 장치라 여기저기
 * 붙어 있고, 그만큼 갇힐 자리도 많다.
 *
 * 실제로 설명 창에서 "알겠어요" 와 닫기 단추가 둘 다 안 먹었다.
 * 바깥을 누르면 닫혔으니 **창 안쪽의 누름만 안 먹은 것**이다.
 *
 * (docs/09-testing.md)
 */

const { HelpTip } = await import('@/presentation/components/HelpTip')
const { ThemeProvider } = await import('@/presentation/theme/ThemeProvider')

function open() {
  return show(
    <ThemeProvider>
      <HelpTip topic="linkKind" />
    </ThemeProvider>,
  )
}

describe('설명을 열고 닫는다', () => {
  it('처음에는 설명이 안 보인다', async () => {
    const view = await open()

    expect(view.hasText('알겠어요')).toBe(false)
  })

  it('물음표를 누르면 설명이 뜬다', async () => {
    const view = await open()

    await view.press('설명 보기')

    expect(view.hasText('알겠어요')).toBe(true)
  })

  it('알겠어요를 누르면 닫힌다', async () => {
    // **여기가 핵심이다.** 이게 안 되면 갇힌다.
    const view = await open()

    await view.press('설명 보기')
    await view.press('알겠어요')

    expect(view.hasText('알겠어요')).toBe(false)
  })

  it('닫기 단추를 눌러도 닫힌다', async () => {
    const view = await open()

    await view.press('설명 보기')
    await view.press('닫기')

    expect(view.hasText('알겠어요')).toBe(false)
  })
})

describe('배경이 시트를 덮지 않는다', () => {
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/presentation/components/Sheet.tsx',
    ),
    'utf8',
  )

  it('시트 안에서 레이아웃 움직임을 쓰지 않는다', () => {
    /*
      **이것이 갇히던 진짜 원인이었다.**

      `reanimated` 의 들고 나는 움직임(`entering`/`exiting`)을 `Modal`
      안에서 쓰면, **그려지는 자리와 눌리는 자리가 어긋난다.** 뷰는
      옮겨졌는데 터치 판정은 원래 자리를 쓴다. 눈에 보이는 곳을 눌러도
      아무 일이 없다.

      기기에서 확인한 값이 이렇다. 움직임을 걷어내자 같은 단추의 자리가
      `540,1866` 에서 `540,2087` 로 바뀌었다. 220 픽셀이 어긋나 있었다.

      움직임 없이 누르면(합성 터치) 통과하고 **손가락만 걸린다.**
      2 픽셀만 움직여도 재현된다.

      모달 자체의 흐려짐(`animationType="fade"`)은 운영체제가 해주는
      것이라 안전하다.
    */
    expect(source).not.toMatch(/entering=/)
    expect(source).not.toMatch(/exiting=/)
    expect(source).toMatch(/animationType="fade"/)
  })

  it('배경 닫기가 화면 전체를 덮지 않는다', () => {
    /*
      **이건 누르는 흉내로 못 잡는다.**

      여기 시험들은 `onPress` 를 직접 부르므로 무엇이 위에 있든 통과한다.
      실제 기기에서도 `adb` 로 누르면 통과한다. 합성 터치는 움직임이
      없어서 그냥 지나가기 때문이다. **손가락만 걸린다.**

      그래서 글자로 본다. 배경이 `absoluteFill` 로 화면을 덮으면
      시트 안의 단추가 하나도 안 먹고, 설명을 열었다가 갇힌다.
    */
    expect(source).not.toMatch(/backdropTouch:\s*StyleSheet\.absoluteFill/)
    expect(source).toMatch(/above:\s*\{\s*flex:\s*1\s*\}/)
  })
})
