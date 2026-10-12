import { describe, expect, it } from 'vitest'
import { copyFor, longHintFor } from './connecting'

/**
 * 연결 화면 글.
 *
 * **여자친구는 이 앱이 어떻게 돌아가는지 모른다.** 떨어져 앉아 물어볼
 * 수도 없다. 그래서 여기 있는 글이 유일한 설명이다.
 *
 * 핫스팟 이야기는 하지 않는다. 비행기 모드에서는 안 켜지므로
 * (docs/02-tech-decisions.md D1) 자리에 앉아 그 안내를 읽으면
 * 잠긴 메뉴만 들여다보게 된다.
 */

describe('블루투스를 켜라고 말할 때', () => {
  it('두 쪽 다 할 일이 같다', () => {
    // 예전에는 한쪽은 핫스팟, 한쪽은 Wi-Fi 로 할 일이 달랐다.
    // 이제 둘 다 블루투스만 켜면 된다.
    expect(copyFor('need-hotspot', '지민').action).toBe('블루투스 켜러 가기')
    expect(copyFor('need-wifi', '지민').action).toBe('블루투스 켜러 가기')
  })

  it('비행기 모드에서도 켤 수 있다고 알려준다', () => {
    // **이걸 모르면 포기한다.** 비행기 모드를 켰으니 아무것도 안 될
    // 거라고 지레 짐작하기 쉽다.
    for (const phase of ['need-hotspot', 'need-wifi'] as const) {
      expect(copyFor(phase, '지민').detail).toContain('비행기 모드')
    }
  })

  it('이름을 알면 그 이름을 쓴다', () => {
    const copy = copyFor('need-wifi', '지민')

    expect(copy.detail).toContain('지민')
    expect(copy.detail).not.toContain('undefined')
  })

  it('핫스팟이나 Wi-Fi 를 켜라고 하지 않는다', () => {
    for (const phase of ['need-hotspot', 'need-wifi', 'waiting-for-peer'] as const) {
      const copy = copyFor(phase, '지민')
      const text = `${copy.title}\n${copy.detail}\n${copy.action ?? ''}`

      expect(text).not.toContain('핫스팟')
      expect(text).not.toContain('Wi-Fi')
    }
  })
})

describe('오래 걸릴 때 덧붙이는 도움말', () => {
  it('블루투스를 켜라고 알려준다', () => {
    const hint = longHintFor('guest', '지민')

    expect(hint.lines.join('\n')).toContain('블루투스')
  })

  it('블루투스가 안 닿으면 두 쪽 다 같은 기내 Wi-Fi 를 권한다', () => {
    // 2026-09 비행에서 자리가 멀어 블루투스가 한 번도 제대로 안 이어졌다
    for (const role of ['host', 'guest'] as const) {
      expect(longHintFor(role, '지민').lines.join('\n')).toContain('기내 Wi-Fi')
    }
  })

  it('아이폰 쪽에는 Wi-Fi 창과 로컬 네트워크 물음에 무엇을 누를지 적는다', () => {
    // 잘못 누르면 Wi-Fi 로는 영영 안 이어진다
    const text = longHintFor('guest', '지민').lines.join('\n')

    expect(text).toContain('인터넷 없이 사용')
    expect(text).toContain('허용')
  })

  it('이름을 몰라도 자리를 비워두지 않는다', () => {
    const hint = longHintFor('guest', '지민')
    const text = hint.lines.join('\n')

    expect(text).not.toContain('{peer.name}')
    expect(text).not.toContain('undefined')
  })

  it('누구를 가리키는지 이름으로 바꿔 넣는다', () => {
    const hint = longHintFor('host', '지민')
    const text = hint.lines.join('\n')

    expect(text).toContain('지민은')
    expect(text).not.toContain('{peer')
  })

  it('상대를 모르면 이름 자리를 "상대" 로 채운다', () => {
    const host = longHintFor('host', null).lines.join('\n')
    const guest = longHintFor('guest', null).lines.join('\n')

    expect(host).toContain('상대는')
    expect(guest).toContain('상대 쪽에서')
    expect(`${host}\n${guest}`).not.toContain('{peer')
  })
})

/**
 * 상대 이름은 인사를 주고받아야 안다.
 *
 * **첫 연결 전에는 모른다.** 그런데 이 화면은 바로 그때 뜬다.
 * 예전에는 아무 이름이나 끼워 넣어서, 여자친구가 한 번도 말한 적 없는
 * 이름이 자기 화면에 떴다. 모를 때는 모른다고 적는다.
 */
describe('상대를 아직 모를 때', () => {
  const phases = [
    'need-hotspot',
    'waiting-for-peer',
    'need-wifi',
    'looking',
    'found',
    'joining',
    'recovering',
  ] as const

  it.each(phases)('%s 단계에 이름 자리를 비워두지 않는다', phase => {
    const copy = copyFor(phase, null)
    const text = `${copy.title}\n${copy.detail}`

    expect(text).not.toContain('undefined')
    expect(text).not.toContain('null')
    expect(text.length).toBeGreaterThan(0)
  })

  it.each(phases)('%s 단계에 조사가 어긋나지 않는다', phase => {
    // "상대이" · "상대은" · "상대을" 은 한국어가 아니다.
    const copy = copyFor(phase, null)
    const text = `${copy.title}\n${copy.detail}`

    for (const broken of ['상대이', '상대은', '상대을']) {
      expect(text).not.toContain(broken)
    }
  })

  it('받침이 있는 이름에는 이 · 을 을 붙인다', () => {
    expect(copyFor('waiting-for-peer', '지민').detail).toContain('지민이')
    expect(copyFor('found', '지민').title).toBe('지민을 찾았어요')
  })

  it('받침이 없는 이름에는 가 · 를 을 붙인다', () => {
    expect(copyFor('waiting-for-peer', '여자친구').detail).toContain('여자친구가')
    expect(copyFor('found', '여자친구').title).toBe('여자친구를 찾았어요')
  })

  it('부르는 말에 "님" 을 붙이지 않는다', () => {
    // "여자친구님" 은 사람을 부르는 말이 아니다.
    const text = [
      copyFor('waiting-for-peer', '여자친구').detail,
      copyFor('found', '여자친구').title,
      copyFor('need-hotspot', '여자친구').detail,
    ].join('\n')

    expect(text).not.toContain('님')
  })

  it('이름을 모르면 "상대" 라고 부른다', () => {
    expect(copyFor('waiting-for-peer', null).detail).toContain('상대가')
    expect(copyFor('found', null).title).toBe('상대를 찾았어요')
  })

  it('빈 이름을 받아도 모르는 것으로 본다', () => {
    // 인사는 받았는데 이름이 비었다. 조사만 떠 있으면 안 된다.
    expect(copyFor('waiting-for-peer', '').detail).toContain('상대가')
  })
})

/**
 * 붙는 일은 앱이 한다.
 *
 * **사람이 누를 것은 핫스팟과 Wi-Fi 뿐이다.** 서로 찾아 붙는 건
 * 켜져 있는 동안 앱이 알아서 계속 한다(`WifiLink`). 화면이 그걸
 * 말해주지 않으면 사람은 어딘가 더 누를 데가 있나 찾게 된다.
 */
describe('더 할 일이 없을 때는', () => {
  it('기다리면 된다고 말한다', () => {
    const copy = copyFor('waiting-for-peer', '지민')
    const text = `${copy.title}\n${copy.detail}`

    expect(text).toContain('저절로')
    expect(copy.action).toBeUndefined()
  })

  it('찾는 중에도 더 누를 것이 없다고 말한다', () => {
    const copy = copyFor('looking', '지민')

    expect(copy.detail).toContain('더 누를 것은 없어요')
    expect(copy.action).toBeUndefined()
  })

  it('할 일이 있는 단계에만 버튼을 둔다', () => {
    // 눌러도 아무 일 없는 버튼을 두면 "앱이 고장났나" 싶어진다.
    expect(copyFor('need-hotspot', '지민').action).toBe('블루투스 켜러 가기')
    expect(copyFor('need-wifi', '지민').action).toBe('블루투스 켜러 가기')

    for (const phase of ['looking', 'found', 'joining', 'recovering'] as const) {
      expect(copyFor(phase, '지민').action).toBeUndefined()
    }
  })
})

describe('연결 화면 글에는', () => {
  const phases = [
    'need-hotspot',
    'waiting-for-peer',
    'need-wifi',
    'looking',
    'found',
    'joining',
    'recovering',
  ] as const

  it.each(phases)('%s 단계에 기술 용어를 쓰지 않는다', phase => {
    // 여자친구는 이 앱이 어떻게 돌아가는지 모른다.
    // 게이트웨이나 소켓 같은 말이 뜨면 물어볼 사람도 없다.
    const copy = copyFor(phase, '지민')
    const text = `${copy.title}\n${copy.detail}`

    for (const word of ['게이트웨이', '브로드캐스트', '소켓', 'IP', 'TCP']) {
      expect(text).not.toContain(word)
    }
  })

  it.each(phases)('%s 단계에 할 말이 비어 있지 않다', phase => {
    const copy = copyFor(phase, '지민')

    expect(copy.title.length).toBeGreaterThan(0)
    expect(copy.detail.length).toBeGreaterThan(0)
  })
})
