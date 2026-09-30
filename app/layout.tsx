import type { Metadata } from 'next'
import { DM_Mono, Syne } from 'next/font/google'
import AuthGate from '@/components/AuthGate'
import './globals.css'

// next/font가 빌드 시점에 폰트를 내려받아 self-host + preload 해준다.
// (외부 <link>로 Google Fonts를 호출하면 페이지마다 리로드되고 FOUT가 생긴다)
const dmMono = DM_Mono({
  weight: ['300', '400', '500'],
  subsets: ['latin'],
  variable: '--font-dm-mono',
})

const syne = Syne({
  weight: ['400', '600', '700'],
  subsets: ['latin'],
  variable: '--font-syne',
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
    <html lang="ko" className={`${dmMono.variable} ${syne.variable}`}>
      <body className="bg-[#0f0f0f] text-white antialiased">
        {/* 모든 화면 라우트를 거친다. /chat 같은 주소 직행도 막힌다. */}
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  )
}
