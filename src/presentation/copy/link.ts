import type { LinkNotice } from '../stores/linkNotice'
import type { Role } from './connecting'
import { asSubject } from './josa'

/**
 * 연결이 끊겼을 때 잠금 화면에 띄우는 글.
 *
 * **폰을 주머니에 넣은 사람이 읽는다.** 화면을 보고 있지 않으니
 * 제목만 보고도 무엇을 해야 하는지 알아야 한다.
 *
 * 블루투스가 꺼진 것은 **사람이 켜야 풀린다.** 그래서 "무슨 일이
 * 있었다" 가 아니라 "무엇을 눌러라" 로 적는다.
 */

export interface LinkAlert {
  readonly title: string
  readonly body: string
}

/**
 * 앱이 한참 안 돌았을 때 미리 걸어두는 말.
 *
 * **"끊겼다" 고 단정하지 않는다.** 앱이 잠든 것뿐일 수도 있다. 다만
 * 잠들어 있는 동안에는 상대 말이 안 들어오는 것이 사실이라, 열어보라고
 * 말하는 것까지는 맞다.
 *
 * 블루투스가 꺼졌거나 앱이 잠든 것일 수 있다. 앱을 열면 다시 붙는다.
 */
export function awayReminder(role: Role, peerName: string | null): LinkAlert {
  const who = asSubject(peerName === null || peerName.length === 0 ? '상대' : peerName)

  return role === 'host'
    ? {
        title: '한동안 말이 안 오갔어요',
        body: `블루투스가 꺼졌거나 앱이 닫혔을 수 있어요. 앱을 열면 다시 이어져요.`,
      }
    : {
        title: '한동안 말이 안 오갔어요',
        body: `앱을 열면 다시 이어져요. 그래야 ${who} 보낸 말이 들어와요.`,
      }
}

export function alertFor(
  notice: LinkNotice['kind'],
  role: Role,
  peerName: string | null,
): LinkAlert | null {
  const who = asSubject(peerName === null || peerName.length === 0 ? '상대' : peerName)

  switch (notice) {
    case 'none':
      return null

    case 'bluetooth-off':
      return role === 'host'
        ? {
            title: '블루투스가 꺼졌어요',
            body: `켜야 ${who} 다시 이어질 수 있어요. 비행기 모드에서도 블루투스는 켤 수 있어요.`,
          }
        : {
            title: '블루투스가 꺼졌어요',
            body: `켜야 ${who} 찾을 수 있어요. 비행기 모드에서도 블루투스는 켤 수 있어요.`,
          }

    case 'lost':
      return {
        title: '연결이 끊겼어요',
        body: '계속 다시 걸고 있어요. 그동안 쓴 말은 사라지지 않아요.',
      }

    case 'back':
      return {
        title: '다시 연결됐어요',
        body: `${who} 다시 보여요.`,
      }
  }
}
