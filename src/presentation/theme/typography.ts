import type { TextStyle } from 'react-native'

/**
 * 글자.
 *
 * 시스템 글꼴을 쓴다. 한국어가 가장 잘 읽히고 앱 크기가 늘지 않는다.
 * (docs/07-design-system.md 3장)
 */

export type TypographyName =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'caption'
  | 'label'
  | 'mono'

type TypographyStyle = Pick<
  TextStyle,
  'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing' | 'fontFamily'
>

export const typography: Record<TypographyName, TypographyStyle> = {
  /** 첫 화면 제목 */
  display: { fontSize: 34, fontWeight: '700', lineHeight: 40, letterSpacing: -0.5 },
  /** 화면 제목 */
  title: { fontSize: 24, fontWeight: '700', lineHeight: 30, letterSpacing: -0.3 },
  /** 구역 제목 */
  heading: { fontSize: 18, fontWeight: '600', lineHeight: 24 },
  /** 메시지, 본문 */
  body: { fontSize: 16, fontWeight: '400', lineHeight: 23 },
  bodyStrong: { fontSize: 16, fontWeight: '600', lineHeight: 23 },
  /** 시각, 상태 */
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  /** 작은 표지, 버튼 안 글자 */
  label: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  /** IP 주소 같은 것. 자리가 흔들리지 않아야 읽어주기 좋다 */
  mono: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    letterSpacing: 1.5,
    fontFamily: 'Menlo',
  },
}

/**
 * 기기의 글자 크기 설정을 따라가되 여기까지만 늘린다.
 * 더 키우면 화면이 깨진다.
 */
export const maxFontScale = 1.3
