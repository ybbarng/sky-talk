import { describe, expect, it } from 'vitest'
import { missingAfterHandshake } from './Handshake'

describe('인사 뒤에 놓친 것 찾기', () => {
  it('끊긴 동안 상대가 보낸 것을 알아챈다', () => {
    // 내가 3번까지 받았는데 상대는 7번까지 보냈다
    const missing = missingAfterHandshake(3, 7, [])

    expect(missing).toEqual([4, 5, 6, 7])
  })

  it('이미 알고 있던 빈틈과 합친다', () => {
    const missing = missingAfterHandshake(5, 7, [2])

    expect(missing).toEqual([2, 6, 7])
  })

  it('놓친 게 없으면 빈 목록이다', () => {
    expect(missingAfterHandshake(7, 7, [])).toEqual([])
  })

  it('상대가 나보다 적게 보냈다고 하면 새로 늘리지 않는다', () => {
    // 상대가 앱을 새로 깔았을 때 이렇게 된다
    const missing = missingAfterHandshake(10, 3, [])

    expect(missing).toEqual([])
  })

  it('순서대로 줄 세운다', () => {
    const missing = missingAfterHandshake(5, 8, [3, 1])

    expect(missing).toEqual([1, 3, 6, 7, 8])
  })
})
