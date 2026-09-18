/**
 * 처음 만나 인사하기.
 *
 * 연결되면 곧바로 서로를 확인하고, 끊긴 동안 놓친 것을 찾는다.
 *
 * 예전에는 여섯 자리 코드가 맞는지 보고 받아들일지 정했다. 그 기능을
 * **없앴다.** 두 사람이 쓰는 앱이고, 비행기 안에서 코드를 맞추다 대화를
 * 못 하는 편이 남이 붙는 것보다 훨씬 나쁘다. 붙은 상대는 그냥 우리 둘이다.
 *
 * (docs/04-transport-spec.md 2.5)
 */

/**
 * 인사를 마친 뒤 못 받은 게 있는지 본다.
 *
 * 상대가 "나는 여기까지 보냈다"고 알려준 값과 내가 받은 값을 비교한다.
 * 다시 붙자마자 놓친 것을 채우기 위해서다.
 */
export function missingAfterHandshake(
  myHighestFromPeer: number,
  peerHighestSent: number,
  knownMissing: readonly number[],
): number[] {
  const missing = new Set(knownMissing)

  for (let seq = myHighestFromPeer + 1; seq <= peerHighestSent; seq += 1) {
    missing.add(seq)
  }

  return [...missing].sort((a, b) => a - b)
}

/** 인사가 이 시간 안에 안 끝나면 연결을 끊고 처음부터 다시 한다 */
export const HANDSHAKE_TIMEOUT_MS = 5000
