import { describe, expect, it } from 'vitest'
import {
  guessGateway,
  isGatewayItself,
  isLoopback,
  isPrivateAddress,
  keepPrivateAddresses,
  parseIpv4,
  sameSubnet,
  scanTargets,
} from './NetworkAddress'

function ip(text: string) {
  const parsed = parseIpv4(text)
  if (!parsed.ok) throw new Error(`테스트용 주소를 만들지 못했다: ${text}`)
  return parsed.value
}

describe('주소 읽기', () => {
  it('보통 주소를 읽는다', () => {
    const parsed = parseIpv4('192.168.43.5')

    expect(parsed.ok && parsed.value.octets).toEqual([192, 168, 43, 5])
  })

  it('앞뒤 공백을 떼어낸다', () => {
    expect(parseIpv4('  10.0.0.1  ').ok).toBe(true)
  })

  it.each([
    ['빈 값이면', ''],
    ['자리가 모자라면', '192.168.1'],
    ['자리가 넘치면', '192.168.1.1.1'],
    ['255를 넘으면', '192.168.1.256'],
    ['글자가 섞이면', '192.168.1.a'],
    ['IPv6 면', 'fe80::1'],
    ['앞에 0이 잔뜩 붙으면', '192.168.0001.1'],
  ])('%s 거절한다', (_label, value) => {
    expect(parseIpv4(value).ok).toBe(false)
  })

  it('0.0.0.0 도 형식으로는 올바르다', () => {
    expect(parseIpv4('0.0.0.0').ok).toBe(true)
  })
})

describe('사설망 주소 가리기', () => {
  it.each([
    ['안드로이드 핫스팟 기본 대역', '192.168.43.5'],
    ['다른 192.168 대역', '192.168.1.100'],
    ['10 대역', '10.0.0.5'],
    ['172.16 대역', '172.16.5.5'],
    ['172.31 대역', '172.31.255.254'],
    ['주소를 못 받았을 때 스스로 붙이는 대역', '169.254.1.5'],
  ])('%s 은 사설망이다', (_label, text) => {
    expect(isPrivateAddress(ip(text))).toBe(true)
  })

  it.each([
    ['공개 주소', '8.8.8.8'],
    ['172.15 는 사설망이 아니다', '172.15.0.1'],
    ['172.32 도 아니다', '172.32.0.1'],
    ['192.167 도 아니다', '192.167.1.1'],
  ])('%s', (_label, text) => {
    expect(isPrivateAddress(ip(text))).toBe(false)
  })

  it('자기 자신을 가리키는 주소를 알아본다', () => {
    expect(isLoopback(ip('127.0.0.1'))).toBe(true)
    expect(isLoopback(ip('192.168.1.1'))).toBe(false)
  })
})

describe('게이트웨이 짐작하기', () => {
  it('같은 대역의 1번으로 짐작한다', () => {
    // 아이폰은 붙은 Wi-Fi 의 게이트웨이를 앱에 알려주지 않는다.
    // 안드로이드 핫스팟은 거의 예외 없이 .1 이다.
    expect(guessGateway(ip('192.168.43.20')).text).toBe('192.168.43.1')
  })

  it('대역이 달라도 규칙은 같다', () => {
    expect(guessGateway(ip('10.5.9.77')).text).toBe('10.5.9.1')
  })

  it('내가 1번이면 내가 게이트웨이다', () => {
    // 핫스팟을 켠 쪽이다. 받는 역할을 맡는다.
    expect(isGatewayItself(ip('192.168.43.1'))).toBe(true)
    expect(isGatewayItself(ip('192.168.43.20'))).toBe(false)
  })
})

describe('훑어볼 주소들', () => {
  it('내 주소에서 가까운 것부터 본다', () => {
    // 같은 때 기내 Wi-Fi 에 붙은 두 폰은 대개 비슷한 주소를 받는다
    const targets = scanTargets(ip('10.0.5.20'))

    expect(targets.slice(0, 4)).toEqual([
      '10.0.5.19',
      '10.0.5.21',
      '10.0.5.18',
      '10.0.5.22',
    ])
  })

  it('셋째 자리를 넘어서도 이어서 본다', () => {
    // 기내 Wi-Fi 는 핫스팟보다 넓을 수 있다
    const targets = scanTargets(ip('10.0.5.1'))

    expect(targets.slice(0, 4)).toEqual([
      '10.0.5.0',
      '10.0.5.2',
      '10.0.4.255',
      '10.0.5.3',
    ])
  })

  it('핫스팟 대역은 앞쪽 500개 안에 전부 들어 있다', () => {
    const near = new Set(scanTargets(ip('192.168.43.5')).slice(0, 500))

    for (let host = 1; host <= 254; host += 1) {
      if (host === 5) continue
      expect(near.has(`192.168.43.${host}`)).toBe(true)
    }
  })

  it('앞 두 자리가 같은 곳(/16)까지 넓힌다', () => {
    const targets = scanTargets(ip('172.19.128.40'))

    expect(targets).toContain('172.19.0.1')
    expect(targets).toContain('172.19.255.254')
    expect(targets).not.toContain('172.18.255.254')
    expect(targets).not.toContain('172.20.0.1')
  })

  it('나 자신과 /16 의 맨 앞·맨 끝은 빼고, 하나도 겹치지 않는다', () => {
    const targets = scanTargets(ip('192.168.43.5'))

    expect(targets).not.toContain('192.168.43.5')
    expect(targets).not.toContain('192.168.0.0')
    expect(targets).not.toContain('192.168.255.255')
    expect(targets).toHaveLength(256 * 256 - 3)
    expect(new Set(targets).size).toBe(targets.length)
  })
})

describe('같은 대역인지', () => {
  it('앞 세 자리가 같으면 같은 대역이다', () => {
    expect(sameSubnet(ip('192.168.43.5'), ip('192.168.43.200'))).toBe(true)
  })

  it('한 자리라도 다르면 다른 대역이다', () => {
    expect(sameSubnet(ip('192.168.43.5'), ip('192.168.44.5'))).toBe(false)
  })
})

describe('WebRTC 후보 거르기', () => {
  it('사설망 주소만 남긴다', () => {
    // 바깥으로 나가려는 후보는 인터넷이 없어 어차피 닿지 않는다.
    // 버려야 협상 시간을 아낀다.
    const candidates = ['192.168.43.5', '8.8.8.8', '10.0.0.3', '203.0.113.7']

    expect(keepPrivateAddresses(candidates)).toEqual(['192.168.43.5', '10.0.0.3'])
  })

  it('자기 자신을 가리키는 주소도 뺀다', () => {
    expect(keepPrivateAddresses(['127.0.0.1', '192.168.1.5'])).toEqual(['192.168.1.5'])
  })

  it('형식이 틀린 것도 뺀다', () => {
    expect(keepPrivateAddresses(['fe80::1', '말도 안 되는 값', '10.1.1.1'])).toEqual([
      '10.1.1.1',
    ])
  })

  it('남는 게 없으면 빈 목록이다', () => {
    expect(keepPrivateAddresses(['8.8.8.8'])).toEqual([])
  })
})
