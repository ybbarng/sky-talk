import { describe, expect, it } from 'vitest'
import { alertFor, awayReminder } from '../copy/link'
import {
  BLUETOOTH_OFF_AFTER_MS,
  decideNotice,
  LINK_LOST_AFTER_MS,
  type LinkWatch,
} from './linkNotice'

const base: LinkWatch = {
  role: 'host',
  connected: false,
  bluetoothOn: true,
  downForMs: 0,
  appActive: false,
  everConnected: true,
  toldLost: false,
}

function notice(over: Partial<LinkWatch>): string {
  return decideNotice({ ...base, ...over }).kind
}

describe('끊겼다고 바로 알리지 않는다', () => {
  it('잠깐 끊긴 것은 넘어간다', () => {
    // 화면이 꺼지거나 벽에 가리면 몇 초 만에 돌아온다.
    // 그때마다 울리면 세 시간 내내 폰이 운다.
    expect(notice({ downForMs: 5_000 })).toBe('none')
    expect(notice({ downForMs: LINK_LOST_AFTER_MS - 1 })).toBe('none')
  })

  it('한참 지나도 안 돌아오면 알린다', () => {
    expect(notice({ downForMs: LINK_LOST_AFTER_MS })).toBe('lost')
  })

  it('한 번 알렸으면 또 알리지 않는다', () => {
    expect(notice({ downForMs: LINK_LOST_AFTER_MS * 5, toldLost: true })).toBe('none')
  })
})

describe('사람이 켜야 풀리는 일은 더 빨리 알린다', () => {
  it('망에서 벗어났으면 금방 알린다', () => {
    // 핫스팟이 꺼진 것은 아무리 기다려도 저절로 안 돌아온다.
    expect(notice({ bluetoothOn: false, downForMs: BLUETOOTH_OFF_AFTER_MS })).toBe(
      'bluetooth-off',
    )
  })

  it('그래도 아주 잠깐은 기다려준다', () => {
    // 비행기 모드를 껐다 켜는 사이에도 잠깐 벗어난다.
    expect(notice({ bluetoothOn: false, downForMs: 3_000 })).toBe('none')
  })

  it('다른 이유보다 먼저 알린다', () => {
    expect(BLUETOOTH_OFF_AFTER_MS).toBeLessThan(LINK_LOST_AFTER_MS)
  })

  it('망 상태를 아직 못 읽었으면 핫스팟 탓으로 몰지 않는다', () => {
    // 모르는 것을 "꺼졌다" 로 바꾸면 멀쩡한 사람에게 핫스팟을
    // 켜라고 하게 된다. 무엇을 눌러야 할지 모른다.
    expect(notice({ bluetoothOn: null, downForMs: BLUETOOTH_OFF_AFTER_MS })).toBe('none')
    expect(notice({ bluetoothOn: null, downForMs: LINK_LOST_AFTER_MS })).toBe('lost')
  })
})

describe('알리지 않아야 할 때', () => {
  it('앱을 보고 있으면 안 띄운다', () => {
    // 화면에 이미 "연결이 끊겼어요" 가 떠 있다.
    expect(notice({ appActive: true, downForMs: LINK_LOST_AFTER_MS * 10 })).toBe('none')
    expect(
      notice({ appActive: true, bluetoothOn: false, downForMs: BLUETOOTH_OFF_AFTER_MS }),
    ).toBe('none')
  })

  it('한 번도 안 붙어봤으면 끊긴 게 아니다', () => {
    // 첫 연결을 기다리는 중이다. 이걸 "끊겼다" 고 하면 겁만 준다.
    expect(notice({ everConnected: false, downForMs: LINK_LOST_AFTER_MS * 10 })).toBe(
      'none',
    )
    expect(notice({ everConnected: false, bluetoothOn: false, downForMs: 60_000 })).toBe(
      'none',
    )
  })
})

describe('다시 붙었을 때', () => {
  it('끊겼다고 알린 적이 있어야 알린다', () => {
    expect(notice({ connected: true, toldLost: true })).toBe('back')
  })

  it('안 알렸으면 조용히 넘어간다', () => {
    // 사람은 끊긴 줄도 몰랐다. "다시 연결됐어요" 만 뜨면 어리둥절하다.
    expect(notice({ connected: true, toldLost: false })).toBe('none')
  })

  it('보고 있어도 알린다', () => {
    // 끊겼다는 알림을 이미 받았으니 풀렸다는 것도 알아야 한다.
    expect(notice({ connected: true, toldLost: true, appActive: true })).toBe('back')
  })
})

describe('잠금 화면에 뜨는 글', () => {
  it('여는 쪽에는 블루투스를 켜라고 한다', () => {
    const alert = alertFor('bluetooth-off', 'host', '여자친구')

    expect(alert?.title).toBe('블루투스가 꺼졌어요')
    expect(alert?.body).toContain('여자친구가')
  })

  it('붙는 쪽에도 블루투스를 켜라고 한다', () => {
    // 두 폰 다 할 일이 같다. 블루투스를 켜면 된다.
    const alert = alertFor('bluetooth-off', 'guest', '남자친구')

    expect(alert?.title).toContain('블루투스')
    expect(alert?.body).not.toContain('핫스팟')
  })

  it('이름을 모르면 "상대" 라고 쓴다', () => {
    expect(alertFor('back', 'host', null)?.body).toContain('상대가')
  })

  it('조사가 어긋나지 않는다', () => {
    for (const name of ['지민', '여자친구', '짝꿍', null]) {
      for (const kind of ['bluetooth-off', 'lost', 'back'] as const) {
        for (const role of ['host', 'guest'] as const) {
          const alert = alertFor(kind, role, name)
          const text = `${alert?.title}\n${alert?.body}`

          for (const broken of ['구이 ', '민가', '꿍가', '대이']) {
            expect(text).not.toContain(broken)
          }
        }
      }
    }
  })

  it('알릴 것이 없으면 아무것도 안 만든다', () => {
    expect(alertFor('none', 'host', '지민')).toBeNull()
  })

  it('한참 손을 놓았을 때는 단정하지 않는다', () => {
    // 앱이 잠든 것뿐일 수도 있다. "끊겼다" 고 하면 겁만 준다.
    // 다만 그동안 말이 안 들어오는 건 사실이라 열어보라고는 한다.
    for (const role of ['host', 'guest'] as const) {
      const alert = awayReminder(role, '지민')

      expect(alert.title).not.toContain('끊')
      expect(alert.body).toContain('앱을 열면')
    }
  })

  it('여는 쪽에는 블루투스가 꺼졌을 수 있다고 알린다', () => {
    // 안드로이드는 붙은 기기가 없으면 얼마 뒤 핫스팟을 저 혼자 끈다.
    // 그러면 아이폰이 앱을 열어도 못 들어온다.
    expect(awayReminder('host', '여자친구').body).toContain('블루투스')
    expect(awayReminder('guest', '남자친구').body).not.toContain('블루투스')
  })

  it('쓸 말이 비어 있지 않다', () => {
    for (const kind of ['bluetooth-off', 'lost', 'back'] as const) {
      for (const role of ['host', 'guest'] as const) {
        const alert = alertFor(kind, role, '지민')

        expect(alert?.title.length).toBeGreaterThan(0)
        expect(alert?.body.length).toBeGreaterThan(0)
      }
    }
  })
})
