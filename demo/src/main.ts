import type { Message } from '@/domain/message/Message'
import { type StickerPose, stickerPoses } from '@/domain/message/MessageContent'
import { progress, remainingMs, remainingWords } from '@/domain/flight/FlightTimer'
import type { PeerId } from '@/domain/peer/PeerId'
import { ulidGenerator } from '@/infrastructure/platform/UlidGenerator'
import { type ConnectPhase, copyFor, longHintFor } from '@/presentation/copy/connecting'
import { stickerMeaning } from '@/presentation/copy/stickers'
import { decidePhase, shouldShowHint } from '@/presentation/stores/connectPhase'
import { type Expression, character, icon, sticker } from './art'
import { Device } from './Device'
import { CABIN_ADDRESS, type Side, World } from './world'

/**
 * 비행기 안의 가상 기기 두 대.
 *
 * **진짜 앱 코드를 돌린다.** 블루투스와 기내 Wi-Fi 를 같이 열어두고
 * 먼저 이어지는 쪽을 쓰고, 한쪽이 끊기면 다른 쪽으로 옮겨 타고,
 * 끊겼다 다시 붙으면 놓친 말을 되찾는다. 전부 `src/` 의 것이다.
 *
 * 흉내 내는 것은 셋뿐이다.
 *
 *   · 선 (블루투스·Wi-Fi 대신 브라우저 안에서 바이트를 나른다)
 *   · 저장소 (SQLite 대신 메모리)
 *   · 화면 (React Native 대신 HTML)
 */

const world = new World()

const android = new Device(
  'host',
  {
    me: 'peer-ybbarng1' as PeerId,
    displayName: '나',
    character: 'orion',
    peerNickname: '여자친구',
  },
  world,
  ulidGenerator,
)

const iphone = new Device(
  'guest',
  {
    me: 'peer-jimin0001' as PeerId,
    displayName: '지민',
    character: 'mira',
    peerNickname: '남자친구',
  },
  world,
  ulidGenerator,
)

const devices: Record<Side, Device> = { host: android, guest: iphone }
const NAME: Record<Side, string> = { host: '안드로이드', guest: '아이폰' }

/** 화면에만 있는 것. 기기 상태가 아니다 */
const ui = {
  drawer: { host: false, guest: false } as Record<Side, boolean>,
  theme: 'dark' as 'dark' | 'light',
  logOpen: true,
  /** 길게 누르고 있는 이모티콘. 뜻만 보여주고 보내지 않는다 */
  asking: null as StickerPose | null,
  /** 시나리오가 도는 중이면 다른 것을 못 누르게 한다 */
  busy: false,
}

/** 이어진 때. 맨 위 띠는 이어지고 3초 뒤 사라진다 (`ConnectionBar`) */
const linkedAt: Record<Side, number | null> = { host: null, guest: null }
const BAR_HIDE_AFTER_MS = 3_000

let dirty = false
function paint(): void {
  if (dirty) return
  dirty = true
  requestAnimationFrame(() => {
    dirty = false
    render()
  })
}

for (const device of [android, iphone]) {
  device.onChange = () => {
    const live = device.connection.isUsable()
    if (live && linkedAt[device.side] === null) linkedAt[device.side] = Date.now()
    if (!live) linkedAt[device.side] = null
    paint()
  }
}
world.onChange = paint
world.onLog = paint

/* ── 그리기 ───────────────────────────────────────── */

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function clockOf(at: Date): string {
  const h = at.getHours()
  const m = String(at.getMinutes()).padStart(2, '0')
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function deliveryMark(message: Message): string {
  switch (message.delivery) {
    case 'read': return icon('checkDouble', 13, 'var(--peer)')
    case 'delivered': return icon('check', 13, 'var(--faint)')
    case 'pending':
    case 'draft': return '<span class="wait">연결되면 보낼게요</span>'
    case 'failed': return '<span class="fail">다시 보내기</span>'
    default: return '<span class="dot"></span>'
  }
}

function bubbleOf(device: Device, message: Message): string {
  const content = message.content

  if (content.kind === 'system') {
    return `<div class="sysline">${esc(noticeText(content.notice))}</div>`
  }

  const mine = message.isMine(device.profile.me)
  const grouped = false

  let body: string
  if (content.kind === 'sticker') {
    const who = content.character as never
    body = `<div class="bubble bare">${sticker(who, content.pose, 104)}</div>`
  } else if (content.kind === 'text') {
    body = `<div class="bubble">${esc(content.text)}</div>`
  } else if (content.kind === 'nudge') {
    body = '<div class="bubble">콕 찔렀어요</div>'
  } else {
    body = '<div class="bubble">낙서를 보냈어요</div>'
  }

  const meta = `<div class="meta">${clockOf(message.orderedAt())}`
    + (mine ? deliveryMark(message) : '') + '</div>'

  return `<div class="row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}">${body}${meta}</div>`
}

function noticeText(notice: string): string {
  switch (notice) {
    case 'link-lost': return '연결이 끊겼어요'
    case 'link-restored': return '다시 연결됐어요'
    case 'conversation-imported': return '대화를 불러왔어요'
    default: return ''
  }
}

function renderLog(device: Device): string {
  if (device.messages.length === 0) {
    return '<div class="log empty"><div><b>아직 주고받은 말이 없어요</b>'
      + '<span>연결되지 않았어도 괜찮아요.<br>써두면 연결될 때 전해집니다.</span></div></div>'
  }

  let out = ''
  let lastDay: Date | null = null

  for (const message of device.messages) {
    const at = message.orderedAt()
    if (lastDay === null || !sameDay(lastDay, at)) {
      out += '<div class="daypill"><span>오늘</span></div>'
      lastDay = at
    }
    out += bubbleOf(device, message)
  }

  if (device.peerTyping) out += '<div class="typing"><i></i><i></i><i></i></div>'

  return `<div class="log" data-log="${device.side}">${out}</div>`
}

/** **진짜 판단 코드를 쓴다.** src/presentation/stores/connectPhase.ts */
function phaseOf(device: Device): ConnectPhase {
  return decidePhase({
    role: device.side,
    connection: device.connection,
    bluetoothOn: world.bluetoothOn[device.side],
    peerFound: false,
    everConnected: device.everConnected,
  })
}

function renderConnecting(device: Device): string {
  /**
   * **상대를 넘겨다보지 않는다.**
   *
   * 인사(`hello`)를 주고받기 전에는 상대가 무엇을 골랐는지 알 길이
   * 없다. 다만 **누구를 기다리는지는 안다.** 첫 실행 안내에서 적어둔
   * 별명을 쓴다. 앱의 `peerName(peer, profile.peerNickname)` 과 같다.
   */
  const peerName = device.peerName ?? device.profile.peerNickname
  const phase = phaseOf(device)

  // **진짜 문구를 쓴다.** src/presentation/copy/connecting.ts
  const copy = copyFor(phase, peerName)

  const action = copy.action === undefined
    ? ''
    : `<button class="action" data-fix="${device.side}">${esc(copy.action)}</button>`

  // 한참 못 찾으면 도움말을 덧붙인다. 언제 띄울지도 진짜 코드가 정한다.
  // 기내 Wi-Fi 이야기는 여기서만 한다.
  const elapsed = Date.now() - device.unlinkedSince
  const hint = shouldShowHint(phase, elapsed)
    ? (() => {
        const long = longHintFor(device.side, peerName)
        return `<div class="hint"><b>${esc(long.title)}</b><ul>`
          + long.lines.map(line => `<li>${esc(line)}</li>`).join('')
          + '</ul></div>'
      })()
    : ''

  return '<div class="connecting">'
    + `<div class="dim">${character(device.peerCharacter, 'sleeping', 104)}</div>`
    + `<h2>${esc(copy.title)}</h2><p>${esc(copy.detail)}</p>${action}${hint}`
    + '</div>'
}

function renderHead(device: Device): string {
  const live = device.connection.isUsable()
  const expr: Expression = !live ? 'disconnected' : device.peerTyping ? 'typing' : 'idle'
  const peerName = device.peerName ?? device.profile.peerNickname

  return '<div class="peerhead">'
    + character(device.peerCharacter, expr, 38)
    + `<div class="who"><div class="name">${esc(peerName)}</div>`
    + `<div class="state">${!live ? '연결을 기다리는 중' : device.peerTyping ? '입력 중...' : '연결됨'}</div></div>`
    + '</div>'
}

/**
 * 목적지까지 얼마나 왔나.
 *
 * **가로폭이 여정 전체다.** 비행기가 왼쪽에서 오른쪽으로 간다.
 * 앱의 `FlightBar.tsx` 와 같은 것을 그린다. 진행도와 남은 시간을
 * 세는 일은 **진짜 도메인 코드**(`FlightTimer.ts`)가 한다.
 */
function renderFlight(device: Device): string {
  const at = device.arrivesAt
  const total = device.flightTotalMs
  if (at === null || total === null) return ''

  const left = remainingMs({ arrivesAt: at }, Date.now())
  const done = progress(left, total)
  const arrived = left === 0

  return '<div class="flight">'
    + '<div class="track"><div class="gone" style="width:' + done * 100 + '%"></div>'
    + `<div class="plane" style="left:${done * 100}%">`
    + icon('plane', 16, arrived ? 'var(--success)' : 'var(--me)') + '</div></div>'
    + `<div class="left${arrived ? ' arrived' : ''}">${esc(remainingWords(left))}</div>`
    + '</div>'
}
/** 내 말 중 아직 못 보낸 것. 앱의 `pendingCount` 와 같다 */
function pendingOf(device: Device): number {
  let count = 0
  for (const message of device.messages) {
    if (!message.isMine(device.profile.me)) continue
    if (message.delivery === 'pending' || message.delivery === 'draft') count += 1
  }
  return count
}

/**
 * 맨 위 띠. **앱의 `ConnectionBar` 와 같은 규칙으로 그린다.**
 *
 *   · 이어지면 어느 길로 이어졌는지 적고 3초 뒤 사라진다
 *   · 짧은 끊김은 알리지 않는다. "다시 잇는 중" 으로 조용히 기다린다
 */
function renderLinkbar(device: Device): string {
  const state = device.connection
  const pending = pendingOf(device)
  const waiting = pending > 0 ? ` · 쓴 말 ${pending}개 보관 중` : ''

  if (state.isUsable()) {
    const at = linkedAt[device.side]
    if (at !== null && Date.now() - at > BAR_HIDE_AFTER_MS) return ''
    const ble = state.link === 'ble'
    return `<div class="linkbar ok">${icon(ble ? 'bluetooth' : 'wifi', 13)}`
      + `${ble ? '블루투스로 이어져 있어요' : 'Wi-Fi 로 이어져 있어요'}</div>`
  }

  if (!device.announceDisconnect) {
    return `<div class="linkbar idle">${icon('refresh', 13)}다시 잇는 중...${waiting}</div>`
  }

  if (state.phase === 'handshaking') {
    return `<div class="linkbar idle">${icon('refresh', 13)}이어지는 중...</div>`
  }
  return `<div class="linkbar idle">${icon('refresh', 13)}찾는 중...${waiting}</div>`
}

function renderDrawer(device: Device): string {
  if (!ui.drawer[device.side]) return ''

  // **두 줄로 놓는다.** 열여섯이나 되어 한 줄이면 한참 밀어야 한다.
  const half = Math.ceil(stickerPoses.length / 2)
  const rows = [stickerPoses.slice(0, half), stickerPoses.slice(half)]
    .map(row => '<div class="strip">' + row
      .map(pose =>
        `<button data-pose="${pose}" data-side="${device.side}"`
        + `${ui.asking === pose ? ' class="asking"' : ''}>`
        + sticker(device.profile.character, pose, 56) + '</button>')
      .join('') + '</div>')
    .join('')

  // 길게 누르면 무슨 말인지 알려준다. 진짜 앱과 같은 글을 쓴다
  const head = ui.asking === null
    ? '<span>누르면 보내져요 · 길게 누르면 뜻이 떠요</span>'
    : `<span class="meaning">${esc(stickerMeaning(ui.asking))}</span>`

  return `<div class="drawer"><div class="head">${head}`
    + `<button data-closedrawer="${device.side}">닫기</button></div>`
    + `<div class="strips">${rows}</div></div>`
}

function renderComposer(device: Device): string {
  const side = device.side
  return '<div class="composer">'
    + `<button class="tool" data-nudge="${side}" title="콕 찌르기">${icon('alert', 19)}</button>`
    + `<button class="tool" data-drawer="${side}" title="이모티콘">${icon('heart', 19)}</button>`
    + `<button class="tool" title="사진 (앱에서만)">${icon('photo', 19)}</button>`
    + `<input placeholder="말을 적어보세요" data-input="${side}">`
    + `<button class="send" data-send="${side}">${icon('send', 16)}</button>`
    + '</div>'
}

/**
 * 위쪽 띠.
 *
 * **두 운영체제가 다르게 그린다.** 아이폰은 배터리가 가로로 눕고,
 * 안드로이드는 세로로 선다. 둘 다 비행기 모드다.
 */
function renderStatusbar(device: Device): string {
  const side = device.side
  const right = '<span class="right">'
    + (world.bluetoothOn[side] ? icon('bluetooth', 12) : '')
    + (world.wifiJoined[side] ? icon('wifi', 12) : '')
    + '<span>✈︎</span><span class="batt"></span></span>'

  return `<div class="statusbar"><span>${clockOf(new Date())}</span>${right}</div>`
}

function renderPhone(device: Device): string {
  const live = device.connection.isUsable()

  return renderStatusbar(device)
    + renderLinkbar(device)
    + (live ? renderFlight(device) : '')
    + (live ? renderHead(device) : '')
    + (live ? renderLog(device) + renderDrawer(device) + renderComposer(device)
            : renderConnecting(device))
}


function renderPanel(): string {
  const live = android.connection.isUsable() && iphone.connection.isUsable()
  const off = ui.busy ? 'disabled' : ''

  /*
    **여기 있는 것은 사람이 하는 일뿐이다.**

    블루투스를 켜고, 기내 Wi-Fi 에 붙고, 자리를 옮긴다. 서로 찾아 붙고
    길을 옮겨 타는 것은 앱이 알아서 하므로 누를 것이 없다. 폰마다 켜고
    끄는 것은 각 폰 위에 있다.
  */
  return `<button data-act="auto" ${off}>바로 연결하기</button>`
    + '<span class="sep"></span>'
    + `<button class="${world.seatsNear ? '' : 'on'}" data-act="seats" ${off}>`
    + `${world.seatsNear ? '멀리 떨어져 앉기' : '가까이 앉기'}</button>`
    + `<button class="${world.isolated ? 'on' : ''}" data-act="isolate" ${off}>손님끼리 막힌 Wi-Fi</button>`
    + '<span class="sep"></span>'
    + `<button data-act="switch" ${off}>멀어져도 Wi-Fi 로 이어가기</button>`
    + `<button data-act="scenario" ${live && !ui.busy ? '' : 'disabled'}>끊겼다 되찾기</button>`
    + '<span class="sep"></span>'
    + `<button data-act="flight" ${live ? '' : 'disabled'}>비행 3시간으로 맞추기</button>`
    + `<button data-act="flight-near" ${live ? '' : 'disabled'}>거의 도착으로</button>`
    + `<button data-act="flight-off" ${live ? '' : 'disabled'}>비행 치우기</button>`
    + '<span class="sep"></span>'
    + `<button class="${world.chop > 1 ? 'on' : ''}" data-act="chop">바이트 쪼개기</button>`
    + `<button class="${world.slow ? 'on' : ''}" data-act="slow">느린 선</button>`
    + '<span class="sep"></span>'
    + `<button data-act="theme">${ui.theme === 'dark' ? '밝은 화면' : '어두운 화면'}</button>`
    + `<button class="${ui.logOpen ? 'on' : ''}" data-act="logtoggle">오간 기록</button>`
}

/** 폰 위에 붙는 손잡이. 그 폰의 주인이 설정에서 하는 일이다 */
function renderControls(side: Side): string {
  const bt = world.bluetoothOn[side]
  const wifi = world.wifiJoined[side]
  return `<button class="${bt ? 'on' : ''}" data-bt="${side}">${icon('bluetooth', 13)}블루투스 ${bt ? '켜짐' : '꺼짐'}</button>`
    + `<button class="${wifi ? 'on' : ''}" data-wifi="${side}">${icon('wifi', 13)}기내 Wi-Fi ${wifi ? CABIN_ADDRESS[side] : '안 붙음'}</button>`
}

function linkName(link: string | null): string {
  return link === 'ble' ? '블루투스' : link === 'wifi' ? 'Wi-Fi' : ''
}

function renderNetLog(): string {
  if (!ui.logOpen) return ''

  const rows = world.log.slice(-80).reverse().map(event => {
    const who = event.side === 'net' ? '비행기' : NAME[event.side]
    const tag = event.link === null ? '' : `<span class="tag ${event.link}">${linkName(event.link)}</span>`
    return `<div class="ev ${event.kind}"><span class="who">${who}</span>`
      + `<span class="txt">${tag}${esc(event.text)}</span></div>`
  }).join('')

  /*
    단계 이름은 **폰 밖에** 둔다.

    `need-hotspot` 같은 말은 앱 화면에 안 뜬다. 여기 적어두는 이유는
    진짜 `decidePhase` 가 무엇을 골랐는지, 진짜 `CompositeTransport` 가
    어느 길을 쓰는지 보여주기 위해서다.
  */
  const nameOf = (device: Device): string =>
    device.connection.isUsable()
      ? `<code>${linkName(device.connection.link)}로 이어짐</code>`
      : `<code>${phaseOf(device)}</code>`

  const linkState = (device: Device): string =>
    (['ble', 'wifi'] as const)
      .map(kind => `${linkName(kind)} ${device.links[kind].currentState().isUsable() ? '●' : '○'}`)
      .join(' · ')

  const phases = '<div class="phases">'
    + `안드로이드 ${nameOf(android)} <span>${linkState(android)}</span><br>`
    + `아이폰 ${nameOf(iphone)} <span>${linkState(iphone)}</span></div>`

  const sum = (kind: 'ble' | 'wifi') => android.links[kind].bytesOut + iphone.links[kind].bytesOut
  const rejected = (['ble', 'wifi'] as const)
    .reduce((n, kind) => n + android.links[kind].rejected + iphone.links[kind].rejected, 0)

  return '<div class="netlog"><div class="netlog-head">오간 것</div>'
    + `<div class="events">${rows || '<div class="ev info"><span class="txt">아직 아무 일도 없어요</span></div>'}</div>`
    + phases
    + `<div class="bytes">오간 바이트 · 블루투스 ${sum('ble')}B · Wi-Fi ${sum('wifi')}B`
    + `${rejected > 0 ? ` · 버려진 봉투 ${rejected}` : ''}</div></div>`
}

function render(): void {
  const keep: Partial<Record<Side, { value: string; focused: boolean }>> = {}
  for (const side of ['host', 'guest'] as Side[]) {
    const input = document.querySelector<HTMLInputElement>(`[data-input="${side}"]`)
    if (input !== null) {
      keep[side] = { value: input.value, focused: document.activeElement === input }
    }
  }

  document.body.className = ui.theme === 'light' ? 'light' : ''
  el('panel').innerHTML = renderPanel()
  el('controls-host').innerHTML = renderControls('host')
  el('controls-guest').innerHTML = renderControls('guest')
  el('screen-host').innerHTML = renderPhone(android)
  el('screen-guest').innerHTML = renderPhone(iphone)
  el('netlog-slot').innerHTML = renderNetLog()

  for (const side of ['host', 'guest'] as Side[]) {
    const log = document.querySelector<HTMLElement>(`[data-log="${side}"]`)
    if (log !== null) log.scrollTop = log.scrollHeight

    const input = document.querySelector<HTMLInputElement>(`[data-input="${side}"]`)
    const saved = keep[side]
    if (input !== null && saved !== undefined) {
      input.value = saved.value
      if (saved.focused) input.focus()
    }
  }
}

function el(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`${id} 가 없다`)
  return found
}

/* ── 조작 ─────────────────────────────────────────── */

/*
  **"상대 찾아 잇기" 버튼은 없다.** 앱에 그런 버튼이 없기 때문이다.
  앱을 여는 순간 두 길을 같이 열고, 각 길이 알아서 계속 찾는다.
  다시 거는 간격도 앱 것(`retryDelayMillis`)을 그대로 쓴다.
*/
void android.start()
void iphone.start()

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (check()) return true
    await sleep(200)
  }
  return check()
}

const bothLive = () => android.connection.isUsable() && iphone.connection.isUsable()

async function scenario(run: () => Promise<void>): Promise<void> {
  if (ui.busy) return
  ui.busy = true
  paint()
  try {
    await run()
  } finally {
    ui.busy = false
    paint()
  }
}

/** 둘 다 블루투스를 켜고 가까이 앉는다 */
async function autoConnect(): Promise<void> {
  world.setSeatsNear(true)
  world.setBluetooth('host', true)
  await sleep(300)
  world.setBluetooth('guest', true)
  await waitUntil(bothLive, 8000)
}

/**
 * 블루투스로 이야기하다 멀어져도 기내 Wi-Fi 로 이어간다.
 *
 * 2026-09 비행에서 실제로 필요했던 것이다. 자리가 멀어 블루투스가
 * 안 닿았는데, 기내 Wi-Fi 는 있었다. **옮겨 타는 것은 진짜
 * `CompositeTransport` 가 한다.** 데모는 자리만 옮긴다.
 */
async function switchScenario(): Promise<void> {
  world.note('net', '── 멀어져도 Wi-Fi 로 이어가기 ──')
  world.setIsolated(false)
  await autoConnect()

  world.note('net', '둘 다 기내 Wi-Fi 에 붙어요. 아이폰이 안드로이드를 찾아요')
  world.setWifi('host', true)
  await sleep(300)
  world.setWifi('guest', true)
  await waitUntil(
    () => android.links.wifi.currentState().isUsable() && iphone.links.wifi.currentState().isUsable(),
    15000,
  )

  await android.sendText('블루투스로 보낸 말')
  await sleep(1200)

  world.note('net', '두 길이 다 이어져 있어요. 이제 멀리 떨어져 앉아요')
  world.setSeatsNear(false)
  await sleep(1200)

  await android.sendText('멀어진 뒤에 보낸 말')
  await iphone.sendText('Wi-Fi 로 잘 와요')
}

/**
 * 끊겼다 되찾기.
 *
 * **이 앱에서 가장 중요한 성질을 눈으로 본다.** 끊긴 동안 쓴 말이
 * 다시 붙을 때 도착하고, 상대가 못 받은 것도 인사하며 되찾는다.
 */
async function recoveryScenario(): Promise<void> {
  world.note('net', '── 끊겼다 되찾기 ──')

  await android.sendText('이건 끊기기 전에 보낸 말')
  await sleep(700)

  world.note('net', '멀리 떨어지고 기내 Wi-Fi 도 끊겨요')
  world.setSeatsNear(false)
  world.setWifi('host', false)
  world.setWifi('guest', false)
  await sleep(800)

  await android.sendText('끊긴 동안 쓴 말 하나')
  await sleep(200)
  await android.sendText('끊긴 동안 쓴 말 둘')
  await sleep(200)
  await iphone.sendText('나도 끊긴 동안 썼어')
  await sleep(1800)

  world.note('net', '다시 가까이 앉아요. 앱이 알아서 다시 붙어요')
  world.setSeatsNear(true)
  await waitUntil(bothLive, 8000)
}

document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-act],[data-bt],[data-wifi],[data-send],[data-nudge],[data-drawer],[data-closedrawer],[data-pose],[data-fix]')
  if (target === null) return
  if ((target as HTMLButtonElement).disabled) return

  const act = target.dataset.act

  if (act === 'auto') return void scenario(autoConnect)
  if (act === 'switch') return void scenario(switchScenario)
  if (act === 'scenario') return void scenario(recoveryScenario)

  // 안드로이드가 정하면 아이폰에도 건너간다. 진짜 봉투가 오간다.
  if (act === 'flight') return void android.shareFlight(3 * 60 * 60 * 1000)
  if (act === 'flight-near') return void android.shareFlight(90 * 1000)
  if (act === 'flight-off') return void android.shareFlight(0)

  if (act === 'seats') return world.setSeatsNear(!world.seatsNear)
  if (act === 'isolate') return world.setIsolated(!world.isolated)

  if (act === 'chop') {
    world.chop = world.chop > 1 ? 1 : 12
    world.note('net', world.chop > 1 ? '바이트를 12조각으로 쪼개 보내요' : '통째로 보내요')
    return paint()
  }

  if (act === 'slow') {
    world.slow = !world.slow
    world.note('net', world.slow ? '선을 여덟 배 느리게 해요' : '선을 원래 빠르기로 돌려요')
    return paint()
  }

  if (act === 'theme') {
    ui.theme = ui.theme === 'dark' ? 'light' : 'dark'
    return paint()
  }

  if (act === 'logtoggle') {
    ui.logOpen = !ui.logOpen
    return paint()
  }

  if (target.dataset.bt !== undefined) {
    const side = target.dataset.bt as Side
    return world.setBluetooth(side, !world.bluetoothOn[side])
  }

  if (target.dataset.wifi !== undefined) {
    const side = target.dataset.wifi as Side
    return world.setWifi(side, !world.wifiJoined[side])
  }

  /*
    이어지는 화면의 "블루투스 켜러 가기".

    **누른다고 붙지 않는다.** 설정으로 데려다줄 뿐이다. 여기서는 그
    폰의 블루투스를 켠 것으로 친다. 붙는 것은 앱이 알아서 한다.
  */
  if (target.dataset.fix !== undefined) {
    return world.setBluetooth(target.dataset.fix as Side, true)
  }

  const side = (target.dataset.send ?? target.dataset.nudge ?? target.dataset.drawer
    ?? target.dataset.closedrawer ?? target.dataset.side) as Side | undefined
  if (side === undefined) return

  if (target.dataset.send !== undefined) {
    const input = document.querySelector<HTMLInputElement>(`[data-input="${side}"]`)
    if (input === null) return
    const text = input.value.trim()
    if (text.length === 0) return
    input.value = ''
    return void devices[side].sendText(text)
  }

  if (target.dataset.nudge !== undefined) return void devices[side].sendNudge()

  if (target.dataset.drawer !== undefined) {
    ui.drawer[side] = !ui.drawer[side]
    return paint()
  }

  if (target.dataset.closedrawer !== undefined) {
    ui.drawer[side] = false
    return paint()
  }

  if (target.dataset.pose !== undefined) {
    // 뜻을 묻는 중이었으면 보내지 않는다. 손을 뗀 것뿐이다.
    if (longPressed) return

    ui.drawer[side] = false
    void devices[side].sendSticker(target.dataset.pose as StickerPose)
    return paint()
  }
})

/**
 * 길게 누르면 뜻을 알려준다.
 *
 * **그림만으로는 애매한 것이 있다.** 팔짱 낀 건 "안 돼"인지 "추워"인지
 * 헷갈린다. 짧게 누르면 그대로 나가므로 보내는 데 한 걸음이 늘지 않는다.
 * 앱의 `onLongPress` 와 같은 자리다.
 */
let holdTimer: ReturnType<typeof setTimeout> | null = null
let longPressed = false

function startHold(pose: StickerPose): void {
  longPressed = false
  if (holdTimer !== null) clearTimeout(holdTimer)

  holdTimer = setTimeout(() => {
    longPressed = true
    ui.asking = pose
    paint()
  }, 300)
}

function endHold(): void {
  if (holdTimer !== null) clearTimeout(holdTimer)
  holdTimer = null

  if (ui.asking !== null) {
    ui.asking = null
    paint()
  }
}

document.addEventListener('pointerdown', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-pose]')
  if (target?.dataset.pose === undefined) return

  startHold(target.dataset.pose as StickerPose)
})

document.addEventListener('pointerup', endHold)
document.addEventListener('pointercancel', endHold)
document.addEventListener('pointerleave', endHold)

document.addEventListener('input', event => {
  const input = event.target as HTMLInputElement
  const side = input.dataset?.input as Side | undefined
  if (side === undefined) return

  devices[side].tellTyping(input.value.length > 0)
})

document.addEventListener('keydown', event => {
  const input = event.target as HTMLInputElement
  const side = input.dataset?.input as Side | undefined
  if (side === undefined || event.key !== 'Enter') return

  const text = input.value.trim()
  if (text.length === 0) return
  input.value = ''
  void devices[side].sendText(text)
})

/**
 * 보이는 것은 읽음으로 친다.
 *
 * 실제 앱도 화면에 보이는 동안 읽음으로 바꾼다. 여기서는 두 화면이
 * 늘 보이므로 잠깐 뒤에 바꾼다.
 *
 * **안 읽은 것이 있을 때만 돈다.** 아무 때나 돌리면 화면을 계속
 * 다시 그려서 말풍선이 깜빡인다.
 */
function unreadCount(device: Device): number {
  let count = 0
  for (const message of device.messages) {
    if (!message.isMine(device.profile.me) && message.delivery !== 'read') count += 1
  }
  return count
}

setInterval(() => {
  if (unreadCount(android) > 0 && android.connection.isUsable()) void android.readAll()
  if (unreadCount(iphone) > 0 && iphone.connection.isUsable()) void iphone.readAll()
}, 900)

/*
  1초마다 다시 그린다.

  비행기를 움직이고, 3초 지난 띠를 걷고, 오래 못 찾으면 도움말을 띄운다.
  앱은 비행기를 1분마다 다시 세지만 데모는 "거의 도착" 이 90초짜리라
  1초마다 센다.
*/
setInterval(render, 1000)

world.note('net', '비행기 모드를 켠 두 폰이에요. 블루투스부터 켜보세요')
render()
