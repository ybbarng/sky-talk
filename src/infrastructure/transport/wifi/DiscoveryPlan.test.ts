import { describe, expect, it } from 'vitest'
import {
  batchTargets,
  estimateScanMillis,
  OFFER_MANUAL_AFTER_MS,
  planDiscovery,
  ports,
  roleFor,
  SCAN_BATCH_SIZE,
} from './DiscoveryPlan'
import { parseIpv4 } from './NetworkAddress'

function ip(text: string) {
  const parsed = parseIpv4(text)
  if (!parsed.ok) throw new Error(`테스트용 주소를 만들지 못했다: ${text}`)
  return parsed.value
}

describe('찾는 순서', () => {
  it('아이폰 쪽은 게이트웨이부터 걸어본다', () => {
    // 대개 1초 안에 끝난다. 나머지는 이게 실패할 때만 한다.
    const steps = planDiscovery(ip('192.168.43.20'))

    expect(steps[0]?.method).toBe('gateway')
    expect(steps[0]?.targets).toEqual(['192.168.43.1'])
  })

  it('안드로이드 쪽은 게이트웨이 단계를 건너뛴다', () => {
    // 내가 게이트웨이라 나 자신에게 거는 셈이다
    const steps = planDiscovery(ip('192.168.43.1'))

    expect(steps.map(s => s.method)).not.toContain('gateway')
  })

  it('게이트웨이 다음은 외치기, 그다음이 훑어보기다', () => {
    const steps = planDiscovery(ip('192.168.43.20'))

    expect(steps.map(s => s.method)).toEqual(['gateway', 'broadcast', 'scan'])
  })

  it('외칠 때는 대역 전체와 모두에게 두 곳으로 보낸다', () => {
    // 기기에 따라 둘 중 하나만 먹는다
    const steps = planDiscovery(ip('192.168.43.20'))
    const broadcast = steps.find(s => s.method === 'broadcast')

    expect(broadcast?.targets).toEqual(['192.168.43.255', '255.255.255.255'])
  })

  it('훑어보기는 대역 전체를 본다', () => {
    const steps = planDiscovery(ip('192.168.43.20'))
    const scan = steps.find(s => s.method === 'scan')

    expect(scan?.targets).toHaveLength(253)
  })

  it('게이트웨이를 가장 짧게 기다린다', () => {
    const steps = planDiscovery(ip('192.168.43.20'))
    const gateway = steps.find(s => s.method === 'gateway')
    const scan = steps.find(s => s.method === 'scan')

    expect(gateway?.timeoutMs).toBeGreaterThan(scan?.timeoutMs ?? 0)
  })
})

describe('동시에 걸어보기', () => {
  it('묶음으로 나눈다', () => {
    const batches = batchTargets(
      Array.from({ length: 100 }, (_, i) => `x${i}`),
      32,
    )

    expect(batches).toHaveLength(4)
    expect(batches[0]).toHaveLength(32)
    expect(batches[3]).toHaveLength(4)
  })

  it('딱 나누어떨어지면 남는 묶음이 없다', () => {
    const batches = batchTargets(
      Array.from({ length: 64 }, (_, i) => `x${i}`),
      32,
    )

    expect(batches).toHaveLength(2)
  })

  it('빈 목록이면 묶음도 없다', () => {
    expect(batchTargets([])).toEqual([])
  })

  it('한 주소도 빠뜨리지 않는다', () => {
    const targets = Array.from({ length: 253 }, (_, i) => `192.168.43.${i + 1}`)

    const flattened = batchTargets(targets).flat()

    expect(flattened).toEqual(targets)
  })
})

describe('얼마나 걸릴지 어림하기', () => {
  it('대역 전체를 훑는 데 3초쯤 걸린다', () => {
    // 화면에 "몇 초쯤 걸려요"를 보여주는 데 쓴다
    const millis = estimateScanMillis(253)

    expect(millis).toBeGreaterThan(2000)
    expect(millis).toBeLessThan(4000)
  })

  it('한 번에 더 많이 걸수록 빨라진다', () => {
    const narrow = estimateScanMillis(253, 8)
    const wide = estimateScanMillis(253, 64)

    expect(wide).toBeLessThan(narrow)
  })

  it('훑어보기가 코드 입력을 권하는 시간보다 짧다', () => {
    // 훑어보기도 못 끝냈는데 "잘 안 되나요" 가 뜨면 안 된다
    expect(estimateScanMillis(253)).toBeLessThan(OFFER_MANUAL_AFTER_MS)
  })
})

describe('누가 받고 누가 거는가', () => {
  it('핫스팟을 연 쪽이 받는다', () => {
    expect(roleFor(ip('192.168.43.1'))).toBe('host')
  })

  it('붙는 쪽이 건다', () => {
    expect(roleFor(ip('192.168.43.20'))).toBe('guest')
  })

  it('역할이 겹치지 않는다', () => {
    // 둘 다 걸거나 둘 다 기다리면 영영 안 붙는다
    const android = roleFor(ip('192.168.43.1'))
    const iphone = roleFor(ip('192.168.43.20'))

    expect(android).not.toBe(iphone)
  })
})

describe('쓰는 번호', () => {
  it('세 가지가 서로 다르다', () => {
    const values = Object.values(ports)

    expect(new Set(values).size).toBe(values.length)
  })

  it('잘 쓰이지 않는 대역을 쓴다', () => {
    // 낮은 번호는 다른 프로그램이 쓸 수 있고 권한도 필요하다
    for (const port of Object.values(ports)) {
      expect(port).toBeGreaterThan(49152)
      expect(port).toBeLessThan(65536)
    }
  })
})

describe('묶음 크기', () => {
  it('한 번에 너무 많이 걸지 않는다', () => {
    // 폰이 동시에 열 수 있는 연결에 한계가 있다
    expect(SCAN_BATCH_SIZE).toBeLessThanOrEqual(64)
  })
})
