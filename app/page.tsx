'use client'

import Link from 'next/link'
import { clearToken } from '@/lib/auth-client'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center px-6">
      <header className="w-full max-w-4xl mb-16 flex items-center justify-between">
        <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }} className="text-4xl tracking-tight">
          First App
        </h1>
        <div className="flex items-center gap-4">
          <span className="text-xs text-[#444]">{"June's AI Assistant"}</span>
          <button
            type="button"
            onClick={clearToken}
            className="text-xs text-[#444] hover:text-[#e8ff47] transition-colors"
          >
            잠금
          </button>
        </div>
      </header>

      <section className="w-full max-w-4xl grid gap-4 md:grid-cols-2">
        <Link
          href="/chat"
          className="group border border-[#222] hover:border-[#e8ff47] p-6 rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">💬</span>
            <h2 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }} className="text-xl">
              채팅
            </h2>
          </div>
          <p className="text-sm text-[#555] group-hover:text-[#e8ff47] transition-colors">
            3개 LLM 프로바이더 지원 — 모델 직접 선택
          </p>
        </Link>

        <Link
          href="/english"
          className="group border border-[#222] hover:border-[#e8ff47] p-6 rounded-xl transition-colors"
        >
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">📚</span>
            <h2 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }} className="text-xl">
              영어 공부
            </h2>
          </div>
          <p className="text-sm text-[#555] group-hover:text-[#e8ff47] transition-colors">
            예문 · 역할놀이 · 직접 말하기 — 발음은 🔊로
          </p>
        </Link>

        <div className="border border-[#222] p-6 rounded-xl opacity-40 cursor-not-allowed">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🎯</span>
            <h2 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }} className="text-xl">
              목표 관리
            </h2>
          </div>
          <p className="text-sm text-[#555]">Phase 3 — 준비 중</p>
        </div>

        <div className="border border-[#222] p-6 rounded-xl opacity-40 cursor-not-allowed">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">📈</span>
            <h2 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }} className="text-xl">
              검색/주식
            </h2>
          </div>
          <p className="text-sm text-[#555]">Phase 4 — 준비 중</p>
        </div>
      </section>

      <footer className="w-full max-w-4xl mt-16 text-xs text-[#444] text-center">
        <p>Phase 1: Basic Chat · Phase 2: English Study · Phase 3: Goals · Phase 4: Search/Stocks</p>
      </footer>
    </main>
  )
}
