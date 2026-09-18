import { describe, expect, it } from 'vitest'
import { expectsAck, worthSendingOnNarrowLink } from './Envelope'

describe('좁은 길로 보낼 만한 봉투', () => {
  it('실제 대화 내용은 언제나 보낸다', () => {
    expect(worthSendingOnNarrowLink('message')).toBe(true)
    expect(worthSendingOnNarrowLink('ack')).toBe(true)
    expect(worthSendingOnNarrowLink('nudge')).toBe(true)
  })

  it('입력 중 표시는 보내지 않는다', () => {
    // 초당 몇 KB 밖에 안 되는 길을 실제 대화에 양보한다
    expect(worthSendingOnNarrowLink('typing')).toBe(false)
  })

  it('지금 뭐 듣는지 같은 소식도 보내지 않는다', () => {
    expect(worthSendingOnNarrowLink('presence')).toBe(false)
  })

  it('사진·음성 조각은 보낸다', () => {
    // 비행기에서는 이 길뿐이다. 막으면 영영 못 보낸다. 작게 줄이는 것은 보내는 쪽 몫이다.
    expect(worthSendingOnNarrowLink('asset_chunk')).toBe(true)
  })

  it('인사는 보낸다', () => {
    // 이걸 막으면 연결 자체가 안 된다
    expect(worthSendingOnNarrowLink('hello')).toBe(true)
    expect(worthSendingOnNarrowLink('hello_ack')).toBe(true)
  })
})

describe('답을 기다리는 봉투', () => {
  it('대화 메시지는 받았다는 답을 기다린다', () => {
    expect(expectsAck('message')).toBe(true)
  })

  it('답 자체는 답을 기다리지 않는다', () => {
    // 그러면 답에 답하고 또 답하고 끝이 없다
    expect(expectsAck('ack')).toBe(false)
  })

  it('읽음과 입력 중은 답을 기다리지 않는다', () => {
    expect(expectsAck('read')).toBe(false)
    expect(expectsAck('typing')).toBe(false)
  })
})
