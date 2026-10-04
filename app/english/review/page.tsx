'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import SpeakButton from '@/components/SpeakButton'
import { listEnglishRecords, type EnglishChunk, type EnglishErrorRecord } from '@/lib/db'
import { ERROR_CATEGORY_LABEL, type ErrorCategory } from '@/lib/lesson'

/**
 * ============================================================================
 *  복습 — 내가 틀린 것, 내가 말할 수 있는 것
 * ============================================================================
 *
 *  이 화면의 목적은 두 가지입니다:
 *    1. 지난 오류를 다시 본다
 *    2. 지난 표현을 **입에 익힌다**
 *
 *  ★ 2번이 이 기능의 자존심입니다 ★
 *  새 표현만 계속 늘면 유창함이 안 느는 이유가 됩니다. 다음 세션 첫 턴에
 *  지난 표현이 다시 등장하는 경로(lib/lesson.ts의 buildReview, app/api/english/route.ts)가
 *  이 기록을 읽습니다. 여기서 아무것도 안 쌓이면 그 경로도 빈손입니다.
 *
 *  ── 지금 하지 않는 것 ─────────────────────────────────────────────────────
 *  반복 간격 정책(빈도? 경과 시간? 마지막 실패 시점?). 기록만 쌓아 두고
 *  계측이 모인 뒤 정합니다 (docs/10-english-guide.md §5).
 *  그래서 여기 정렬은 "최근 것부터"이고, 그 이상을 주장하지 않습니다.
 */

type Tab = 'mistakes' | 'chunks'

export default function EnglishReviewPage() {
  const [chunks, setChunks] = useState<EnglishChunk[]>([])
  const [errors, setErrors] = useState<EnglishErrorRecord[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [tab, setTab] = useState<Tab>('mistakes')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { chunks: c, errors: e } = await listEnglishRecords()
      if (cancelled) return
      setChunks(c)
      setErrors(e)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 분류별로 묶습니다.
   *
   * ★ 이 분류가 "지금 무엇을 연습할지"를 정하는 근거입니다 ★
   * 자유 텍스트 사유로 두면 나란히 놓아도 같은 것인지 판단할 수 없어서
   * 8개로 고정했습니다 (lib/lesson.ts의 ERROR_CATEGORIES).
   */
  const grouped = useMemo(() => {
    const map = new Map<ErrorCategory, EnglishErrorRecord[]>()
    for (const e of errors) {
      const key = e.category as ErrorCategory
      const list = map.get(key)
      if (list) list.push(e)
      else map.set(key, [e])
    }
    // 사람이 읽는 순서로 정렬합니다. 개수가 많은 분류가 먼저 오게 하고,
    // "여기가 나야 많이 틀리는 곳"이 눈에 바로 들어오게 합니다.
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [errors])

  return (
    <main className="min-h-screen bg-page text-ink flex flex-col">
      {/* 채팅·영어 화면과 같은 헤더 규칙 (모바일 한 줄) */}
      <header className="border-b border-line px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
        <Link
          href="/"
          className="text-meta text-ink-muted hover:text-ink transition-colors shrink-0"
        >
          ← 홈
        </Link>
        <h1 className="font-display text-sub sm:text-title whitespace-nowrap">복습</h1>
      </header>

      <div className="flex-1 w-full max-w-3xl mx-auto p-6 flex flex-col gap-6">
        <div className="flex items-center gap-2">
          {(
            [
              ['mistakes', `내가 틀린 것 ${errors.length}`],
              ['chunks', `배운 표현 ${chunks.length}`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-meta rounded-md border transition-colors ${
                id === tab
                  ? 'border-accent/40 bg-accent/5 text-ink'
                  : 'border-line bg-surface-1 text-ink-muted hover:border-line-strong hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-meta text-ink-muted">불러오는 중...</p>
        ) : tab === 'mistakes' ? (
          grouped.length === 0 ? (
            <EmptyHint
              text="아직 기록된 실수가 없습니다."
              sub="세션을 마치고 나면 여기서 내가 틀린 것이 쌓입니다."
            />
          ) : (
            <div className="flex flex-col gap-6">
              {grouped.map(([category, list]) => (
                <section key={category} className="flex flex-col gap-3">
                  <h2 className="font-mono text-label tracking-label uppercase text-ink-faint">
                    {ERROR_CATEGORY_LABEL[category] ?? '기타'} · {list.length}
                  </h2>
                  {list.map((e) => (
                    <div
                      key={e.id}
                      className="rounded-lg border border-line bg-surface-1 px-4 py-3 flex flex-col gap-1"
                    >
                      <p className="text-sub text-ink-muted line-through">{e.original}</p>
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-body text-ink">{e.corrected}</p>
                          <p className="text-meta text-ink-muted mt-0.5">{e.reason}</p>
                        </div>
                        <SpeakButton text={e.corrected} />
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )
        ) : chunks.length === 0 ? (
          <EmptyHint
            text="아직 쌓인 표현이 없습니다."
            sub="세션을 마치고 나면 오늘 쓴 표현이 여기에 남습니다."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {chunks.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-line bg-surface-1 px-4 py-3 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-body text-ink">{c.phrase}</p>
                  {c.meaning && <p className="text-meta text-ink-muted">{c.meaning}</p>}
                </div>
                <SpeakButton text={c.phrase} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

/**
 * 비조명은 흐려지지 않습니다 (docs/RULE.md §3).
 * 0개를 보여줄 때는 "무엇을 하면 되는지"를 말합니다.
 */
function EmptyHint({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="border border-dashed border-line rounded-lg px-4 py-10 text-center">
      <p className="text-body text-ink-muted">{text}</p>
      <p className="text-meta text-ink-faint mt-1">{sub}</p>
    </div>
  )
}
