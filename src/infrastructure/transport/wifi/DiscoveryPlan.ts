import type { DiscoveryMethod } from '@/application/ports/PeerDiscovery'
import {
  broadcastAddress,
  guessGateway,
  type Ipv4,
  isGatewayItself,
  scanTargets,
} from './NetworkAddress'

/**
 * 상대를 어떤 순서로 찾을지 정한다.
 *
 * 소켓을 건드리지 않는 순수한 계산이다. 실제로 걸어보는 일만 바깥에 맡기고
 * **순서와 판단은 여기서 전부 시험한다.**
 *
 * (docs/04-transport-spec.md 2.3)
 */

/** 쓰는 번호들 */
export const ports = {
  discovery: 51703,
  message: 51704,
  web: 51705,
} as const

/** 한 번에 몇 개씩 동시에 걸어볼까 */
export const SCAN_BATCH_SIZE = 32

/** 훑어볼 때 한 주소를 얼마나 기다릴까 */
export const SCAN_TIMEOUT_MS = 300

/** 게이트웨이에 바로 걸 때 기다리는 시간. 대개 1초 안에 끝난다 */
export const GATEWAY_TIMEOUT_MS = 1500

/** 소리쳐 부르기를 몇 번 할까 */
export const BROADCAST_ATTEMPTS = 10
export const BROADCAST_INTERVAL_MS = 1000

/**
 * 이만큼 지나도 못 찾으면 화면에 "잘 안 되나요" 안내를 띄운다.
 * 빙글빙글 도는 표시만 두면 사용자는 앱이 멈춘 줄 안다.
 */
export const OFFER_MANUAL_AFTER_MS = 15_000

export interface DiscoveryStep {
  readonly method: DiscoveryMethod
  /** 걸어볼 주소들 */
  readonly targets: readonly string[]
  readonly timeoutMs: number
}

/**
 * 내 주소를 보고 무엇을 어떤 순서로 해볼지 정한다.
 *
 * 하나라도 성공하면 나머지는 하지 않는다.
 */
export function planDiscovery(self: Ipv4): DiscoveryStep[] {
  const steps: DiscoveryStep[] = []

  // 1. 게이트웨이에 바로 걸기.
  //    핫스팟을 켠 쪽이 곧 게이트웨이라 대개 이걸로 끝난다.
  //    다만 내가 게이트웨이면 나 자신에게 거는 셈이라 건너뛴다.
  if (!isGatewayItself(self)) {
    steps.push({
      method: 'gateway',
      targets: [guessGateway(self).text],
      timeoutMs: GATEWAY_TIMEOUT_MS,
    })
  }

  // 2. 사설망 전체에 대고 외치기
  steps.push({
    method: 'broadcast',
    targets: [broadcastAddress(self).text, '255.255.255.255'],
    timeoutMs: BROADCAST_ATTEMPTS * BROADCAST_INTERVAL_MS,
  })

  // 3. 하나씩 훑어보기. 오래 걸리므로 마지막이다.
  steps.push({
    method: 'scan',
    targets: scanTargets(self),
    timeoutMs: SCAN_TIMEOUT_MS,
  })

  return steps
}

/** 훑어볼 주소를 동시에 걸 수 있는 묶음으로 나눈다 */
export function batchTargets(
  targets: readonly string[],
  size = SCAN_BATCH_SIZE,
): string[][] {
  const batches: string[][] = []
  for (let i = 0; i < targets.length; i += size) {
    batches.push([...targets.slice(i, i + size)])
  }
  return batches
}

/**
 * 훑어보는 데 얼마나 걸릴지 어림한다.
 *
 * 화면에 "몇 초쯤 걸려요"를 보여주는 데 쓴다. 아무 말 없이 기다리게 하면
 * 사용자는 앱이 멈춘 줄 안다.
 */
export function estimateScanMillis(
  targetCount: number,
  batchSize = SCAN_BATCH_SIZE,
  timeoutMs = SCAN_TIMEOUT_MS,
): number {
  return Math.ceil(targetCount / batchSize) * timeoutMs
}

/**
 * 내가 받는 쪽인가 거는 쪽인가.
 *
 * 핫스팟을 연 쪽(게이트웨이)이 받는 쪽이다. 역할을 주소로 정하면
 * 둘 다 동시에 걸거나 둘 다 기다리는 일이 없다.
 */
export function roleFor(self: Ipv4): ConnectionRole {
  return isGatewayItself(self) ? 'host' : 'guest'
}

export type ConnectionRole =
  /** 핫스팟을 연 쪽. 받는다 */
  | 'host'
  /** 붙는 쪽. 건다 */
  | 'guest'
