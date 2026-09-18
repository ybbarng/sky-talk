import { describe, expect, it } from 'vitest'
import { showsTime } from './timeMarks'

const T = 1758000000000

describe('시각을 어디에 적나', () => {
  it('마지막 말에는 적는다', () => {
    expect(showsTime({ author: 'me', at: T }, undefined)).toBe(true)
  })

  it('다음 말이 다른 사람 것이면 적는다', () => {
    expect(showsTime({ author: 'me', at: T }, { author: 'her', at: T })).toBe(true)
  })

  it('같은 사람이 같은 분 안에 이어 말하면 앞 말에는 안 적는다', () => {
    expect(showsTime({ author: 'me', at: T }, { author: 'me', at: T + 30_000 })).toBe(
      false,
    )
  })

  it('같은 사람이라도 분이 바뀌면 앞 말에 적는다', () => {
    // 5분 전 말과 방금 말이 같은 시각처럼 보이면 안 된다
    expect(showsTime({ author: 'me', at: T }, { author: 'me', at: T + 5 * 60_000 })).toBe(
      true,
    )
  })

  it('분의 경계는 시계의 분으로 가른다', () => {
    // 59초와 60초는 1초 차이지만 분이 다르다
    const minuteStart = Math.floor(T / 60_000) * 60_000
    expect(
      showsTime(
        { author: 'me', at: minuteStart + 59_000 },
        { author: 'me', at: minuteStart + 60_000 },
      ),
    ).toBe(true)
  })
})
