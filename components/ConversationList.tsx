'use client'

import type { Conversation } from '@/lib/db'
import Icon from '@/components/Icon'

/**
 * 대화 목록 사이드바.
 *
 * 채팅과 영어가 같은 컴포넌트를 씁니다 — 목록 UI가 달라질 이유가 없고,
 * 두 벌로 만들면 한쪽만 고치는 일이 생깁니다.
 *
 * enabled가 false면 목록 영역 자체를 숨깁니다.
 * "저장 안 됨"을 조용히 보여주면 사용자가 무엇이 잘못됐는지 알 수 없으므로,
 * 저장되지 않는 상태는 화면에 드러나야 합니다.
 *
 * enabled는 더 이상 환경 변수로 판정하지 않습니다.
 * 로그인이 없어진 뒤로 클라이언트는 Supabase 설정 여부를 알 수 없고,
 * "첫 목록 조회가 성공했는가"가 곧 판정이 됩니다
 * (hooks/useConversations.ts 참고).
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
}: {
  conversations: Conversation[]
  activeId: string | null
  enabled: boolean
  loading: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  emptyHint: string
}) {
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
        <ul className="space-y-1 max-h-64 overflow-y-auto">
          {conversations.map((c) => {
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
      )}
    </div>
  )
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