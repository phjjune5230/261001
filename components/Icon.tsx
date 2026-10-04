/**
 * 인라인 SVG 아이콘 모음.
 *
 * 왜 이 파일이 있는가:
 *   이모지(💬 📚 🎯 🔊)를 쓰면 OS·브라우저·이모지 폰트 버전에 따라 모양과
 *   크기가 제각각이 된다. 같은 화면 안에서도 다르게 보이며, 줄 높이도 잡히지
 *   않았다. stroke만 있는 선 아이콘으로 통일하면 OS와 무관하게 일정하다.
 *
 * 규칙:
 *   - viewBox 24. stroke만. fill 없음.
 *   - strokeWidth 1.6 (버튼 안의 작은 아이콘은 1.7~2.2 를 직접 넘긴다)
 *   - 색은 currentColor. 상태에 따라 색을 바꾸려면 부모의 text-* 토큰을 건다.
 */

const PATHS = {
  // 말풍선
  chat: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  // 책
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  // 과녁
  target: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  // 상승 추세
  chart: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
  // 마이크
  mic: 'M9 2h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM5 10a7 7 0 0 0 14 0M12 17v5',
  // 위로 보내기
  send: 'M12 19V5M5 12l7-7 7 7',
  // 스피커
  speaker: 'M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14',
  // 정지 (TTS 재생 중)
  stop: 'M7 7h10v10H7z',
  // 잠금
  lock: 'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4',
  // 더하기
  plus: 'M12 5v14M5 12h14',
  // 쓰레기통
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  // 펼침/접힘 표시 (기본은 아래로 향한다. 위로 접으면 rotate-180을 준다)
  chevron: 'M6 9l6 6 6-6',
  // 테마 전환 — 아래 두 개는 한 path에 여러 subpath를 이어 적었습니다.
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
} as const

export type IconName = keyof typeof PATHS

export default function Icon({
  name,
  size = 19,
  strokeWidth = 1.6,
  className,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}