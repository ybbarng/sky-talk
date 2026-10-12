import TcpSocket from 'react-native-tcp-socket'
import type { Unsubscribe } from '@/application/ports/MessageTransport'
import type {
  DiscoveryProgress,
  FoundPeer,
  PeerDiscovery,
} from '@/application/ports/PeerDiscovery'
import type { LinkKind } from '@/domain/connection/LinkKind'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'
import { batchTargets, planDiscovery, ports } from './DiscoveryPlan'
import { readNetwork } from './NetworkInfo'

/**
 * 같은 Wi-Fi 에 있는 상대를 찾는다. 핫스팟이든 기내 Wi-Fi 든 같다.
 *
 * **손으로 주소를 입력하는 일이 없어야 한다.** 말을 나눌 수 없는 두 사람이
 * 각자 화면만 보고 연결에 성공해야 하기 때문이다.
 *
 * 순서와 판단은 `DiscoveryPlan` 이 정한다. 여기는 실제로 걸어보는 일만 한다.
 */
export class WifiPeerDiscovery implements PeerDiscovery {
  readonly kind: LinkKind = 'wifi'

  private running = false
  private readonly foundHandlers = new Set<(found: FoundPeer) => void>()
  private readonly progressHandlers = new Set<(progress: DiscoveryProgress) => void>()

  /** @param lastKnown 지난번에 붙었던 상대 주소. 있으면 거기부터 걸어본다 */
  constructor(private readonly lastKnown: string | null = null) {}

  async start(): Promise<Result<void, DomainError>> {
    if (this.running) return ok(undefined)
    this.running = true

    const network = await readNetwork()
    if (!network.ok) {
      this.running = false
      return network
    }

    const steps = planDiscovery(network.value.self, this.lastKnown)

    // 내 주소를 화면에 띄워 상대에게 보여줄 수 있게 한다
    this.report({
      method: steps[0]?.method ?? 'scan',
      phase: 'started',
      selfAddress: network.value.self.text,
    })

    for (const step of steps) {
      if (!this.running) return ok(undefined)

      this.report({ method: step.method, phase: 'started' })

      const found = await this.probe(step.targets, step.timeoutMs, step.method)

      if (found !== null) {
        this.report({ method: step.method, phase: 'succeeded' })
        for (const handler of this.foundHandlers) handler(found)
        this.running = false
        return ok(undefined)
      }

      this.report({ method: step.method, phase: 'failed' })
    }

    // 전부 실패했다. 위에서 잠시 뒤 다시 찾는다.
    this.running = false
    return err(domainError('not-found', '상대를 찾지 못했다', 'discovery'))
  }

  async stop(): Promise<void> {
    this.running = false
  }

  onFound(handler: (found: FoundPeer) => void): Unsubscribe {
    this.foundHandlers.add(handler)
    return () => this.foundHandlers.delete(handler)
  }

  onProgress(handler: (progress: DiscoveryProgress) => void): Unsubscribe {
    this.progressHandlers.add(handler)
    return () => this.progressHandlers.delete(handler)
  }

  /**
   * 주소에 걸어본다.
   *
   * 한 번에 여러 개를 동시에 건다. 하나씩 하면 기내 Wi-Fi 에서 몇 시간이 걸린다.
   */
  private async probe(
    targets: readonly string[],
    timeoutMs: number,
    method: DiscoveryProgress['method'],
  ): Promise<FoundPeer | null> {
    const batches = batchTargets(targets)
    let checked = 0

    for (const batch of batches) {
      if (!this.running) return null

      const results = await Promise.all(batch.map(host => knock(host, timeoutMs)))

      checked += batch.length
      this.report({ method, phase: 'started', checked, total: targets.length })

      const hit = batch.find((_, index) => results[index] === true)
      if (hit !== undefined) return { address: hit, foundBy: method }
    }

    return null
  }

  private report(progress: DiscoveryProgress): void {
    for (const handler of this.progressHandlers) handler(progress)
  }
}

/**
 * 그 주소의 우리 번호가 열려 있나.
 *
 * 열렸는지만 보고 곧장 끊는다. 받는 쪽은 봉투가 오지 않은 연결을 상대로
 * 치지 않으므로 이렇게 두드려도 받는 쪽 화면이 흔들리지 않는다.
 */
function knock(host: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    let socket: ReturnType<typeof TcpSocket.createConnection> | null = null

    const finish = (open: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket?.destroy()
      } catch {
        // 이미 닫혔다
      }
      resolve(open)
    }

    const timer = setTimeout(() => finish(false), timeoutMs)

    try {
      socket = TcpSocket.createConnection(
        { port: ports.message, host, connectTimeout: timeoutMs, interface: 'wifi' },
        () => finish(true),
      )
      socket.on('error', () => finish(false))
    } catch {
      // 소켓을 못 만들었다. 이 주소는 없는 것으로 친다.
      finish(false)
    }
  })
}
