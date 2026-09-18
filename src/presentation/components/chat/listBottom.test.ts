import { describe, expect, it } from 'vitest'
import { isNearBottom, NEAR_BOTTOM_PX } from './listBottom'

describe('대화 목록이 바닥에 붙어 있나', () => {
  it('끝까지 내려가 있으면 바닥이다', () => {
    expect(isNearBottom(1000, 1600, 600)).toBe(true)
  })

  it('살짝 올라간 정도는 바닥으로 본다', () => {
    // 손가락이 흔들린 정도로 따라 내려가기를 멈추면 안 된다
    expect(isNearBottom(1000 - NEAR_BOTTOM_PX, 1600, 600)).toBe(true)
  })

  it('옛 말을 보고 있으면 바닥이 아니다', () => {
    expect(isNearBottom(200, 1600, 600)).toBe(false)
  })

  it('내용이 화면보다 짧으면 늘 바닥이다', () => {
    expect(isNearBottom(0, 300, 600)).toBe(true)
  })
})
