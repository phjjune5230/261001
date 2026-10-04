'use client'

import { useState } from 'react'
import type { Conversation } from '@/lib/db'
import Icon from '@/components/Icon'

/**
 * 한 페이지에 보여줄 대화 수.
 *
 * 100개를 한꺼번에 늘어놓으면 목록이 화면보다 길어집니다. 왼쪽 칸이
 * 접혀 있을 때는 더 심합니다 — 펼친 좌우로 스크롤해야만 자기 대화를 찾습니다.
 *
 * 4개를 정한 이유: 대화 제목 + 시각 두 줄이 4개면 목록 자체가 접힌 설정 칸의
 * 절반을 넘지 않습니다. 더 적으면 "몇 개까지 봤는지"를 기억해야 하고,
 * 더 많으면 목록이 화면을 먹습니다.
 */
const PAGE_SIZE = 4

/**
 * ★ 페이지 번호는 1부터 셉니다 ★
 * 화면에 보이는 것은 1, 2, 3입니다 — 0부터 세면 사용자가 세기를 시작할
 * 위치가 화면에 없습니다.
 */
export default function ConversationList({
  conversations,
  activeId,
  enabled,
  loading,
  onSelect,
  onNew,
  onDelete,
  emptyHint,
  resetSignal = 0,
}: {
  conversations: Conversation[]
  activeId: string | null
  enabled: boolean
  loading: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  emptyHint: string
  /**
   * 부모가 이 값을 바꾸면 1페이지로 돌아갑니다.
   *
   * 왜 prop인가: "새 대화"를 누르면 목록 맨 위에 새 대화가 붙습니다. 그래도
   * 사용자가 3페이지에 있다면 새 대화가 보이지 않습니다 — 만들었는데 안 보이면
   * 저장이 안 된 것처럼 읽힙니다. effect로 목록 변화를 보면 매 턴 저장으로
   * 목록이 바뀌 때마다 사용자가 보고 있던 페이지가 튀어오릅니다.
   * 그래서 "새 대화"라는 의도만 부모가 알려 줍니다.
   */
  resetSignal?: number
}) {
  const [page, setPage] = useState(0)
  const [lastSignal, setLastSignal] = useState(resetSignal)

  // 렌더 도중 상태를 맞추는 React의 정식 방법입니다 (effect를 쓰지 않습니다).
  if (resetSignal !== lastSignal) {
    setLastSignal(resetSignal)
    setPage(0)
  }

  const totalPages = Math.ceil(conversations.length / PAGE_SIZE)
  // 삭제로 페이지 수가 줄었을 때 빈 페이지를 가리키지 않도록 여기서 조입니다.
  const safePage = Math.min(page, Math.max(0, totalPages - 1))
  const visible = conversations.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  // 제목 + "새 대화" 줄은 enabled와 무관하게 항상 같다. 조건이 두 벌이면
  // 나중에 한쪽만 고치는 일이 생긴다.
  const head = (
    <div className="flex items-center justify-between mb-2">
      <label className="block font-mono text-label tracking-label uppercase text-ink-faint">
        대화 목록
      </label>
      <button
        type="button"
        onClick={onNew}
        className="flex items-center gap-1 text-meta text-ink-muted hover:text-ink transition-colors"
      >
        <Icon name="plus" size={12} strokeWidth={2} />
        새 대화
      </button>
    </div>
  )

  if (!enabled) {
    return (
      <div>
        {head}
        <p className="text-meta leading-relaxed text-ink-muted border border-line rounded-md px-3 py-2 bg-surface-1 shadow-edge">
          저장이 꺼져 있습니다. 대화는 화면에서만 유지되고 새로고침하면 사라집니다.
          <br />
          <span className="text-ink-faint">
            서버에 <span className="text-ink-muted">SUPABASE_SERVICE_ROLE_KEY</span>가
            등록되면 자동 저장됩니다.
          </span>
        </p>
      </div>
    )
  }

  return (
    <div>
      {head}

      {loading ? (
        <p className="text-meta text-ink-faint">불러오는 중...</p>
      ) : conversations.length === 0 ? (
        <p className="text-meta leading-relaxed text-ink-muted">{emptyHint}</p>
      ) : (
        <>
          {/*
            ★ 4개만 보여줍니다 ★
            max-h 스크롤을 뗐습니다. 4개라 이미 짧고, 스크롤 바가 사라져도
            "더 있으면 아래"라는 잘못된 안내를 하지 않습니다.
          */}
          <ul className="space-y-1">
            {visible.map((c) => {
              const active = c.id === activeId
              return (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full text-left rounded-md px-3 py-2 pr-8 border transition-colors ${
                      active
                        ? 'bg-surface-2 border-line-strong shadow-edge'
                        : 'border border-transparent hover:border-line hover:bg-surface-1'
                    }`}
                  >
                    <span className={`block text-meta truncate ${active ? 'text-ink' : 'text-ink-muted'}`}>
                      {c.title}
                    </span>
                    <span className="block text-meta text-ink-faint mt-0.5">
                      {formatWhen(c.updated_at)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    title="삭제"
                    aria-label={`${c.title} 삭제`}
                    className="absolute right-1.5 top-1.5 w-6 h-6 rounded-sm grid place-items-center text-ink-faint hover:text-danger opacity-0 group-hover:opacity-100 focus:opacity-100 transition-colors"
                  >
                    <Icon name="trash" size={13} strokeWidth={1.7} />
                  </button>
                </li>
              )
            })}
          </ul>

          {totalPages > 1 && (
            <nav
              aria-label="대화 목록 페이지"
              className="mt-2 flex items-center justify-center gap-1 flex-wrap"
            >
              <PageButton
                label="이전"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
              >
                ‹
              </PageButton>

              {pageNumbers(safePage + 1, totalPages).map((p, i) =>
                p === 'gap' ? (
                  <span key={`gap-${i}`} className="px-1 text-meta text-ink-faint">
                    …
                  </span>
                ) : (
                  <PageButton
                    key={p}
                    current={p === safePage + 1}
                    label={`${p}페이지`}
                    onClick={() => setPage(p - 1)}
                  >
                    {p}
                  </PageButton>
                )
              )}

              <PageButton
                label="다음"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
              >
                ›
              </PageButton>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

/** 페이지 번호 하나. 현재 위치는 강조색 테두리로만 구분합니다 (문자색이 아니라). */
function PageButton({
  children,
  onClick,
  disabled,
  current,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  current?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      className={`min-w-7 h-7 px-1.5 rounded-md text-meta border transition-colors disabled:opacity-30 disabled:hover:bg-transparent ${
        current
          ? 'border-accent/40 bg-accent/5 text-ink'
          : 'border-line bg-surface-1 text-ink-muted hover:border-line-strong hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * 보여줄 페이지 번호를 고릅니다. (1부터 시작)
 *
 * 100개 대화면 25페이지가 됩니다. 전부 찍으면 버튼이 줄을 다 먹고,
 * 그러면 목록이 화면보다 더 길어집니다 — 지우려고 한 쪽입니다.
 * 그래서 7페이지 이하일 때만 전부를 찍고, 그 밖에는
 * 처음·현재 주변·마지막만 남기고 사이를 'gap'으로 표시합니다.
 */
function pageNumbers(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const out: (number | 'gap')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  if (start > 2) out.push('gap')
  for (let p = start; p <= end; p++) out.push(p)
  if (end < total - 1) out.push('gap')
  out.push(total)
  return out
}

/**
 * 서버가 주는 ISO 문자열을 로컬 표기로.
 *
 * new Date(ISO)는 브라우저 시간대로 변환합니다. 목록 정렬이 updated_at에
 * 의존하므로 여기서 시간이 뒤틀리면 "왜 최근 대화가 맨 아래에 있지" 하는
 * 혼란이 생깁니다.
 */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)

  if (diffMin < 1) return '방금'
  if (diffMin < 60) return `${diffMin}분 전`
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}시간 전`
  if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / (60 * 24))}일 전`
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}