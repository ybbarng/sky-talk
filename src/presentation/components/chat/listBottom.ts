/**
 * 대화 목록이 바닥에 붙어 있나.
 *
 * **바닥을 보고 있을 때만 새 말이 오면 따라 내려간다.** 옛 말을
 * 올려 보고 있는데 새 말이 올 때마다 끌어내리면 읽던 자리를 잃는다.
 *
 * 순수한 계산이라 여기서 시험한다. 스크롤 자체는 화면이 한다.
 */

/** 이만큼 안이면 바닥으로 본다. 손가락이 살짝 흔들린 정도다 */
export const NEAR_BOTTOM_PX = 40

export function isNearBottom(
  offsetY: number,
  contentHeight: number,
  viewportHeight: number,
  threshold = NEAR_BOTTOM_PX,
): boolean {
  // 내용이 화면보다 짧으면 스크롤할 것이 없다. 늘 바닥이다.
  const distance = contentHeight - viewportHeight - offsetY
  return distance <= threshold
}
