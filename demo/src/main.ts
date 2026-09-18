import type { Message } from '@/domain/message/Message'
import { type StickerPose, stickerPoses } from '@/domain/message/MessageContent'
import { retryDelayMillis } from '@/domain/connection/ConnectionState'
import { progress, remainingMs, remainingWords } from '@/domain/flight/FlightTimer'
import type { PeerId } from '@/domain/peer/PeerId'
import { ulidGenerator } from '@/infrastructure/platform/UlidGenerator'
import { type ConnectPhase, copyFor } from '@/presentation/copy/connecting'
import { stickerMeaning } from '@/presentation/copy/stickers'
import { decidePhase } from '@/presentation/stores/connectPhase'
import { type Expression, character, icon, sticker } from './art'
import { Device } from './Device'
import { type Side, VirtualNetwork } from './network'

/**
 * 가상 기기 두 대를 띄운다.
 *
 * **진짜 앱 코드를 돌린다.** 핫스팟을 켜고, 서로 찾고, 붙고, 인사하고,
 * 말을 주고받고, 끊겼다 다시 붙으면 놓친 말을 되찾는다. 전부
 * `src/` 의 것이다.
 *
 * 흉내 내는 것은 셋뿐이다.
 *
 *   · 선 (진짜 Wi-Fi 대신 브라우저 안에서 바이트를 나른다)
 *   · 저장소 (SQLite 대신 메모리)
 *   · 화면 (React Native 대신 HTML)
 */

const net = new VirtualNetwork()

const android = new Device(
  'host',
  {
    me: 'peer-ybbarng1' as PeerId,
    displayName: '나',
    character: 'orion',
    peerNickname: '여자친구',
  },
  net,
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
  net,
  ulidGenerator,
)

const devices: Record<Side, Device> = { host: android, guest: iphone }

/** 화면에만 있는 것. 기기 상태가 아니다 */
const ui = {
  drawer: { host: false, guest: false } as Record<Side, boolean>,
  theme: 'dark' as 'dark' | 'light',
  logOpen: true,
  /** 길게 누르고 있는 이모티콘. 뜻만 보여주고 보내지 않는다 */
  asking: null as StickerPose | null,
}

let dirty = false
function paint(): void {
  if (dirty) return
  dirty = true
  requestAnimationFrame(() => {
    dirty = false
    render()
  })
}

android.onChange = paint
iphone.onChange = paint
net.onChange = paint
net.onLog = paint

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
  const onOurNetwork = device.side === 'host' ? net.hotspotOn : net.guestJoined

  return decidePhase({
    role: device.side,
    connection: device.connection,
    onPrivateNetwork: onOurNetwork,
    peerFound: false,
    everConnected: device.messages.length > 0,
  })
}

function renderConnecting(device: Device): string {
  /**
   * **상대를 넘겨다보지 않는다.**
   *
   * 인사(`hello`)를 주고받기 전에는 상대가 무엇을 골랐는지 알 길이
   * 없다. 데모는 두 기기를 한 화면에 들고 있어서 몰래 볼 수 있지만,
   * 그러면 실제 첫 연결과 다른 것을 보여주게 된다.
   *
   * 다만 **누구를 기다리는지는 안다.** 첫 실행 안내에서 적어둔 별명을
   * 쓴다. 앱의 `peerName(peer, profile.peerNickname)` 과 같다.
   */
  const peerName = device.peerName ?? device.profile.peerNickname

  // **진짜 문구를 쓴다.** src/presentation/copy/connecting.ts
  const copy = copyFor(phaseOf(device), peerName)

  const action = copy.action === undefined
    ? ''
    : `<button class="action" data-fix="${device.side}">${esc(copy.action)}</button>`

  return '<div class="connecting">'
    + `<div class="dim">${character(device.peerCharacter, 'sleeping', 104)}</div>`
    + `<h2>${esc(copy.title)}</h2><p>${esc(copy.detail)}</p>${action}`
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

function renderLinkbar(device: Device): string {
  const state = device.connection

  if (state.isUsable()) {
    return `<div class="linkbar ok">${icon('wifi', 13)}연결됨</div>`
  }
  if (device.messages.length > 0) {
    return `<div class="linkbar bad">${icon('alert', 13)}연결이 끊겼어요 · 다시 붙는 중</div>`
  }

  // **영어 단계 이름을 띄우지 않는다.** `searching` 이라고 적어두면
  // 앱이 고장 난 줄 안다. 아래 로그 창에는 그대로 적어둔다.
  const waiting = state.phase === 'searching' || state.phase === 'handshaking'
  return `<div class="linkbar idle">${icon('wifi', 13)}`
    + `${waiting ? '상대를 찾는 중' : '아직 연결 전이에요'}</div>`
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
 * 안드로이드는 세로로 선다. 비행기 표시도 자리가 다르다.
 */
function renderStatusbar(device: Device): string {
  const hosting = net.hotspotOn && device.side === 'host'
  const joined = net.guestJoined && device.side === 'guest'

  const right = '<span class="right">'
    + (hosting ? '<span>핫스팟</span>' : '')
    + (joined ? icon('wifi', 12) : '')
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
  const linked = net.isLinked()

  /*
    **여기 있는 것은 사람이 폰으로 하는 일뿐이다.**

    핫스팟을 켜고, Wi-Fi 를 고르고, 멀어졌다 돌아온다. 서로 찾아
    붙는 것은 앱이 알아서 하므로 누를 것이 없다. 아래 두 줄은
    좁고 나쁜 길을 흉내 내는 손잡이다.
  */
  return '<button data-act="auto">바로 연결하기</button>'
    + '<span class="sep"></span>'
    + `<button class="${net.hotspotOn ? 'on' : ''}" data-act="hotspot">`
    + `${net.hotspotOn ? '핫스팟 끄기' : '핫스팟 켜기'}</button>`
    + `<button class="${net.guestJoined ? 'on' : ''}" data-act="join">`
    + `${net.guestJoined ? 'Wi-Fi 에서 나가기' : 'Wi-Fi 에 들어가기'}</button>`
    + '<span class="sep"></span>'
    + `<button data-act="drop" ${linked ? '' : 'disabled'}>멀어지기</button>`
    + `<button data-act="reconnect" ${net.jammed ? '' : 'disabled'}>돌아오기</button>`
    + `<button data-act="scenario" ${linked ? '' : 'disabled'}>끊겼다 되찾기 해보기</button>`
    + '<span class="sep"></span>'
    + `<button data-act="flight" ${linked ? '' : 'disabled'}>비행 3시간으로 맞추기</button>`
    + `<button data-act="flight-near" ${linked ? '' : 'disabled'}>거의 도착으로</button>`
    + `<button data-act="flight-off" ${linked ? '' : 'disabled'}>비행 치우기</button>`
    + '<span class="sep"></span>'
    + `<button class="${net.chop > 1 ? 'on' : ''}" data-act="chop">바이트 쪼개기</button>`
    + `<button class="${net.lossRate > 0 ? 'on' : ''}" data-act="loss">10% 잃어버리기</button>`
    + `<button class="${net.latencyMs > 200 ? 'on' : ''}" data-act="slow">느린 망</button>`
    + '<span class="sep"></span>'
    + `<button data-act="theme">${ui.theme === 'dark' ? '밝은 화면' : '어두운 화면'}</button>`
    + `<button class="${ui.logOpen ? 'on' : ''}" data-act="logtoggle">오간 기록</button>`
}

function renderNetLog(): string {
  if (!ui.logOpen) return ''

  const rows = net.log.slice(-60).reverse().map(event => {
    const who = event.side === 'net' ? '망' : event.side === 'host' ? '안드로이드' : '아이폰'
    return `<div class="ev ${event.kind}"><span class="who">${who}</span>`
      + `<span class="txt">${esc(event.text)}</span></div>`
  }).join('')

  /*
    단계 이름은 **폰 밖에** 둔다.

    `need-hotspot` 같은 말은 앱 화면에 안 뜬다. 여기 적어두는 이유는
    진짜 `decidePhase` 가 무엇을 골랐는지 보여주기 위해서다.
  */
  const nameOf = (device: Device): string =>
    device.connection.isUsable() ? '<code>이어짐</code>' : `<code>${phaseOf(device)}</code>`

  const phases = `<div class="phases">지금 단계 · 안드로이드 ${nameOf(android)}`
    + ` · 아이폰 ${nameOf(iphone)}</div>`

  return '<div class="netlog"><div class="netlog-head">오간 것</div>'
    + `<div class="events">${rows || '<div class="ev info"><span class="txt">아직 아무 일도 없어요</span></div>'}</div>`
    + phases
    + `<div class="bytes">보낸 바이트 · 안드로이드 ${android.transport.bytesOut}B · 아이폰 ${iphone.transport.bytesOut}B`
    + `${android.transport.rejected + iphone.transport.rejected > 0
        ? ` · 버려진 봉투 ${android.transport.rejected + iphone.transport.rejected}` : ''}</div></div>`
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

/**
 * 붙는 쪽이 찾아 나선다.
 *
 * **앱에는 "상대 찾아 잇기" 같은 버튼이 없다.** 켜져 있는 동안
 * 알아서 계속 찾는다. 사람이 누를 것은 핫스팟과 Wi-Fi 뿐이다.
 * 그래서 데모도 버튼 대신 아래 `setInterval` 이 계속 두드린다.
 */
async function tryConnect(): Promise<void> {
  if (net.isLinked()) return

  const failed = await iphone.connect()
  if (failed !== null) {
    paint()
    return
  }

  // 붙었으면 여는 쪽도 받는다. 선이 없으면 `acceptIncoming` 이 무시한다.
  android.acceptIncoming()
  paint()
}

/**
 * 계속 두드린다. **간격은 진짜 앱 것을 쓴다.**
 *
 * 실패할 때마다 1, 2, 4, 8, 16, 30초로 늘린다(`retryDelayMillis`).
 * 쉬지 않고 두드리면 배터리가 먼저 죽고, 그러면 세 시간을 못 버틴다.
 *
 * 그래서 조건이 갖춰져도 **곧바로 붙지 않을 수 있다.** 실제 앱이 그렇다.
 * 기다리기 싫으면 위의 `돌아오기` 처럼 사람이 다시 시도할 수 있다
 * (앱의 `retryNow`).
 */
let knocking = false
let attempt = 0
let knockTimer: ReturnType<typeof setTimeout> | null = null

function scheduleKnock(): void {
  if (knockTimer !== null) return

  const delay = attempt === 0 ? 300 : retryDelayMillis(attempt)
  if (attempt > 0) {
    net.note('guest', `${Math.round(delay / 1000)}초 뒤에 다시 걸어볼게요`)
  }

  knockTimer = setTimeout(() => {
    knockTimer = null
    void knock()
  }, delay)
}

async function knock(): Promise<void> {
  if (knocking) return
  if (net.isLinked()) {
    attempt = 0
    return
  }
  if (!net.hotspotOn || !net.guestJoined || net.jammed) {
    // 아직 조건이 안 됐다. 이건 실패로 세지 않는다
    attempt = 0
    scheduleKnock()
    return
  }

  knocking = true
  try {
    await tryConnect()
    attempt = net.isLinked() ? 0 : attempt + 1
  } finally {
    knocking = false
    scheduleKnock()
  }
}

scheduleKnock()

/** 사람이 다시 시도한다. 기다리지 않고 지금 건다 (앱의 `retryNow`) */
function knockNow(): void {
  attempt = 0
  if (knockTimer !== null) clearTimeout(knockTimer)
  knockTimer = null
  void knock()
}

/** 핫스팟 켜기부터 잇기까지 한 번에 */
async function autoConnect(): Promise<void> {
  net.setJammed(false)
  net.setHotspot(true)
  paint()
  await sleep(400)

  net.setGuestJoined(true)
  paint()
  await sleep(400)

  knockNow()
}

/**
 * 끊겼다 되찾기.
 *
 * **이 앱에서 가장 중요한 성질을 눈으로 본다.** 끊긴 동안 쓴 말이
 * 다시 붙을 때 도착하고, 상대가 못 받은 것도 인사하며 되찾는다.
 */
async function recoveryScenario(): Promise<void> {
  net.note('net', '── 끊겼다 되찾기를 해볼게요 ──')

  await android.sendText('이건 끊기기 전에 보낸 말')
  await sleep(600)

  net.setJammed(true)
  android.transport.lose()
  iphone.transport.lose()
  paint()
  await sleep(700)

  await android.sendText('끊긴 동안 쓴 말 하나')
  await sleep(200)
  await android.sendText('끊긴 동안 쓴 말 둘')
  await sleep(200)
  await iphone.sendText('나도 끊긴 동안 썼어')
  await sleep(700)

  net.note('net', '신호를 돌려줍니다. 앱이 알아서 다시 붙어요')
  net.setJammed(false)
  knockNow()
  paint()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-act],[data-send],[data-nudge],[data-drawer],[data-closedrawer],[data-pose],[data-fix]')
  if (target === null) return

  const act = target.dataset.act

  if (act === 'auto') return void autoConnect()

  if (act === 'scenario') return void recoveryScenario()

  // 안드로이드가 정하면 아이폰에도 건너간다. 진짜 봉투가 오간다.
  if (act === 'flight') return void android.shareFlight(3 * 60 * 60 * 1000)
  if (act === 'flight-near') return void android.shareFlight(90 * 1000)
  if (act === 'flight-off') return void android.shareFlight(0)

  if (act === 'hotspot') {
    net.setHotspot(!net.hotspotOn)
    if (!net.hotspotOn) {
      android.transport.lose()
      iphone.transport.lose()
    }
    return paint()
  }

  if (act === 'join') {
    net.setGuestJoined(!net.guestJoined)
    return paint()
  }

  if (act === 'drop') {
    net.setJammed(true)
    android.transport.lose()
    iphone.transport.lose()
    return paint()
  }

  if (act === 'reconnect') {
    // 신호만 돌려준다. 붙는 건 앱이 알아서 한다.
    net.setJammed(false)
    knockNow()
    return paint()
  }

  if (act === 'chop') {
    net.chop = net.chop > 1 ? 1 : 12
    net.note('net', net.chop > 1 ? '바이트를 12조각으로 쪼개 보내요' : '통째로 보내요')
    return paint()
  }

  if (act === 'loss') {
    net.lossRate = net.lossRate > 0 ? 0 : 0.1
    net.note('net', net.lossRate > 0 ? '10% 를 잃어버려요' : '안 잃어버려요')
    return paint()
  }

  if (act === 'slow') {
    net.latencyMs = net.latencyMs > 200 ? 40 : 600
    net.note('net', `한 번 가는 데 ${net.latencyMs}ms`)
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

  /*
    이어지는 화면의 "핫스팟 켜러 가기" / "Wi-Fi 고르러 가기".

    **누른다고 붙지 않는다.** 설정으로 데려다줄 뿐이다. 상대가 핫스팟을
    안 켰으면 목록에 아무것도 없고, `setGuestJoined` 가 그렇다고 적는다.
    붙는 것은 조건이 갖춰진 뒤 앱이 알아서 한다.
  */
  if (target.dataset.fix !== undefined) {
    if (target.dataset.fix === 'host') net.setHotspot(true)
    else net.setGuestJoined(true)
    return paint()
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
  if (!net.isLinked()) return
  if (unreadCount(android) > 0) void android.readAll()
  if (unreadCount(iphone) > 0) void iphone.readAll()
}, 900)

/*
  비행기를 움직인다.

  앱은 1분마다 다시 센다. 초를 안 보여주니 그걸로 충분하고 배터리도 는다.
  **데모는 1초마다 센다.** 여기서는 "거의 도착" 이 90초짜리라 1분을
  기다리면 움직이는 걸 볼 수 없다.
*/
setInterval(() => {
  if (android.arrivesAt !== null || iphone.arrivesAt !== null) render()
}, 1000)

net.note('net', '가상 망을 열었어요. 핫스팟부터 켜보세요')
render()
