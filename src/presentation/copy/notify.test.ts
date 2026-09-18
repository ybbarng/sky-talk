import { describe, expect, it } from 'vitest'
import {
  doodleContent,
  nudgeContent,
  photoContent,
  stickerContent,
  systemContent,
  textContent,
} from '@/domain/message/MessageContent'
import { notificationBody, reactionTo, worthNotifying } from './notify'

/**
 * 잠금 화면에 뜨는 글.
 *
 * **폰을 내려놔도 상대가 말을 걸면 알아야 한다.** 이게 없으면 앱을
 * 보고 있을 때만 대화가 된다.
 */

function must<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok) throw new Error('만들지 못했다')
  return result.value as T
}

describe('무엇이 왔는지 한 줄로', () => {
  it('글은 그대로 보여준다', () => {
    // 열어보기 전에 무슨 말인지 알아야 열지 말지 정한다
    expect(notificationBody(must(textContent('기내식 나왔어')))).toBe('기내식 나왔어')
  })

  it('글이 아닌 것도 무엇이 왔는지는 알린다', () => {
    expect(notificationBody(must(stickerContent('aria', 'heart')))).toContain('이모티콘')
    expect(notificationBody(nudgeContent())).toContain('콕')
    expect(
      notificationBody(
        must(doodleContent([{ points: [{ x: 0, y: 0 }], color: 'me', width: 2 }])),
      ),
    ).toContain('낙서')
  })

  it('사진에 붙인 말이 있으면 그걸 보여준다', () => {
    // "사진을 보냈어요" 보다 "창밖 좀 봐" 가 알아보기 쉽다
    const photo = must(
      photoContent({
        assetId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
        width: 100,
        height: 100,
        byteLength: 1000,
        caption: '창밖 좀 봐',
      }),
    )

    expect(notificationBody(photo)).toBe('창밖 좀 봐')
  })

  it('붙인 말이 없으면 사진이라고만 한다', () => {
    const photo = must(
      photoContent({
        assetId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
        width: 100,
        height: 100,
        byteLength: 1000,
      }),
    )

    expect(notificationBody(photo)).toContain('사진')
  })

  it('어느 종류든 빈칸을 내놓지 않는다', () => {
    // 빈 알림이 뜨면 뭐가 왔는지 모른 채 열어봐야 한다
    const everything = [
      must(textContent('안녕')),
      must(stickerContent('aria', 'wave')),
      nudgeContent(),
      must(doodleContent([{ points: [{ x: 0, y: 0 }], color: 'me', width: 2 }])),
    ]

    for (const content of everything) {
      expect(notificationBody(content).length).toBeGreaterThan(0)
    }
  })
})

describe('띄울 만한가', () => {
  it('앱이 끼워 넣은 알림은 안 띄운다', () => {
    // **"연결이 끊겼어요" 가 뜰 때마다 폰이 울리면** 비행기에서 내내
    // 시끄럽다. 그건 앱을 열었을 때만 본다.
    expect(worthNotifying(systemContent('link-lost'))).toBe(false)
    expect(worthNotifying(systemContent('link-restored'))).toBe(false)
  })

  it('사람이 보낸 것은 띄운다', () => {
    expect(worthNotifying(must(textContent('안녕')))).toBe(true)
    expect(worthNotifying(nudgeContent())).toBe(true)
    expect(worthNotifying(must(stickerContent('aria', 'heart')))).toBe(true)
  })
})

describe('새 말이 왔을 때 무엇을 하나', () => {
  const watching = { active: true, tapWhileWatching: true, nudgeVibration: true }
  const away = { active: false, tapWhileWatching: true, nudgeVibration: true }

  it('콕 찌르기는 보고 있어도 떤다', () => {
    // 말 없이 "자니?" 하는 것이라 진동이 곧 내용이다
    expect(reactionTo(nudgeContent(), watching)).toEqual({
      vibrate: 'nudge',
      notify: false,
    })
  })

  it('콕 찌르기는 안 보고 있으면 떨고 잠금 화면에도 띄운다', () => {
    expect(reactionTo(nudgeContent(), away)).toEqual({ vibrate: 'nudge', notify: true })
  })

  it('콕 찌르기 진동을 꺼두면 안 떤다', () => {
    // 거슬리는 사람도 있다. 잠금 화면 알림은 그대로라 놓치지는 않는다
    expect(reactionTo(nudgeContent(), { ...watching, nudgeVibration: false })).toEqual({
      vibrate: null,
      notify: false,
    })
    expect(reactionTo(nudgeContent(), { ...away, nudgeVibration: false })).toEqual({
      vibrate: null,
      notify: true,
    })
  })

  it('보고 있을 때 온 글은 짧게 떨고 알림은 안 띄운다', () => {
    expect(reactionTo(must(textContent('안녕')), watching)).toEqual({
      vibrate: 'tap',
      notify: false,
    })
  })

  it('보고 있을 때 떨기를 꺼두면 글에는 아무것도 안 한다', () => {
    expect(
      reactionTo(must(textContent('안녕')), { ...watching, tapWhileWatching: false }),
    ).toEqual({ vibrate: null, notify: false })
  })

  it('안 보고 있을 때 온 글은 잠금 화면에 띄운다', () => {
    expect(reactionTo(must(textContent('안녕')), away)).toEqual({
      vibrate: null,
      notify: true,
    })
  })

  it('앱이 끼워 넣은 알림에는 아무것도 안 한다', () => {
    expect(reactionTo(systemContent('link-lost'), away)).toEqual({
      vibrate: null,
      notify: false,
    })
    expect(reactionTo(systemContent('link-lost'), watching)).toEqual({
      vibrate: null,
      notify: false,
    })
  })
})
