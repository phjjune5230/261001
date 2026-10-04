import type { Metadata } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import localFont from 'next/font/local'
import AuthGate from '@/components/AuthGate'
import './globals.css'

// next/font가 빌드 시점에 폰트를 내려받아 self-host + preload 해준다.
// (외부 <link>로 Google Fonts를 호출하면 페이지마다 리로드되고 FOUT가 생긴다)

/**
 * 제목용. IBM Plex Sans를 고른 이유:
 * Syne은 라틴이 "통통"해서 개인 앱의 단단한 인상과 어긋났다.
 * Plex Sans는 같은 기술적 성격이면서 훨씬 정돈되어 있고,
 * 아래 Plex Mono와 같은 계보라 세트로 읽힌다.
 */
const plexSans = IBM_Plex_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-plex-sans',
})

/**
 * 본문 라틴·숫자용. Syne과 짝을 이룰 때 쓰던 DM Mono 자리.
 * IBM Plex Sans와 같은 Plex 계열로 맞춰 세트감을 만들었다.
 */
const plexMono = IBM_Plex_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-plex-mono',
})

/**
 * 한글 전용.
 *
 * IBM Plex는 한글 글리프가 없다. 예전엔 이 자리를 비워 둬서 화면의 모든 한글이
 * generic `monospace`로 폴백했다 (Windows면 Courier — 본문이 전부 기계폰트처럼
 * 보였던 것). 이제 스택 순서에서 한글 자리를 Pretendard로 명시해 고정한다.
 *
 * Google Fonts에 없으므로 직접 호스팅한다. CDN <link>를 쓰면 폰트마다 새로
 * 걸리고 FOUT가 생기므로 next/font/local로 빌드 시점에 처리한다.
 *
 * weight 범위를 반드시 명시한다. 가변 폰트인데도 범위를 안 주면
 * WebKit에서 굵기가 잘못 렌더링되는 버그가 있다 (Pretendard 공식 README).
 *
 * ★ preload를 켜둔 채로 둔 판단입니다 ★
 * 이 파일 하나가 2MB이고, preload는 모든 페이지의 임계 경로에 올립니다.
 * 한 인스턴스만 도는 개인 앱이라 감수했습니다. 빼려면 `preload: false`를
 * 추가하면 되지만, 라틴 폰트가 먼저 오고 한글은 swap으로 뒤따르며
 * **첫 페인트에 Courier가 보입니다.** 한글 화면이 일순간 기계폰트로 떴다가
 * 바뀌는 것보다 2MB가 낫다고 판단했습니다.
 * 더 줄이려면 unicode-range 서브셋 분할(44개 파일)이 있지만,
 * next/font/local에 넣기엔 파일이 많아 관리가 깨집니다.
 */
const pretendard = localFont({
  src: './fonts/PretendardVariable.woff2',
  variable: '--font-pretendard',
  display: 'swap',
  weight: '45 920',
})

export const metadata: Metadata = {
  title: 'First App — June',
  description: "June's Personal AI Assistant",
}

/**
 * ★ 첫 페인트 전에 테마를 심습니다 ★
 *
 * 없으면 어두운 테마를 쓰는 사람이 매번 **흰 화면을 0.5초 보고** 검은 화면으로
 * 바뀝니다. 서버가 보내는 HTML은 테마를 모르기 때문에, 그때까지는 기본값
 * (globals.css의 `:root` = 밝은 쪽)이 그려집니다.
 *
 * 그래서 <head> 안에서 <html>의 속성을 먼저 바꿉니다. React가 개입하기 전이라
 * 깜빡임이 없습니다.
 *
 * ★ 문자열을 여기저기서 두 번 적지 마세요 ★
 * 이 스크립트와 components/ThemeToggle.tsx의 저장 키가 같아야 합니다.
 * 키를 바꾸려면 두 곳을 같이 고쳐야 합니다.
 *
 * 실패해도 앱은 돌아갑니다 — localStorage를 못 읽는 환경(사생활 모드)에서는
 * 기본값(밝게)이 그대로 쓰입니다. try/catch로 감싼 이유이고, 에러로 페이지가
 * 죽는 일은 없습니다.
 */
const themeBootstrap = `
try {
  var t = localStorage.getItem('theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch (e) {}
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="ko"
      className={`${plexSans.variable} ${plexMono.variable} ${pretendard.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          dangerouslySetInnerHTML은 여기 **밖에** 쓰지 않습니다.
          우리가 작성한 상수 문자열이고, 사용자 입력이 들어갈 자리가 아닙니다.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="bg-page text-ink antialiased">
        {/* 모든 화면 라우트를 거친다. /chat 같은 주소 직행도 막힌다. */}
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  )
}