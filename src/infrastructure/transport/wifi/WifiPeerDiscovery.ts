import TcpSocket from 'react-native-tcp-socket'
import dgram from 'react-native-udp'
import type { Unsubscribe } from '@/application/ports/MessageTransport'
import type {
  DiscoveryProgress,
  FoundPeer,
  PeerDiscovery,
} from '@/application/ports/PeerDiscovery'
import type { LinkKind } from '@/domain/connection/LinkKind'
import { type DomainError, domainError } from '@/domain/shared/DomainError'
import { err, ok, type Result } from '@/domain/shared/Result'
import {
  BROADCAST_ATTEMPTS,
  BROADCAST_INTERVAL_MS,
  batchTargets,
  planDiscovery,
  ports,
} from './DiscoveryPlan'
import { readNetwork } from './NetworkInfo'

/**
 * 같은 Wi-Fi 에 있는 상대를 찾는다.
 *
 * **손으로 주소를 입력하는 일이 없어야 한다.** 말을 나눌 수 없는 두 사람이
 * 각자 화면만 보고 연결에 성공해야 하기 때문이다.
 *
 * 순서와 판단은 `DiscoveryPlan` 이 정한다. 여기는 실제로 걸어보는 일만 한다.
 */
export class WifiPeerDiscovery implements PeerDiscovery {
  readonly kind: LinkKind = 'wifi'

  private running = false
  private udp: ReturnType<typeof dgram.createSocket> | null = null
  private readonly foundHandlers = new Set<(found: FoundPeer) => void>()
  private readonly progressHandlers = new Set<(progress: DiscoveryProgress) => void>()

  async start(): Promise<Result<void, DomainError>> {
    if (this.running) return ok(undefined)
    this.running = true

    const network = await readNetwork()
    if (!network.ok) {
      this.running = false
      return network
    }

    const steps = planDiscovery(network.value.self)

    // 내 주소를 화면에 띄워 상대에게 보여줄 수 있게 한다
    this.report({
      method: 'gateway',
      phase: 'started',
      selfAddress: network.value.self.text,
    })

    for (const step of steps) {
      if (!this.running) return ok(undefined)

      this.report({ method: step.method, phase: 'started' })

      const found =
        step.method === 'broadcast'
          ? await this.shout(step.targets)
          : await this.probe(step.targets, step.timeoutMs, step.method)

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
    this.udp?.close()
    this.udp = null
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
   * 한 번에 여러 개를 동시에 건다. 하나씩 하면 253개에 몇 분이 걸린다.
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

  /**
   * 사설망 전체에 대고 외친다.
   *
   * 기기에 따라 이걸 막아둔 경우가 있어서 실패해도 놀랄 일이 아니다.
   * 그때는 다음 단계(훑어보기)로 넘어간다.
   */
  private async shout(targets: readonly string[]): Promise<FoundPeer | null> {
    return new Promise(resolve => {
      let settled = false
      const finish = (found: FoundPeer | null) => {
        if (settled) return
        settled = true
        clearInterval(timer)
        socket.close()
        this.udp = null
        resolve(found)
      }

      const socket = dgram.createSocket({ type: 'udp4' })
      this.udp = socket

      socket.on('message', (data, remote) => {
        const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
        if (!looksLikeUs(text)) return
        finish({ address: remote.address, foundBy: 'broadcast' })
      })

      socket.on('error', () => finish(null))

      const payload = JSON.stringify({
        app: 'skywalkie',
        v: 1,
        port: ports.message,
      })

      let attempts = 0
      const timer = setInterval(() => {
        attempts += 1
        if (attempts > BROADCAST_ATTEMPTS || !this.running) {
          finish(null)
          return
        }

        for (const target of targets) {
          try {
            socket.send(payload, undefined, undefined, ports.discovery, target, () => {})
          } catch {
            // 기기가 막아둔 것이다. 다음 단계로 넘어가면 된다.
          }
        }
      }, BROADCAST_INTERVAL_MS)

      socket.bind(ports.discovery, () => {
        try {
          socket.setBroadcast(true)
        } catch {
          finish(null)
        }
      })
    })
  }

  private report(progress: DiscoveryProgress): void {
    for (const handler of this.progressHandlers) handler(progress)
  }
}

/** 그 주소의 우리 번호가 열려 있나 */
function knock(host: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const finish = (open: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.destroy()
      } catch {
        // 이미 닫혔다
      }
      resolve(open)
    }

    const timer = setTimeout(() => finish(false), timeoutMs)

    const socket = TcpSocket.createConnection(
      { port: ports.message, host, connectTimeout: timeoutMs, interface: 'wifi' },
      () => finish(true),
    )

    socket.on('error', () => finish(false))
  })
}

/** 우리 앱이 보낸 것인가 */
function looksLikeUs(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { app?: unknown }).app === 'skywalkie'
    )
  } catch {
    return false
  }
}
