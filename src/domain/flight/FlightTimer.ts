/**
 * 목적지까지 남은 시간.
 *
 * **둘이 같은 숫자를 본다.** 한쪽이 정하면 상대에게 건너가고, 그때부터
 * 각자의 폰이 알아서 줄여 나간다.
 *
 * ## 시각이 아니라 "남은 길이" 를 보낸다
 *
 * 두 폰의 시계가 다를 수 있다. 특히 시차를 넘는 비행에서는 한쪽이
 * 먼저 시간대를 바꾼다. "오후 3시에 도착" 이라고 보내면 **받는 쪽에서
 * 엉뚱한 시각이 된다.**
 *
 * 그래서 "앞으로 2시간 40분" 을 보내고, 받는 쪽이 자기 시계로
 * 도착 시각을 다시 센다. 건너가는 데 걸리는 몇백 밀리초만큼 어긋나는데,
 * 비행 시간에 견주면 없는 것과 같다.
 */

/** 이보다 길게는 못 잡는다. 지구 반대편도 스무 시간이면 간다 */
export const MAX_FLIGHT_MS = 24 * 60 * 60 * 1000

export interface FlightTimer {
  /** 이 폰의 시계로 언제 도착하나 */
  readonly arrivesAt: number
}

/**
 * 남은 길이로 도착 시각을 센다.
 *
 * 0 이하를 주면 끄는 것으로 본다. 화면에서 치운다.
 */
export function startFlight(remainingMs: number, now: number): FlightTimer | null {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null
  if (remainingMs > MAX_FLIGHT_MS) return null

  return { arrivesAt: now + Math.round(remainingMs) }
}

/** 지금 얼마나 남았나. 다 됐으면 0 */
export function remainingMs(timer: FlightTimer, now: number): number {
  return Math.max(0, timer.arrivesAt - now)
}

export function hasArrived(timer: FlightTimer, now: number): boolean {
  return remainingMs(timer, now) === 0
}

/**
 * 남은 시간을 사람이 읽는 말로.
 *
 * **초는 안 보여준다.** 세 시간 비행에서 초 단위가 흐르면 눈만 간다.
 * 1분 아래로 내려가야 "곧 도착" 이라고 바꾼다.
 */
export function remainingWords(leftMs: number): string {
  if (leftMs <= 0) return '도착했어요'
  if (leftMs < 60_000) return '곧 도착해요'

  const totalMinutes = Math.floor(leftMs / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return `${minutes}분 남았어요`
  if (minutes === 0) return `${hours}시간 남았어요`

  return `${hours}시간 ${minutes}분 남았어요`
}

/**
 * 얼마나 왔나. 0에서 1 사이.
 *
 * 막대를 그리는 데 쓴다. 총 길이를 모르면 그릴 수 없으므로 같이 받는다.
 */
export function progress(leftMs: number, totalMs: number): number {
  if (totalMs <= 0) return 1
  const done = (totalMs - leftMs) / totalMs
  return Math.min(1, Math.max(0, done))
}

/**
 * 시간과 분을 밀리초로.
 *
 * 설정 화면에서 받은 것을 옮길 때 쓴다. 이상한 값은 `null` 이다.
 */
export function fromHoursAndMinutes(hours: number, minutes: number): number | null {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours < 0 || minutes < 0 || minutes > 59) return null

  const total = (hours * 60 + minutes) * 60_000
  if (total <= 0 || total > MAX_FLIGHT_MS) return null

  return total
}

/**
 * 출발 시각과 도착 시각으로 비행을 잡는다.
 *
 * 남은 시간만 넣으면 **진행 막대가 넣은 순간부터 시작한다.** 이미
 * 이륙한 지 한 시간 뒤에 넣으면 비행기가 출발점에 서 있는 셈이다.
 * 출발과 도착을 둘 다 넣으면 어디쯤 왔는지가 맞는다.
 *
 * ## 시·분만 받는다
 *
 * 탑승권에 적힌 그대로다. 날짜는 안 받는다. 그래서 자정을 넘는
 * 비행(23:30 → 06:10)은 도착이 출발보다 작은 것으로 알아챈다.
 *
 * **셋 다 같은 시계로 읽는다.** 시차가 있으면 사용자가 출발지 시각으로
 * 둘 다 넣는다고 본다. 화면이 그렇게 안내한다.
 *
 * ## 아직 안 떴을 때와 이미 내렸을 때
 *
 * 시·분만으로는 "오늘 15시" 가 지난 것인지 올 것인지 알 수 없다. 그래서
 * 이렇게 가른다.
 *
 *   · 출발 뒤 도착 전 → 비행 중. 남은 것은 도착까지
 *   · 출발이 12시간 안에 온다 → 게이트에서 미리 넣은 것. 남은 것은
 *     출발까지 + 비행 길이. 비행기는 출발 전까지 출발점에 서 있다
 *   · 그 밖 → 이미 내린 것으로 보고 `null`
 *
 * 하루 안에서 도는 값이라 순수하다. 지금 시각도 시·분으로 받는다.
 */
export interface FlightSpan {
  readonly totalMs: number
  readonly remainingMs: number
}

const MINUTES_IN_DAY = 24 * 60

/** 이만큼 안에 출발하면 "아직 안 뜬 것" 으로 본다 */
export const UPCOMING_WINDOW_MINUTES = 12 * 60

export function fromDepartureAndArrival(input: {
  readonly departMinutes: number
  readonly arriveMinutes: number
  readonly nowMinutes: number
}): FlightSpan | null {
  const { departMinutes, arriveMinutes, nowMinutes } = input

  if (![departMinutes, arriveMinutes, nowMinutes].every(isMinuteOfDay)) return null

  // 도착이 출발보다 앞이면 자정을 넘긴 것이다
  const durationMinutes =
    (arriveMinutes - departMinutes + MINUTES_IN_DAY) % MINUTES_IN_DAY
  if (durationMinutes === 0) return null

  const sinceDeparture = (nowMinutes - departMinutes + MINUTES_IN_DAY) % MINUTES_IN_DAY
  const totalMs = durationMinutes * 60_000

  if (sinceDeparture < durationMinutes) {
    return { totalMs, remainingMs: (durationMinutes - sinceDeparture) * 60_000 }
  }

  const untilDeparture = MINUTES_IN_DAY - sinceDeparture
  if (untilDeparture > UPCOMING_WINDOW_MINUTES) return null

  // 출발까지와 비행 길이를 더해도 하루를 못 넘긴다. 하루 안에서 도는
  // 값이라 여기 오면 둘의 합이 늘 하루 아래다.
  return { totalMs, remainingMs: (untilDeparture + durationMinutes) * 60_000 }
}

/** 시와 분을 하루 안의 분으로. 이상한 값은 `null` */
export function minuteOfDay(hours: number, minutes: number): number | null {
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function isMinuteOfDay(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < MINUTES_IN_DAY
}

/**
 * 출발한 지 얼마나 됐나를 사람이 읽는 말로.
 *
 * 남은 시간 글을 누르면 이것으로 바뀐다. 다시 누르면 돌아간다.
 * 아직 안 떴으면(진행이 0) "아직 출발 전이에요".
 */
export function elapsedWords(leftMs: number, totalMs: number): string {
  const elapsed = Math.max(0, totalMs - leftMs)
  if (totalMs <= 0 || elapsed <= 0) return '아직 출발 전이에요'
  if (leftMs <= 0) return '도착했어요'
  if (elapsed < 60_000) return '방금 출발했어요'

  const totalMinutes = Math.floor(elapsed / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return `출발한 지 ${minutes}분 됐어요`
  if (minutes === 0) return `출발한 지 ${hours}시간 됐어요`

  return `출발한 지 ${hours}시간 ${minutes}분 됐어요`
}
