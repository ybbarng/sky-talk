import type { ArchivedMessage, ArchivedPerson } from './ArchiveFormat'
import { describe, formatDate, formatTime, systemNotice } from './renderText'

/**
 * 앱 없이 열리는 한 장짜리 파일.
 *
 * **바깥에서 아무것도 불러오지 않는다.** 글꼴도 그림도 스타일도 전부
 * 안에 들어 있다. 비행기에서 열어볼 수도 있고, 인터넷이 없으면
 * 바깥에서 불러오는 것은 전부 빈칸이 된다.
 *
 * 밝은 화면과 어두운 화면 둘 다 나온다. 브라우저 설정을 따라간다.
 *
 * 낙서는 SVG 로 그대로 그린다. 그림 파일로 바꾸면 파일이 커지고
 * 화면 크기가 다를 때 흐려진다.
 */

export function renderHtmlHead(people: readonly ArchivedPerson[]): string {
  const names = people.map(person => escapeHtml(person.displayName)).join(' · ')

  return `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${names} 의 대화</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #FFFFFF; --surface: #F4F4F5; --text: #18181B;
  --muted: #71717A; --me: #C2410C; --peer: #0369A1; --line: #E4E4E7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #09090B; --surface: #18181B; --text: #FAFAFA;
    --muted: #A1A1AA; --me: #FF9D5C; --peer: #5CC8FF; --line: #27272A;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px 16px 64px;
  background: var(--bg); color: var(--text);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo",
        "Malgun Gothic", sans-serif;
}
main { max-width: 680px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { color: var(--muted); font-size: 13px; margin-bottom: 32px; }
.day {
  text-align: center; color: var(--muted); font-size: 13px;
  margin: 28px 0 16px; position: relative;
}
.day span { background: var(--bg); padding: 0 12px; position: relative; }
.day::before {
  content: ""; position: absolute; left: 0; right: 0; top: 50%;
  border-top: 1px solid var(--line);
}
.row { display: flex; margin-bottom: 8px; align-items: flex-end; gap: 8px; }
.row.mine { flex-direction: row-reverse; }
.bubble {
  background: var(--surface); border-radius: 16px;
  padding: 8px 14px; max-width: 78%; word-break: break-word;
  white-space: pre-wrap;
}
.row.mine .bubble { border-bottom-right-radius: 4px; }
.row:not(.mine) .bubble { border-bottom-left-radius: 4px; }
.who { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.row.mine .who { color: var(--me); text-align: right; }
.row:not(.mine) .who { color: var(--peer); }
.at { font-size: 11px; color: var(--muted); white-space: nowrap; }
.notice {
  text-align: center; color: var(--muted); font-size: 13px; margin: 16px 0;
}
svg { display: block; background: var(--bg); border-radius: 12px; }
</style>
<main>
<h1>${names}</h1>
<p class="sub">SkyTalk 에서 꺼낸 대화</p>
`
}

export function renderHtmlDay(at: Date): string {
  return `<div class="day"><span>${escapeHtml(formatDate(at))}</span></div>\n`
}

export function renderHtmlMessage(
  message: ArchivedMessage,
  me: string,
  nameOf: (peerId: string) => string,
): string {
  const at = new Date(message.receivedAt ?? message.sentAt)

  if (message.content.kind === 'system') {
    return `<div class="notice">${escapeHtml(systemNotice(message.content.notice))}</div>\n`
  }

  const mine = message.author === me
  const body =
    message.content.kind === 'doodle'
      ? renderDoodle(message.content.strokes)
      : `<div class="bubble">${escapeHtml(describe(message))}</div>`

  return `<div class="row${mine ? ' mine' : ''}">
<div><div class="who">${escapeHtml(nameOf(message.author))}</div>${body}</div>
<div class="at">${escapeHtml(formatTime(at))}</div>
</div>
`
}

export function renderHtmlFoot(): string {
  return '</main>\n'
}

/**
 * 낙서를 그린다.
 *
 * 좌표가 0~1 비율이라 보는 크기와 상관없이 같은 모양이 나온다.
 * 색은 토큰 이름이라 여기서 실제 색으로 바꿔준다.
 */
function renderDoodle(
  strokes: readonly {
    points: readonly { x: number; y: number }[]
    color: string
    width: number
  }[],
): string {
  const paths = strokes
    .map(stroke => {
      const d = stroke.points
        .map((point, index) => {
          const x = (point.x * 280).toFixed(1)
          const y = (point.y * 180).toFixed(1)
          return `${index === 0 ? 'M' : 'L'}${x} ${y}`
        })
        .join(' ')

      return `<path d="${d}" stroke="${doodleColor(stroke.color)}" stroke-width="${stroke.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    })
    .join('')

  return `<svg width="280" height="180" viewBox="0 0 280 180">${paths}</svg>`
}

/** 토큰 이름을 실제 색으로. 모르는 이름이면 글자 색을 쓴다 */
function doodleColor(token: string): string {
  switch (token) {
    case 'me':
      return 'var(--me)'
    case 'peer':
      return 'var(--peer)'
    case 'muted':
      return 'var(--muted)'
    default:
      return 'var(--text)'
  }
}

/**
 * HTML 에 그대로 넣으면 안 되는 글자를 바꾼다.
 *
 * **이게 없으면 `<` 하나로 파일이 깨진다.** 대화에 꺾쇠나 따옴표가
 * 들어가는 건 흔한 일이다.
 */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
