import type { Metadata } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import localFont from 'next/font/local'
import AuthGate from '@/components/AuthGate'
import './globals.css'

// next/font가 빌드 시점에 폰트를 내려받아 self-host + preload 해준다.
// (외부 <link>로 Google Fonts를 호출하면 페이지마다 리로드되고 FOUT가 생긴다)

/**
 * 제목용. IBM Plex Sans를 고른 이유:
 * Syne은 라틴이 "통통"해서personal 앱의 단단한 인상과 어긋났다.
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="ko"
      className={`${plexSans.variable} ${plexMono.variable} ${pretendard.variable}`}
    >
      <body className="bg-page text-ink antialiased">
        {/* 모든 화면 라우트를 거친다. /chat 같은 주소 직행도 막힌다. */}
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  )
}