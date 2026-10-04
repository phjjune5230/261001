'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { Provider } from '@/lib/llm'
import { DEFAULT_PROVIDER, defaultModelFor } from '@/lib/models'
import { clearToken, getToken } from '@/lib/auth-client'
import ModelPicker, { CUSTOM } from '@/components/ModelPicker'
import SpeakButton from '@/components/SpeakButton'
import Icon from '@/components/Icon'
import ConversationList from '@/components/ConversationList'
import { useConversations } from '@/hooks/useConversations'
import { useModelRegistry } from '@/hooks/useModelRegistry'
import { listEnglishRecords, saveEnglishRecords } from '@/lib/db'
import {
  ERROR_CATEGORY_LABEL,
  SCENARIOS,
  collectCorrections,
  collectExpressions,
  turnToHistoryText,
  type ErrorCategory,
  type LessonStep,
  type StepType,
  type LessonSummary,
  type LessonTurn,
} from '@/lib/lesson'

type Entry =
  | { kind: 'user'; text: string }
  | {
      kind: 'assistant'
      turn: LessonTurn
      /**
       * ★ 이 턴을 만들어낸 provider·model ★
       *
       * 채팅과 같은 이유입니다. 화면에 있는 선택은 "지금 고른 것"이지
       * 이 턴을 만든 것이 아닙니다. 대화를 오가며 모델을 바꾸면 라벨이
       * 거짓말을 하게 됩니다.
       *
       * meta에는 turn이 통째로 들어가고, 이 둘은 같은 자리에 덧붙여 씁니다.
       * metaToTurn가 모르는 키는 그대로 통과시키므로 LessonTurn 모양은
       * 그대로입니다 (lib/lesson.ts).
       */
      provider?: string
      model?: string
    }

/** 빈 턴. 복원 실패와 파싱 실패가 모두 여기로 떨어집니다. */
function emptyTurn(content: string): LessonTurn {
  return { content, steps: [], corrections: [], summary: null }
}

/**
 * DB에서 꺼낸 메시지를 다시 Entry로 되돌립니다.
 *
 * 왜 이것이 필요한가:
 * 영어 턴은 content(튜터 설명) + steps(예문·연습) 구조입니다. 예문을
 * content 문자열로 펴서 저장했다가 열면 **예문과 번역이 섞인 한 덩어리**가 되고,
 * 말풍선·🔊 버튼을 그릴 수 없습니다.
 *
 * 그래서 턴은 meta에 통째로 넣고, 여기서 그대로 되돌립니다.
 * 저장이 없을 때를 위해 턴이 아니면 빈 턴으로 떨어뜨립니다 —
 * 깨진 값을 화면에 흘려보내지 않기 위한 의도적 방어입니다.
 *
 * ★ 구버전 세션도 열립니다 ★
 * 예전 턴 meta에는 phase와 output_prompt 타입이 들어 있습니다. 지우지 않았으므로
 * 예문·번역·🔊 버튼이 그대로 보입니다 (steps는 형식 검사를 하지 않고 그대로 씁니다).
 * phase는 읽지 않습니다 — 배지가 아니라서 필요 없고, 옛 단계를 되살리면
 * 다시는 거짓말을 다시 하게 됩니다.
 */
function metaToTurn(meta: Record<string, unknown> | null, fallback: string): LessonTurn {
  if (!meta) return emptyTurn(fallback)

  const turn = emptyTurn(typeof meta.content === 'string' ? meta.content : fallback)

  if (Array.isArray(meta.steps)) {
    turn.steps = meta.steps.filter(
      (s): s is LessonStep => typeof s === 'object' && s !== null && typeof s.text === 'string'
    )
  }

  if (Array.isArray(meta.corrections)) {
    turn.corrections = meta.corrections.filter(
      (c): c is LessonTurn['corrections'][number] =>
        typeof c === 'object' && c !== null && typeof c.original === 'string'
    )
  }

  if (typeof meta.summary === 'object' && meta.summary !== null && !Array.isArray(meta.summary)) {
    turn.summary = meta.summary as LessonSummary
  }

  return turn
}

export default function EnglishPage() {
  const [provider, setProvider] = useState<Provider>(DEFAULT_PROVIDER)
  const [model, setModel] = useState<string>(defaultModelFor(DEFAULT_PROVIDER))
  const [customModel, setCustomModel] = useState<string>('')

  /**
   * 오늘 연습할 상황.
   *
   * 예전에는 수준·목표를 여기서 고르는 UI가 있었습니다. 걷어냈습니다 — 이미 아는
   * 걸 다시 묻지 않겠습니다 (사용자 결정 2026-10-02, lib/lesson.ts의 LEARNER_BASELINE).
   * 대신 **무엇을 연습할지**만 고릅니다. 선택지가 되돌 제약이 되지 않도록
   * 프리셋 옆에 직접 입력을 항상 둡니다.
   */
  const [scenario, setScenario] = useState<string>('')
  const [customScenario, setCustomScenario] = useState<string>('')

  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  // 채팅과 같다. provider 원본 오류가 AI 말처럼 보이던 것을 분리한다.
  const [error, setError] = useState<string>('')
  /** 마무리를 누른 뒤입니다. 중복 저장을 막고 버튼을 접습니다. */
  const [finished, setFinished] = useState<boolean>(false)
  // 채팅과 같다 — 저장이 실패했을 때만 경고합니다.
  const [saveWarning, setSaveWarning] = useState<string>('')
  // 채팅과 같다 — 기본은 접힘. 이 앱의 주된 행동은 발화입니다.
  const [panelOpen, setPanelOpen] = useState<boolean>(false)
  // 채팅과 같다 — 새 세션을 만들면 목록 1페이지로 되돌립니다.
  const [listReset, setListReset] = useState<number>(0)

  const {
    enabled: savingEnabled,
    conversations,
    activeId,
    loadingList,
    newConversation,
    openConversation,
    removeConversation,
    saveTurn,
  } = useConversations('english')

  // 모델 목록은 서버(DB)에서 옵니다. /chat과 같은 값을 봅니다.
  const registry = useModelRegistry()

  /** 실제로 프롬프트에 들어갈 상황 문장. 프리셋이면 한국어 라벨 + 영어 지시. */
  const activeScenario = useMemo(() => {
    const custom = customScenario.trim()
    if (custom) return custom
    const preset = SCENARIOS.find((s) => s.id === scenario)
    return preset ? `${preset.label} — ${preset.brief}` : ''
  }, [scenario, customScenario])

  /**
   * ★ 이 기능의 존재 이유입니다 ★
   * 세션 내내 모은 교정과 표현이 아래 "지금까지 모은 것"이 되고, 다음 세션 첫 턴의
   * 프롬프트로 되살아갑니다 (docs/10-english-guide.md §5).
   * 새 표현만 계속 늘면 유창함이 안 느는 이유가 됩니다.
   */
  const turns = useMemo(
    () =>
      entries.filter(
        (e): e is { kind: 'assistant'; turn: LessonTurn } => e.kind === 'assistant'
      ),
    [entries]
  )
  const collected = useMemo(() => collectCorrections(turns.map((e) => e.turn)), [turns])
  const lastSummary = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const s = turns[i].turn.summary
      if (s) return s
    }
    return null
  }, [turns])
  /**
   * 세션 내내 모은 표현입니다.
   *
   * 마지막 턴만 보면 대화 중에는 누적된 것이 보이지 않습니다 — 5턴째에 화면에는
   * 5턴째 표현만 떠 있고, 같은 패널의 실수(collected)는 전부 쌓여 있습니다.
   * "무엇이 쌓이는지 안다"는 말은 두 칸이 같은 스케일이어야 성립합니다.
   *
   * collectExpressions가 턴 안에서만 중복을 지으므로, 여기서 다시 한 번 지웁니다.
   */
  const expressions = useMemo(() => {
    const seen = new Set<string>()
    const out: { phrase: string; meaning: string }[] = []
    for (const { turn } of turns) {
      for (const e of collectExpressions(turn)) {
        const key = e.phrase.trim().replace(/\s+/g, ' ').toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        out.push(e)
      }
    }
    return out
  }, [turns])

  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries, loading])

  const activeModel = model === CUSTOM ? customModel.trim() : model

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    // 목록을 서버에서 읽으므로 provider를 바꾸면 그 목록의 첫 것으로 갑니다.
    setModel(registry.models[p]?.[0]?.id ?? '')
  }

  /**
   * 화면에 쌓인 발화 전체를 API에 보낼 수 있는 텍스트로 바꾼다.
   *
   * 예문·번역 말풍선을 그대로 직렬화하면 JSON 키가 매번 반복되고,
   * 모델이 "내가 이미 뭐를 말했는지"를 읽는데 토큰만 낭비된다.
   * turnToHistoryText가 압축을 담당한다 (lib/lesson.ts).
   */
  const buildHistory = (list: Entry[]) =>
    list.map((e) =>
      e.kind === 'user'
        ? { role: 'user' as const, content: e.text }
        : { role: 'assistant' as const, content: turnToHistoryText(e.turn) }
    )

  /**
   * 지난 표현과 오류를 첫 턴에만 붙입니다.
   *
   * 반복 간격 정책은 아직 없습니다 (lib/lesson.ts의 english_chunks 주석 참고).
   * 여기서는 "최근 것 몇 개"만 보냅니다 — 이 숫자가 곧 반복 정책이 되면
   * 계측 없이 추측을 코드에 박게 됩니다.
   */
  const buildReview = async () => {
    const { chunks, errors } = await listEnglishRecords()
    return {
      expressions: chunks.slice(0, 6).map((c) => `${c.phrase} (${c.meaning})`),
      mistakes: errors.slice(0, 5).map((e) => `${e.original} → ${e.corrected} (${e.reason})`),
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading || finished) return
    if (!activeModel) {
      setError('모델 ID를 입력해주세요.')
      return
    }

    const text = input.trim()
    const withUser: Entry[] = [...entries, { kind: 'user', text }]
    const isFirstTurn = entries.length === 0
    setEntries(withUser)
    setInput('')
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/english', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-token': getToken() || '',
        },
        body: JSON.stringify({
          provider,
          model: activeModel,
          scenario: activeScenario,
          // 첫 턴에만 지난 기록을 되살립니다. 두 번째 턴부터는 이미 대화 안에 있습니다.
          review: isFirstTurn ? await buildReview() : undefined,
          messages: buildHistory(withUser),
        }),
      })

      const data = await res.json()

      // 토큰이 만료됐거나 서버의 APP_TOKEN이 바뀌었을 수 있다.
      if (res.status === 401) {
        clearToken()
        window.location.reload()
        return
      }

      if (!res.ok) {
        throw new Error(data.error || '요청에 실패했습니다.')
      }

      const turn: LessonTurn = {
        content: typeof data.content === 'string' ? data.content : '',
        steps: Array.isArray(data.steps) ? data.steps : [],
        corrections: Array.isArray(data.corrections) ? data.corrections : [],
        summary: data.summary ?? null,
      }

      setEntries([...withUser, { kind: 'assistant', turn, provider: data.provider || provider, model: data.model || activeModel }])

      // 턴을 통째로 meta에 넣습니다. content엔 히스토리 텍스트를 — 화면에는
      // turn.steps로 렌더하고, 모델에게는 압축된 형태로 보냅니다.
      // 라벨용 provider/model을 같은 자리에 덧붙입니다 (Entry 타입 참고).
      const saved = await saveTurn(text, turnToHistoryText(turn), {
        ...(turn as unknown as Record<string, unknown>),
        provider: data.provider || provider,
        model: data.model || activeModel,
      })
      setSaveWarning(saved ? '' : '이 세션은 저장되지 않았습니다. Supabase 연결을 확인하세요.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  /**
   * ★ 마무리 — 이 기능이 채팅이 아닌 학습이 되는 지점입니다 ★
   *
   * 왜 버튼인가 (Phase를 없앤 판단과 같은 근거):
   * 예전 프롬프트는 "두 번 교환하면 summary로 넘어가세요"라고 *부탁*했는데,
   * jsonMode는 순서와 양을 강제하지 않습니다. 강제되지 않은 흐름을 헤더 배지로
   * 표시하고 있었습니다 — 그 배지가 거짓말이었고 그래서 지웠습니다.
   * 지금은 사용자가 누르는 한 번이 종료 신호입니다. 결정론적입니다.
   *
   * 교정을 말미 요약에 넣지 않습니다. 세션 내내 모인 corrections가 정본이고,
   * 같은 정보가 두 곳에 있으면 어느 쪽이 맞는지 어긋납니다 (lib/lesson.ts 참고).
   */
  const handleFinish = async () => {
    if (loading || finished || entries.length === 0) return
    if (!activeModel) {
      setError('모델 ID를 입력해주세요.')
      return
    }

    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/english', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-token': getToken() || '',
        },
        body: JSON.stringify({
          provider,
          model: activeModel,
          scenario: activeScenario,
          finish: true,
          messages: buildHistory(entries),
        }),
      })

      const data = await res.json()

      if (res.status === 401) {
        clearToken()
        window.location.reload()
        return
      }

      if (!res.ok) {
        throw new Error(data.error || '요청에 실패했습니다.')
      }

      const turn: LessonTurn = {
        content: typeof data.content === 'string' ? data.content : '',
        steps: [],
        corrections: [],
        summary: data.summary ?? null,
      }

      setEntries([
        ...entries,
        { kind: 'assistant', turn, provider: data.provider || provider, model: data.model || activeModel },
      ])
      setFinished(true)

      // "마무리"라는 발화가 실제로 있었던 것으로 저장합니다. 대화를 다시 열었을 때
      // 요약 턴이 맥락째로 복원되어야 하기 때문입니다.
      // ★ 저장이 끝난 대화의 id를 그대로 받습니다 ★
      // 첫 세션에서는 대화가 이 안에서 막 만들어집니다. 그래서 activeId를 읽으면
      // 아직 갱신되지 않은 null이 나와서 학습 기록이 저장되지 않습니다 (hooks/useConversations.ts).
      const savedId = await saveTurn('마무리', turnToHistoryText(turn), {
        ...(turn as unknown as Record<string, unknown>),
        provider: data.provider || provider,
        model: data.model || activeModel,
      })

      // ★ 학습 기록을 여기서 저장합니다 ★
      // 대화 저장과 별개입니다. 대화가 있어도 "내가 틀린 것"이 남지 않으면
      // 이 기능은 채팅입니다 (docs/10-english-guide.md §5).
      const conversationId = savedId
      if (!conversationId) {
        setSaveWarning('대화가 아직 만들어지지 않아 학습 기록은 저장되지 않았습니다.')
        return
      }

      const allTurns = [...turns.map((t) => t.turn), turn]
      const ok = await saveEnglishRecords({
        conversationId,
        scenario: activeScenario,
        summary: turn.summary?.headline ?? '',
        errors: collectCorrections(allTurns).map((c, i) => ({
          original: c.original,
          corrected: c.corrected,
          reason: c.reason,
          category: c.category,
          turnIndex: i,
        })),
        expressions: collectExpressions(turn),
      })

      setSaveWarning(
        ok ? '' : '대화는 저장됐지만 학습 기록(틀린 것·표현)은 저장되지 않았습니다.'
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectConversation = async (id: string) => {
    const rows = await openConversation(id)
    const restored: Entry[] = rows.map((r) => {
      if (r.role === 'user') return { kind: 'user' as const, text: r.content }
      // 라벨용 provider/model은 meta에서 되읽습니다 (Entry 타입 참고).
      // 값이 없는 옛 턴은 라벨에서 뺍니다 — 지어내느라 채우는 것보다
      // "모델 없음"이 정직합니다. 채팅 화면과 달리 영어 화면은
      // 대화 설정을 대신 쓰지 않습니다. 여기선 그게 틀린 답이 될 수 있습니다.
      const meta = r.meta as { provider?: unknown; model?: unknown } | null
      return {
        kind: 'assistant' as const,
        turn: metaToTurn(r.meta, r.content),
        provider: typeof meta?.provider === 'string' ? meta.provider : undefined,
        model: typeof meta?.model === 'string' ? meta.model : undefined,
      }
    })
    setEntries(restored)
    // 세션을 다시 열면 마무리는 이미 끝난 상태입니다. 요약 턴이 있으면 확실합니다.
    setFinished(restored.some((e) => e.kind === 'assistant' && e.turn.summary !== null))
    setError('')
    setSaveWarning('')
  }

  const startOver = async () => {
    await newConversation()
    setEntries([])
    setFinished(false)
    setError('')
    setSaveWarning('')
    setListReset((n) => n + 1)
  }

  return (
    <main className="min-h-screen bg-page text-ink flex flex-col">
      {/*
        Header — 채팅 화면과 같은 규칙입니다 (모바일에서 한 줄).

        ★ 모델명은 모바일에서 숨깁니다 ★
        채팅은 좌우에 버튼이 없지만 여기는 "복습"과 "새 세션" 두 개가 있습니다.
        버튼 두 개 + 모델명은 좁은 화면에서 한 줄이 되지 않습니다.
        모델명은 설정 칸 안에 그대로 있고 헤더는 덜 중요한 것이 되도록,
        모바일에서는 숨기고 sm 이상에서만 보입니다.
      */}
      <header className="border-b border-line px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 shrink-0 min-w-0">
          <Link
            href="/"
            className="text-meta text-ink-muted hover:text-ink transition-colors shrink-0"
          >
            ← 홈
          </Link>
          <h1 className="font-display text-sub sm:text-title whitespace-nowrap">영어 학습</h1>
          {/*
            ★ 여기에 단계 배지가 없습니다 ★
            예전엔 PHASE_LABEL[phase]가 헤더에 떴습니다. 그 값은 프롬프트가
            부탁했을 뿐 강제되지 않은 흐름이었고, 배지는 그 부탁을 충실히
            거짓말했습니다. 배지를 지우고 종료는 버튼 하나로 정했습니다
            (handleFinish). 배지를 남겨 두면 재작업의 목적이 사라집니다.
          */}
        </div>
        <div className="flex items-center gap-2 sm:gap-3 text-meta text-ink-muted min-w-0">
          <span className="hidden md:inline shrink-0">
            활성 모델:{' '}
            <span className="font-mono text-ink">{activeModel || '미설정'}</span>
          </span>
          <Link
            href="/english/review"
            className="border border-line rounded-md bg-surface-1 shadow-edge px-2 sm:px-3 py-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink transition-colors shrink-0"
          >
            복습
          </Link>
          <button
            type="button"
            onClick={() => void startOver()}
            disabled={entries.length === 0}
            className="border border-line rounded-md bg-surface-1 shadow-edge px-2 sm:px-3 py-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-surface-1 disabled:hover:text-ink-muted transition-colors shrink-0"
          >
            새 세션
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row max-w-7xl w-full mx-auto">
        {/*
          Sidebar — 채팅 화면과 같은 구조. 기본은 접힘.

          상황 선택 · 대화 목록 · 모델 선택 세 덩어리가 채팅창 위를 계속
          밀어냈습니다. 이 화면의 주된 행동은 영어로 말해 보는 것이고,
          세 덩어리는 그 옆에서 자리를 차지할 뿐이었습니다.
        */}
        <aside className="w-full md:w-80 shrink-0 border-b md:border-b-0 md:border-r border-line">
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            className="w-full flex items-center justify-between px-4 sm:px-6 md:px-4 py-3 text-meta text-ink-muted hover:text-ink transition-colors"
          >
            <span>
              설정
              <span className="text-ink-faint"> · 상황 · 대화 · 모델</span>
            </span>
            <Icon
              name="chevron"
              size={14}
              strokeWidth={2}
              className={`shrink-0 transition-transform ${panelOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {panelOpen && (
            <div className="p-4 sm:p-6 pt-0 md:pt-0 flex flex-col gap-6">
              {/*
                수준·목표 선택 UI를 걷어냈습니다.
                이미 아는 걸 다시 묻지 않습니다 (docs/10-english-guide.md §2).
                값은 서버 상수로 들어 있습니다 (lib/lesson.ts의 LEARNER_BASELINE).
                대신 "무엇을 연습할지"만 고릅니다 — 선택지가 되돌 제약이 되지
                않도록 직접 입력을 항상 함께 둡니다.
              */}
              <div>
                <label className="block font-mono text-label tracking-label uppercase text-ink-faint mb-2">
                  오늘 연습할 상황
                </label>
                <div className="flex flex-wrap gap-2">
                  {SCENARIOS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setScenario(s.id)
                        setCustomScenario('')
                      }}
                      className={`px-2 py-1.5 text-meta rounded-md border transition-colors ${
                        s.id === scenario && !customScenario.trim()
                          ? 'border-accent/40 bg-accent/5 text-ink'
                          : 'border-line bg-surface-1 text-ink-muted hover:border-line-strong hover:text-ink'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={customScenario}
                  onChange={(e) => setCustomScenario(e.target.value)}
                  placeholder="직접 입력 — 실제로 만날 상황"
                  className="mt-2 w-full bg-surface-2 border border-line rounded-md px-3 py-2 text-meta text-ink shadow-edge outline-none focus:border-line-strong transition-colors"
                />
                <p className="mt-2 text-meta leading-relaxed text-ink-faint">
                  고르지 않아도 됩니다. 상황 없이 그냥 대화해도 됩니다.
                </p>
              </div>

              <ConversationList
                conversations={conversations}
                activeId={activeId}
                enabled={savingEnabled}
                loading={loadingList}
                onSelect={(id) => void handleSelectConversation(id)}
                onNew={() => void startOver()}
                onDelete={(id) => void removeConversation(id)}
                emptyHint="저장된 세션이 없습니다. 첫 발화를 보내면 만들어집니다."
                resetSignal={listReset}
              />

              <ModelPicker
                provider={provider}
                onProviderChange={handleProviderChange}
                model={model}
                onModelChange={setModel}
                customModel={customModel}
                onCustomModelChange={setCustomModel}
                registry={registry}
              />
            </div>
          )}
        </aside>

        <section className="flex-1 flex flex-col h-[calc(100vh-65px)] md:h-auto">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {saveWarning && (
              <div className="text-meta text-danger border border-danger/40 bg-danger/5 rounded-md px-3 py-2">
                {saveWarning}
              </div>
            )}

            {entries.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <p className="text-body text-ink-muted">
                  상황을 고르고, 먼저 영어로 한마디 해 보세요.
                </p>
                <p className="text-meta text-ink-faint mt-1">
                  틀려도 바로 고치지 않습니다. 마감을 누를 때 모아서 봅니다.
                </p>
              </div>
            ) : (
              entries.map((entry, idx) =>
                entry.kind === 'user' ? (
                  <div
                    key={idx}
                    className="flex flex-col gap-1.5 max-w-[80%] self-end items-end"
                  >
                    <span className="font-mono text-label tracking-label uppercase text-ink-faint">
                      나
                    </span>
                    <div className="rounded-lg px-4 py-3 text-body whitespace-pre-wrap bg-bubble-me border border-line-strong shadow-edge">
                      {entry.text}
                    </div>
                  </div>
                ) : (
                  <div key={idx} className="flex flex-col gap-1.5 self-start items-start">
                    {/*
                      ★ "튜터"만 쓰면 어떤 모델이 답했는지 알 수 없습니다 ★
                      채팅 화면과 같은 형식입니다. provider와 모델명을 함께 적고,
                      긴 모델 ID는 잘라 말풍선 폭을 침범하지 않게 합니다.

                      옛 턴에는 이 값이 없습니다. 그때는 라벨에서 뺍니다 —
                      지어내느라 채우는 것보다 "모델 없음"이 정직합니다.
                    */}
                    <span
                      className="flex items-center gap-1.5 font-mono text-label tracking-label uppercase text-ink-faint min-w-0 max-w-full"
                      title={entry.provider ? `튜터: ${entry.provider} / ${entry.model}` : undefined}
                    >
                      {/* 강조색 두 번째 지점 (채팅 화면의 AI 점과 같은 역할) */}
                      <i className="w-1 h-1 rounded-full bg-accent shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {entry.provider ? `튜터: ${entry.provider} / ${entry.model}` : '튜터'}
                      </span>
                    </span>

                    {entry.turn.content && (
                      <div className="max-w-[90%] rounded-lg px-4 py-3 text-body whitespace-pre-wrap bg-bubble-them border border-line shadow-edge">
                        {entry.turn.content}
                      </div>
                    )}

                    {entry.turn.steps.length > 0 && (
                      <div className="mt-1 space-y-2 w-full max-w-[90%]">
                        {entry.turn.steps.map((step, i) => (
                          <StepBubble key={i} step={step} />
                        ))}
                      </div>
                    )}

                    {/*
                      ★ 교정은 AI 말풍선과 섞지 않습니다 ★
                      danger는 실패를 뜻하므로 교정에는 쓰지 않습니다 (규칙).
                      교정은 오류가 아니라 학습 기록입니다 — 그래서 "danger"가
                      아니라 surface-1의 별도 카드가 됩니다. 말풍선 안에 넣으면
                      사용자는 그것을 AI의 대답 일부로 읽습니다.
                    */}
                    {entry.turn.corrections.length > 0 && (
                      <div className="mt-1 w-full max-w-[90%] rounded-lg border border-line bg-surface-1 px-4 py-3 space-y-2">
                        {entry.turn.corrections.map((c, i) => (
                          <CorrectionRow key={i} correction={c} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              )
            )}

            {/*
              ★ 지금까지 모은 것 ★
              대화가 진행되는 동안에도 실시간으로 누적됩니다. 마감을 눌러야만
              보일 수 있으면 "세션 끝에 한 번"이라는 약속인데, 그 순간에도
              보이면 사용자는 무엇이 쌓이는지 압니다. 이것이 4·5번 성공 조건의
              화면 쪽 절반입니다.
            */}
            {(collected.length > 0 || expressions.length > 0 || lastSummary) && (
              <LearningPanel
                expressions={expressions}
                mistakes={collected}
                summary={lastSummary}
              />
            )}

            {loading && (
              <div className="flex flex-col gap-1.5 self-start items-start">
                <span className="flex items-center gap-1.5 font-mono text-label tracking-label uppercase text-ink-faint min-w-0 max-w-full">
                  <i className="w-1 h-1 rounded-full bg-accent shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    튜터 응답 중 · {provider} / {activeModel || '미설정'}
                  </span>
                </span>
                <div className="rounded-lg px-4 py-3 text-body bg-bubble-them border border-line shadow-edge text-ink-faint">
                  생각 중...
                </div>
              </div>
            )}

            {error && (
              <div className="border border-danger/40 bg-danger/5 rounded-lg px-4 py-3 text-body text-danger whitespace-pre-wrap">
                {error}
                <button
                  type="button"
                  onClick={() => setError('')}
                  className="block mt-2 text-meta text-danger/70 hover:text-danger transition-colors"
                >
                  닫기
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* 채팅과 같은 컴포저 구조: 컨테이너 하나 + 아이콘 전송 버튼 */}
          <form onSubmit={handleSubmit} className="border-t border-line p-4">
            <div className="flex items-center gap-2 p-2 bg-surface-2 border border-line rounded-xl shadow-edge focus-within:border-line-strong transition-colors">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={finished}
                placeholder={
                  finished
                    ? '오늘 세션을 마쳤습니다. 새 세션으로 이어가세요.'
                    : '영어로 말해 보세요... (예: I would like to book a table)'
                }
                className="flex-1 min-w-0 bg-transparent border-0 px-3 py-2 text-body text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-40"
              />
              <button
                type="submit"
                disabled={loading || finished || !input.trim()}
                title="전송"
                aria-label="전송"
                className="shrink-0 w-8 h-8 rounded-md bg-accent text-page grid place-items-center disabled:opacity-30 transition-opacity"
              >
                <Icon name="send" size={16} strokeWidth={2.2} />
              </button>
            </div>

            {/*
              ★ 마무리 버튼 ★
              예전엔 프롬프트가 "두 번 교환하면 요약으로 넘어가"라고 했고,
              화면은 그 단계를 배지로 보여줬습니다. 어느 쪽도 강제가 아니었습니다.
              지금은 누르는 한 번이 종료입니다. 요약 요청 + 오류/표현 기록이
              여기서 일어납니다 — 이것이 없으면 이 기능은 채팅입니다.
            */}
            {finished ? (
              <p className="mt-2 text-meta text-ink-faint text-center">
                오늘 기록을 모았습니다. <span className="text-ink-muted">새 세션</span>을 눌러
                이어가면 지난 표현이 먼저 나옵니다.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void handleFinish()}
                disabled={loading || entries.length === 0}
                className="mt-2 w-full border border-line-strong rounded-md bg-surface-1 px-3 py-1.5 text-meta text-ink-muted hover:bg-surface-3 hover:text-ink disabled:bg-transparent disabled:border-dashed disabled:border-line disabled:text-ink-faint transition-colors"
              >
                오늘 연습 마무리하기
              </button>
            )}
          </form>
        </section>
      </div>
    </main>
  )
}

/**
 * 교정 한 줄.
 *
 * 원문과 수정을 함께 보여줍니다. 원문만 강조하면 사용자는 "틀렸다"는 사실만
 * 배우고, 수정만 보여주면 왜였는지를 잃습니다.
 */
function CorrectionRow({ correction }: { correction: LessonTurn['corrections'][number] }) {
  const category = ERROR_CATEGORY_LABEL[correction.category as ErrorCategory] ?? '기타'

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-mono text-label tracking-label uppercase text-ink-faint">
          {category}
        </span>
      </div>
      <p className="text-sub text-ink-muted line-through">{correction.original}</p>
      <p className="text-sub text-ink">{correction.corrected}</p>
      <p className="text-meta text-ink-muted">{correction.reason}</p>
    </div>
  )
}

/**
 * 지금까지 모은 것 — 실시간 누적 + 말미 요약.
 *
 * ★ 스크롤 가능하게 둡니다 ★
 * 대화와 같은 흐름에 두지 않습니다. 예문·번역·피드백이 한꺼번에 나오면
 * 흐름이 끊긴다고 판단했습니다 (docs/10-english-guide.md §4). 여기서 잘라
 * 보여주는 것이 그 판단의 구현입니다.
 *
 * "내가 틀린 것"은 summary가 아니라 accumulated mistakes에서 옵니다.
 * 같은 정보를 두 곳에 두지 않기 위해서입니다 (lib/lesson.ts 참고).
 */
function LearningPanel({
  expressions,
  mistakes,
  summary,
}: {
  expressions: { phrase: string; meaning: string }[]
  mistakes: LessonTurn['corrections']
  summary: LessonSummary | null
}) {
  return (
    <section className="self-start w-full max-w-[90%] rounded-lg border border-line bg-surface-1 px-4 py-3">
      {summary?.headline && (
        <p className="text-body text-ink font-medium mb-2">{summary.headline}</p>
      )}

      <div className="max-h-72 overflow-y-auto space-y-4 pr-1">
        <div>
          <h2 className="font-mono text-label tracking-label uppercase text-ink-faint mb-1.5">
            오늘 쓴 표현 {expressions.length}
          </h2>
          {expressions.length === 0 ? (
            <p className="text-meta text-ink-faint">아직 없어요.</p>
          ) : (
            <ul className="space-y-1">
              {expressions.map((e, i) => (
                <li key={i} className="flex flex-col">
                  <span className="text-sub text-ink">{e.phrase}</span>
                  {e.meaning && <span className="text-meta text-ink-muted">{e.meaning}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="font-mono text-label tracking-label uppercase text-ink-faint mb-1.5">
            내가 틀린 것 {mistakes.length}
          </h2>
          {mistakes.length === 0 ? (
            <p className="text-meta text-ink-faint">
              아직 교정한 것이 없습니다. 지금은 그게 좋습니다 — 교정이 없는 것이
              목표입니다.
            </p>
          ) : (
            <div className="space-y-3">
              {mistakes.map((m, i) => (
                <CorrectionRow key={i} correction={m} />
              ))}
            </div>
          )}
        </div>

        {summary && summary.next.length > 0 && (
          <div>
            <h2 className="font-mono text-label tracking-label uppercase text-ink-faint mb-1.5">
              다음에 연습할 것
            </h2>
            <ul className="space-y-1">
              {summary.next.map((n, i) => (
                <li key={i} className="text-sub text-ink-muted">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * 예문 / 연결 표현 / 연습 한 개.
 *
 * ★ 구버전 세션도 이 컴포넌트를 탑니다 ★
 * 예전 턴 meta의 type은 `example` / `output_prompt` 둘이었습니다. meta는
 * 지우지 않았고 형식 검사도 하지 않으므로 그대로 들어옵니다. `output_prompt`를
 * `prompt`로 읽어 같은 화면에 그립니다 — 예문·번역·🔊 버튼이 그대로 보입니다.
 */
function StepBubble({ step }: { step: LessonStep }) {
  // 예전 값도 여기서 흡수합니다. 새 타입 세 개에 없는 값은 prompt로 떨어집니다.
  const type: StepType = step.type === 'phrase' || step.type === 'example' ? step.type : 'prompt'
  const isPractice = type === 'prompt'

  const label = type === 'phrase' ? '연결 표현' : isPractice ? '직접 말하기' : '예문'

  return (
    <div
      className={`rounded-lg border px-4 py-3 shadow-edge ${
        isPractice ? 'border-accent/40 bg-accent/5' : 'border-line bg-surface-1'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={`font-mono text-label tracking-label uppercase rounded-sm px-1.5 py-0.5 ${
                isPractice ? 'bg-accent text-page font-semibold' : 'bg-surface-3 text-ink-muted'
              }`}
            >
              {label}
            </span>
            <span className="font-mono text-meta text-ink-muted">{step.speaker}</span>
          </div>

          <p className="text-body text-ink font-medium">{step.text}</p>
          {step.translation && (
            <p className="text-sub text-ink-muted mt-1">{step.translation}</p>
          )}
          {step.hint && <p className="text-meta text-ink-muted mt-1.5">{step.hint}</p>}
        </div>

        <SpeakButton text={step.text} />
      </div>
    </div>
  )
}
