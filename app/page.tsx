'use client'

import Link from 'next/link'
import { clearToken } from '@/lib/auth-client'
import Icon, { type IconName } from '@/components/Icon'
import ThemeToggle from '@/components/ThemeToggle'

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
    desc: '모델을 골라 물어보세요. 다른 모델로 바꿔 답을 비교할 수도 있어요.',
  },
  {
    href: '/chat2',
    icon: 'chat',
    title: '채팅2 (실험)',
    desc: '기존 채팅과 같은 모델·키를 쓰지만 답이 스트리밍으로 흘러나와요. 대화 저장은 안 됩니다.',
  },
  {
    href: '/english',
    icon: 'book',
    title: '영어 공부',
    desc: '오늘은 어떤 상황으로 연습할까요? 먼저 한마디 하면 바로 도와줄게요.',
  },
  { icon: 'target', title: '목표 관리', desc: '아직 준비 중이에요' },
  { icon: 'chart', title: '검색/주식', desc: '아직 준비 중이에요' },
]

export default function HomePage() {
  return (
    <main className="min-h-screen bg-page text-ink flex flex-col items-center px-5 sm:px-8">
      {/*
        홈 히어로 — 개인 어시스턴트의 문. 따뜻하게, 먼저 말을 건다.
        비교: 예전 헤더는 "First App" (제품명) + 드로햡 리스트처럼 보이는
        카드 4개였다. 동일 카드 4개는 SaaS 키트처럼 읽혀서, 지금 쓰는
        2개를 크게, 준비 중인 2개를 조용히 분리했다.
        eyebrow 라벨·대문자·mono 배지는 넣지 않는다 — 따뜻한 문에
        메타 라벨은 어울리지 않는다 (frontend-design SKILL).
      */}
      <header className="w-full max-w-3xl mt-14 sm:mt-20 mb-10 flex flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-display font-semibold tracking-tight leading-none">
              오늘은 어떤 것부터 할까요?
            </h1>
            <p className="text-sub text-ink-muted mt-3 leading-relaxed">
              대화하거나, 영어를 연습하거나. 편한 쪽부터 시작해요.
            </p>
          </div>
          {/*
            테마 전환은 잠금 버튼 옆에 둡니다.
            둘 다 "화면을 바꾸는" 버튼이라 자리가 같고, 갇혔을 때도 여기서 나옵니다.
            (사용자 요청 — 다른 화면에는 두지 않았습니다. 홈이 진입점입니다)
          */}
          <div className="shrink-0 flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={clearToken}
              className="border border-line rounded-full bg-surface-1 shadow-edge px-4 py-2 text-sub text-ink-muted hover:bg-surface-3 hover:text-ink transition-colors"
            >
              잠금
            </button>
          </div>
        </div>
      </header>

      {/*
        지금 쓸 수 있는 두 가지. 크고 둥글게, 아이콘은 꿀빛 틴트에 담고
        한 줄 설명은 "무엇을 하는지"를 쉬운 말로 쓴다 (설명은 vendas가 아니라
        길잡이 — SKILL writing 가이드).
      */}
      <section className="w-full max-w-3xl grid gap-4 sm:grid-cols-2">
        {CARDS.filter((c): c is Card & { href: string } => c.href !== undefined).map((c) => (
          <Link
            key={c.title}
            href={c.href}
            className="group flex flex-col gap-4 bg-surface-1 border border-line rounded-xl p-6 sm:p-7 shadow-edge hover:bg-surface-2 hover:border-line-strong transition-colors"
          >
            <span className="grid size-11 place-items-center rounded-full bg-accent/10 text-accent shrink-0">
              <Icon name={c.icon} size={22} />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-title font-semibold">{c.title}</h2>
              <p className="text-sub text-ink-muted mt-2 leading-relaxed">{c.desc}</p>
            </div>
          </Link>
        ))}
      </section>

      {/*
        준비 중인 것. 활성 카드와 섞지 않고 한 줄씩 조용히 배치한다.
        대시보드 점선 테두리 같은 "망가짐" 신호는 아니고, 아직 기다리라는 뜻이다.
      */}
      <section className="w-full max-w-3xl mt-8 rounded-xl border border-dashed border-line px-5 py-4 sm:px-6">
        <p className="text-meta text-ink-faint mb-3">아직 준비 중이에요</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CARDS.filter((c) => !c.href).map((c) => (
            <div key={c.title} className="flex items-center gap-3">
              <Icon name={c.icon} className="shrink-0 text-ink-faint" size={18} />
              <span className="text-sub text-ink-muted">{c.title}</span>
            </div>
          ))}
        </div>
      </section>

      {/*
        이 줄은 정보 가치가 없어서 지울 후보였습니다. 되묻지 못하고 그냥
        ink-faint로만 낮췄습니다 — 지우면 화면이 비어 보입니다.
        판단하지 마시고 지우시겠다면 이 블록과 <footer>만 걷어내면 됩니다.
      */}
      <footer className="w-full max-w-3xl mt-12 mb-16 text-meta text-ink-faint text-center">
        <p>이 앱은 오직 June만 써요. 목표·주식 메뉴는 나중에 더할 예정이에요.</p>
      </footer>
    </main>
  )
}