'use client'

import Link from 'next/link'
import { clearToken } from '@/lib/auth-client'
import Icon, { type IconName } from '@/components/Icon'

type Card = {
  href?: string
  icon: IconName
  title: string
  desc: string
}

const CARDS: Card[] = [
  {
    href: '/chat',
    icon: 'chat',
    title: '채팅',
    desc: '3개 LLM 프로바이더 지원 — 모델 직접 선택',
  },
  {
    href: '/english',
    icon: 'book',
    title: '영어 공부',
    desc: '예문 · 역할놀이 · 직접 말하기 — 발음은 🔊로',
  },
  { icon: 'target', title: '목표 관리', desc: 'Phase 3' },
  { icon: 'chart', title: '검색/주식', desc: 'Phase 4' },
]

export default function HomePage() {
  return (
    <main className="min-h-screen bg-page text-ink flex flex-col items-center px-6">
      <header className="w-full max-w-5xl mt-16 mb-8 pb-7 border-b border-line flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-display tracking-tight">First App</h1>
          <p className="text-meta text-ink-muted mt-2">June&apos;s AI Assistant</p>
        </div>
        <button
          type="button"
          onClick={clearToken}
          className="shrink-0 border border-line rounded-md bg-surface-1 shadow-edge px-3 py-1.5 text-meta text-ink-muted hover:bg-surface-3 hover:text-ink transition-colors"
        >
          잠금
        </button>
      </header>

      <section className="w-full max-w-5xl grid gap-3 md:grid-cols-2">
        {CARDS.map((c) =>
          c.href ? (
            <Link
              key={c.title}
              href={c.href}
              className="group flex items-start gap-3.5 bg-surface-1 border border-line rounded-lg p-5 shadow-edge hover:bg-surface-3 hover:border-line-strong transition-colors"
            >
              <Icon
                name={c.icon}
                className="shrink-0 mt-0.5 text-ink-muted group-hover:text-ink transition-colors"
              />
              <div className="min-w-0">
                <h2 className="font-display text-title">{c.title}</h2>
                <p className="text-sub text-ink-muted mt-1">{c.desc}</p>
              </div>
            </Link>
          ) : (
            /**
             * 비활성 카드를 흐리게(opacity)하지 않는다.
             * 흐리게 하면 "일시적으로 안 되는 것"이 아니라 "망가진 것"으로 읽힌다.
             * 대신 면을 비우고(배경 없음 + 점선 보더 + 그림자 없음) 물러나게 한다.
             */
            <div
              key={c.title}
              className="flex items-start gap-3.5 border border-dashed border-line rounded-lg p-5 cursor-default"
            >
              <Icon name={c.icon} className="shrink-0 mt-0.5 text-ink-faint" />
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-title font-medium text-ink-faint">
                  {c.title}
                </h2>
                <p className="text-sub text-ink-faint mt-1">{c.desc}</p>
              </div>
              <span className="shrink-0 font-mono text-label tracking-label uppercase text-ink-faint border border-line rounded-sm px-1.5 py-0.5">
                준비 중
              </span>
            </div>
          )
        )}
      </section>

      {/*
        이 줄은 정보 가치가 없어서 지울 후보였습니다. 되묻지 못하고 그냥
        ink-faint로만 낮췄습니다 — 지우면 화면이 비어 보입니다.
        판단하지 마시고 지우시겠다면 이 블록과 <footer>만 걷어내면 됩니다.
      */}
      <footer className="w-full max-w-5xl mt-14 mb-16 text-meta text-ink-faint text-center">
        <p>Phase 1: Basic Chat · Phase 2: English Study · Phase 3: Goals · Phase 4: Search/Stocks</p>
      </footer>
    </main>
  )
}