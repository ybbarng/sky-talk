import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'

/**
 * IP 주소 다루기.
 *
 * 소켓을 건드리지 않는 순수한 계산이라 전부 컴퓨터에서 시험할 수 있다.
 * 실제로 상대를 찾는 일의 절반이 여기 있다.
 * (docs/04-transport-spec.md 2.3)
 */

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export interface Ipv4 {
  readonly octets: readonly [number, number, number, number]
  readonly text: string
}

export function parseIpv4(value: string): Result<Ipv4, DomainError> {
  const match = IPV4_PATTERN.exec(value.trim())
  if (match === null) {
    return err(domainError('invalid-value', `IP 주소 형식이 아니다: ${value}`, 'ip'))
  }

  const octets = match.slice(1, 5).map(part => Number.parseInt(part, 10))
  for (const octet of octets) {
    if (octet < 0 || octet > 255) {
      return err(domainError('invalid-value', `IP 주소 범위를 벗어났다: ${value}`, 'ip'))
    }
  }

  const [a, b, c, d] = octets as [number, number, number, number]
  return ok({ octets: [a, b, c, d], text: `${a}.${b}.${c}.${d}` })
}

/**
 * 사설망 주소인가.
 *
 * WebRTC 후보를 고를 때도 쓴다. 바깥으로 나가려는 주소는 인터넷이 없어
 * 어차피 닿지 않으므로 버려서 시간을 아낀다.
 */
export function isPrivateAddress(ip: Ipv4): boolean {
  const [a, b] = ip.octets

  // 10.0.0.0/8
  if (a === 10) return true
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true
  // 169.254.0.0/16 — 주소를 못 받았을 때 스스로 붙이는 것.
  // 핫스팟이 이상할 때 실제로 이 대역이 잡힌다.
  if (a === 169 && b === 254) return true

  return false
}

/** 자기 자신을 가리키는 주소인가 */
export function isLoopback(ip: Ipv4): boolean {
  return ip.octets[0] === 127
}

/**
 * 게이트웨이 주소를 짐작한다.
 *
 * 핫스팟을 켠 쪽이 곧 게이트웨이다. 아이폰은 자기가 붙은 Wi-Fi 의
 * 게이트웨이를 앱에 알려주지 않으므로 **같은 대역의 .1 로 짐작한다.**
 * 안드로이드 핫스팟은 거의 예외 없이 이 모양이다.
 *
 * 짐작이 틀려도 손해가 없다. 실패하면 다음 방법으로 넘어간다.
 */
export function guessGateway(ip: Ipv4): Ipv4 {
  const [a, b, c] = ip.octets
  return { octets: [a, b, c, 1], text: `${a}.${b}.${c}.1` }
}

/** 이 주소가 자기 대역의 게이트웨이인가. 내가 핫스팟을 연 쪽인지 알 수 있다 */
export function isGatewayItself(ip: Ipv4): boolean {
  return ip.octets[3] === 1
}

/**
 * 훑어볼 주소들. **내 주소에서 가까운 것부터** 늘어놓는다.
 *
 * 핫스팟은 254개뿐이지만 기내 Wi-Fi 는 훨씬 넓을 수 있다. 망의 크기는 앱이
 * 알 길이 없어서 앞 두 자리가 같은 곳(/16)까지 넉넉히 잡는다. 대신 같은 때
 * 붙은 두 폰은 대개 비슷한 주소를 받으므로 가까운 곳부터 보면 금방 찾는다.
 * (docs/04-transport-spec.md 1.2, 2.3)
 *
 * 자기 자신과 /16 의 맨 앞(.0.0)·맨 끝(.255.255)은 뺀다. 게이트웨이는 이미
 * 먼저 걸어봤지만 그 시도가 실패했을 수도 있어 남겨둔다.
 */
export function scanTargets(ip: Ipv4): string[] {
  const [a, b, c, d] = ip.octets
  const self = c * 256 + d
  const first = 1
  const last = 256 * 256 - 2
  const targets: string[] = []

  const push = (index: number) => {
    targets.push(`${a}.${b}.${Math.floor(index / 256)}.${index % 256}`)
  }

  for (
    let distance = 1;
    self - distance >= first || self + distance <= last;
    distance += 1
  ) {
    if (self - distance >= first) push(self - distance)
    if (self + distance <= last) push(self + distance)
  }

  return targets
}

/** 같은 대역에 있는가 */
export function sameSubnet(a: Ipv4, b: Ipv4): boolean {
  return (
    a.octets[0] === b.octets[0] &&
    a.octets[1] === b.octets[1] &&
    a.octets[2] === b.octets[2]
  )
}

/** 사설망 안의 주소만 남긴다. WebRTC 후보를 거를 때 쓴다 */
export function keepPrivateAddresses(candidates: readonly string[]): string[] {
  return candidates.filter(text => {
    const parsed = parseIpv4(text)
    return parsed.ok && isPrivateAddress(parsed.value) && !isLoopback(parsed.value)
  })
}
