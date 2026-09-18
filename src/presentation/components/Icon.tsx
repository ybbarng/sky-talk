import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg'
import { useTheme } from '../theme/ThemeProvider'
import type { ColorTokens } from '../theme/tokens'

/**
 * 아이콘.
 *
 * 라이브러리를 들이지 않고 직접 그린다. 라이브러리를 쓰면
 * 안 쓰는 아이콘 수백 개가 앱에 따라 들어온다.
 *
 * 선 굵기 1.75, 끝은 둥글게. (docs/07-design-system.md 7장)
 */

export type IconName =
  | 'help'
  | 'close'
  | 'send'
  | 'play'
  | 'stop'
  | 'mic'
  | 'micOff'
  | 'phone'
  | 'phoneOff'
  | 'video'
  | 'videoOff'
  | 'settings'
  | 'chat'
  | 'chevronRight'
  | 'check'
  | 'checkDouble'
  | 'wifi'
  | 'bluetooth'
  | 'refresh'
  | 'alert'
  | 'plane'
  | 'heart'
  | 'photo'
  | 'plus'
  | 'poke'
  | 'palette'
  | 'smile'

interface IconProps {
  name: IconName
  size?: number
  color?: keyof ColorTokens
}

export function Icon({ name, size = 20, color = 'text' }: IconProps) {
  const theme = useTheme()
  const stroke = theme.colors[color]
  const common = {
    stroke,
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderPaths(name, common)}
    </Svg>
  )
}

type PathProps = {
  stroke: string
  strokeWidth: number
  strokeLinecap: 'round'
  strokeLinejoin: 'round'
  fill: 'none'
}

function renderPaths(name: IconName, p: PathProps) {
  switch (name) {
    case 'help':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M9.5 9.2a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.7-.9 1.3v.5" {...p} />
          <Line x1={12} y1={16.8} x2={12} y2={16.9} {...p} />
        </>
      )
    case 'close':
      return (
        <>
          <Line x1={6} y1={6} x2={18} y2={18} {...p} />
          <Line x1={18} y1={6} x2={6} y2={18} {...p} />
        </>
      )
    case 'send':
      return (
        <>
          <Path d="M21 3 10.5 13.5" {...p} />
          <Path d="M21 3 14.5 21l-4-7.5L3 9.5 21 3Z" {...p} />
        </>
      )
    case 'play':
      // 오른쪽을 보는 세모. 음성 메시지를 튼다
      return <Path d="M7 4.5v15l12-7.5L7 4.5Z" {...p} />
    case 'stop':
      // 네모. 듣는 것을 멈춘다
      return <Path d="M6.5 6.5h11v11h-11z" {...p} />
    case 'photo':
      return (
        <>
          <Rect x={3} y={5} width={18} height={14} rx={2.5} {...p} />
          <Circle cx={8.5} cy={10} r={1.8} {...p} />
          <Path d="m4 17 5-5 4 4 3-2 4 4" {...p} />
        </>
      )
    case 'heart':
      return (
        <Path
          d="M12 20s-7.5-4.8-7.5-10A4.5 4.5 0 0 1 12 7.6 4.5 4.5 0 0 1 19.5 10c0 5.2-7.5 10-7.5 10Z"
          {...p}
        />
      )
    case 'phone':
      return (
        <Path
          d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3Z"
          {...p}
        />
      )
    case 'phoneOff':
      return (
        <>
          <Path
            d="M10.7 5.6 9.5 3h-3a2 2 0 0 0-2 2.2 17 17 0 0 0 5 10.6M14 17.2a17 17 0 0 0 4.8 2.3A2 2 0 0 0 21 17.5v-3L17 13l-1.5 2"
            {...p}
          />
          <Line x1={3} y1={3} x2={21} y2={21} {...p} />
        </>
      )
    case 'mic':
      return (
        <>
          <Path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" {...p} />
          <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" {...p} />
          <Line x1={12} y1={18} x2={12} y2={21} {...p} />
        </>
      )
    case 'micOff':
      return (
        <>
          <Path d="M9 9.2V6a3 3 0 0 1 5.9-.7" {...p} />
          <Path d="M15 12.2V12" {...p} />
          <Path d="M5.5 11.5a6.5 6.5 0 0 0 10.2 5.3" {...p} />
          <Line x1={4} y1={3.5} x2={20} y2={20.5} {...p} />
          <Line x1={12} y1={18} x2={12} y2={21} {...p} />
        </>
      )
    case 'video':
      return (
        <>
          <Path
            d="M3 7.5A1.5 1.5 0 0 1 4.5 6h9A1.5 1.5 0 0 1 15 7.5v9A1.5 1.5 0 0 1 13.5 18h-9A1.5 1.5 0 0 1 3 16.5v-9Z"
            {...p}
          />
          <Path d="M15 10.5 21 7v10l-6-3.5" {...p} />
        </>
      )
    case 'videoOff':
      return (
        <>
          <Path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h7" {...p} />
          <Path d="M15 10.5 21 7v10" {...p} />
          <Path d="M15 15v1.5A1.5 1.5 0 0 1 13.5 18h-9A1.5 1.5 0 0 1 3 16.5v-7" {...p} />
          <Line x1={4} y1={3.5} x2={20} y2={20.5} {...p} />
        </>
      )
    case 'settings':
      return (
        <>
          <Circle cx={12} cy={12} r={3} {...p} />
          <Path
            d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.3-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1.1Z"
            {...p}
          />
        </>
      )
    case 'chat':
      return (
        <Path
          d="M20 12a7.5 7.5 0 0 1-7.5 7.5c-1.3 0-2.5-.3-3.6-.9L4 20l1.4-4.2A7.5 7.5 0 1 1 20 12Z"
          {...p}
        />
      )
    case 'chevronRight':
      return <Polyline points="9,5 16,12 9,19" {...p} />
    case 'check':
      return <Polyline points="5,12.5 10,17.5 19,7" {...p} />
    case 'checkDouble':
      return (
        <>
          <Polyline points="2,12.5 6.5,17 14,8.5" {...p} />
          <Polyline points="10,14.5 11.5,16 19,7" {...p} />
        </>
      )
    case 'wifi':
      return (
        <>
          <Path d="M2.5 9a15 15 0 0 1 19 0" {...p} />
          <Path d="M6 12.7a10 10 0 0 1 12 0" {...p} />
          <Path d="M9.2 16.3a5 5 0 0 1 5.6 0" {...p} />
          <Line x1={12} y1={20} x2={12} y2={20.1} {...p} />
        </>
      )
    case 'bluetooth':
      return <Path d="m7 7.5 10 9-5 4V3.5l5 4-10 9" {...p} />
    case 'refresh':
      return (
        <>
          <Path d="M20 12a8 8 0 1 1-2.6-5.9" {...p} />
          <Polyline points="20,3 20,7.5 15.5,7.5" {...p} />
        </>
      )
    case 'alert':
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Line x1={12} y1={7.5} x2={12} y2={13} {...p} />
          <Line x1={12} y1={16.4} x2={12} y2={16.5} {...p} />
        </>
      )
    case 'plane':
      return (
        <Path
          d="M21 15.5 13.5 12V5.2a1.5 1.5 0 0 0-3 0V12L3 15.5v2l7.5-2.2v4.1L8 21v1.2l4-1 4 1V21l-2.5-1.6v-4.1l7.5 2.2v-2Z"
          {...p}
        />
      )
    case 'plus':
      return (
        <>
          <Line x1={12} y1={5} x2={12} y2={19} {...p} />
          <Line x1={5} y1={12} x2={19} y2={12} {...p} />
        </>
      )
    case 'poke':
      // 검지를 세운 손. 콕 찌르는 손가락이다. 손끝 옆의 짧은 두 줄이 "톡" 이다.
      return (
        <>
          <Path d="M10 10.5V4.2a1.8 1.8 0 0 0-3.6 0V14" {...p} />
          <Path d="M10 10.5a1.8 1.8 0 0 1 3.6 0v1" {...p} />
          <Path d="M13.6 11.5a1.8 1.8 0 0 1 3.6 0v1" {...p} />
          <Path
            d="M17.2 12.5a1.8 1.8 0 0 1 3.6 0v2.3a6.5 6.5 0 0 1-6.5 6.5h-1.7a5.2 5.2 0 0 1-4.3-2.2l-3.4-4.3a1.6 1.6 0 0 1 2.4-2.1L8.5 14"
            {...p}
          />
          <Line x1={4.2} y1={3.2} x2={3} y2={2} {...p} />
          <Line x1={12.2} y1={3.2} x2={13.4} y2={2} {...p} />
        </>
      )
    case 'palette':
      // 물감 팔레트. 낙서를 그리는 곳이라는 뜻이다. 물감 자리는 채운다.
      return (
        <>
          <Path
            d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-1 .8-1.8 1.8-1.8h1.9A4.5 4.5 0 0 0 21 10.7C21 6.4 16.9 3 12 3Z"
            {...p}
          />
          <Circle cx={7.5} cy={12} r={1.1} {...p} fill={p.stroke} />
          <Circle cx={9.5} cy={7.8} r={1.1} {...p} fill={p.stroke} />
          <Circle cx={14.2} cy={7} r={1.1} {...p} fill={p.stroke} />
          <Circle cx={17.4} cy={10.3} r={1.1} {...p} fill={p.stroke} />
        </>
      )
    case 'smile':
      // 웃는 얼굴. 이모티콘 서랍을 연다.
      return (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M8.3 14a4.3 4.3 0 0 0 7.4 0" {...p} />
          <Line x1={9} y1={9.3} x2={9} y2={9.4} {...p} />
          <Line x1={15} y1={9.3} x2={15} y2={9.4} {...p} />
        </>
      )
  }
}
