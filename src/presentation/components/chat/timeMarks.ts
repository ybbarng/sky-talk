/**
 * 어느 말풍선 아래에 시각을 적을까.
 *
 * 한 사람이 연달아 말하면 매번 시각을 적을 필요가 없다. 그렇다고 **맨
 * 마지막에만** 적으면 5분 전 말과 방금 말이 같은 시각처럼 보인다. 그래서
 * 같은 사람이 **같은 분(分)** 안에 이어서 말한 묶음의 마지막에만 적는다.
 * 분이 바뀌면 그 앞 말에도 적힌다.
 */
export function showsTime(
  item: { readonly author: string; readonly at: number },
  next: { readonly author: string; readonly at: number } | undefined,
): boolean {
  if (next === undefined) return true
  if (next.author !== item.author) return true
  return !sameMinute(item.at, next.at)
}

export function sameMinute(a: number, b: number): boolean {
  return Math.floor(a / 60_000) === Math.floor(b / 60_000)
}
