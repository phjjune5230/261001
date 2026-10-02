'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Provider } from '@/lib/llm'
import { DEFAULT_PROVIDER, defaultModelFor } from '@/lib/models'
import { clearToken, getToken } from '@/lib/auth-client'
import ModelPicker, { CUSTOM } from '@/components/ModelPicker'
import SpeakButton from '@/components/SpeakButton'
import Icon from '@/components/Icon'
import ConversationList from '@/components/ConversationList'
import { useConversations } from '@/hooks/useConversations'
import {
  GOALS,
  LEVELS,
  PHASE_LABEL,
  turnToHistoryText,
  type LessonStep,
  type LessonTurn,
} from '@/lib/lesson'

type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; turn: LessonTurn }

/**
 * DB에서 꺼낸 메시지를 다시 Entry로 되돌립니다.
 *
 * 왜 이것이 필요한가:
 * 영어 턴은 content(튜터 설명) + steps(예문·연습) 구조입니다. 예문을
 * content 문자열로 펴서 저장했다가 열면 **예문과 번역이 섞인 한 덩어리**가 되고,
 * 말풍선·🔊 버튼·단계 배지를 그릴 수 없습니다.
 *
 * 그래서 턴은 meta에 통째로 넣고, 여기서 그대로 되돌립니다 (D-016).
 * 저장이 없을 때를 위해 턴이 아니면 빈 턴으로 떨어뜨립니다 —
 * 깨진 값을 화면에 흘려보내지 않기 위한 의도적 방어입니다.
 */
function metaToTurn(meta: Record<string, unknown> | null, fallback: string): LessonTurn {
  if (meta && typeof meta.phase === 'string') {
    return {
      phase: meta.phase as LessonTurn['phase'],
      content: typeof meta.content === 'string' ? meta.content : fallback,
      steps: Array.isArray(meta.steps) ? (meta.steps as LessonStep[]) : [],
    }
  }
  return { phase: 'intro', content: fallback, steps: [] }
}

export default function EnglishPage() {
  const [provider, setProvider] = useState<Provider>(DEFAULT_PROVIDER)
  const [model, setModel] = useState<string>(defaultModelFor(DEFAULT_PROVIDER))
  const [customModel, setCustomModel] = useState<string>('')
  const [level, setLevel] = useState<string>('중급')
  const [goal, setGoal] = useState<string>('일상 회화')

  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  // 채팅과 같다. provider 원본 오류가 AI 말처럼 보이던 것을 분리한다.
  const [error, setError] = useState<string>('')
  const [phase, setPhase] = useState<LessonTurn['phase'] | null>(null)
  // 채팅과 같다 — 저장이 실패했을 때만 경고합니다.
  const [saveWarning, setSaveWarning] = useState<string>('')

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

  /** DB의 평문 content는 히스토리 텍스트로 압축됩니다 (D-016) */
  const metaToHistoryText = (meta: Record<string, unknown> | null, fallback: string) =>
    turnToHistoryText(metaToTurn(meta, fallback))

  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries, loading])

  const activeModel = model === CUSTOM ? customModel.trim() : model

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    setModel(defaultModelFor(p))
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return
    if (!activeModel) {
      setError('모델 ID를 입력해주세요.')
      return
    }

    const text = input.trim()
    const withUser: Entry[] = [...entries, { kind: 'user', text }]
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
          profile: { level, goal },
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
        phase: data.phase ?? 'intro',
        content: data.content ?? '',
        steps: Array.isArray(data.steps) ? data.steps : [],
      }

      setPhase(turn.phase)
      setEntries([...withUser, { kind: 'assistant', turn }])

      // 턴을 통째로 meta에 넣습니다. content엔 히스토리 텍스트를 — 화면에는
      // turn.steps로 렌더하고, 모델에게는 압축된 형태로 보냅니다.
      const saved = await saveTurn(text, metaToHistoryText(turn as unknown as Record<string, unknown>, ''), turn as unknown as Record<string, unknown>)
      setSaveWarning(saved ? '' : '이 세션은 저장되지 않았습니다. Supabase 연결을 확인하세요.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectConversation = async (id: string) => {
    const rows = await openConversation(id)
    const restored: Entry[] = rows.map((r) =>
      r.role === 'user'
        ? { kind: 'user', text: r.content }
        : { kind: 'assistant', turn: metaToTurn(r.meta, r.content) }
    )
    setEntries(restored)
    // 헤더 배지는 마지막 튜터 턴의 단계로 되살립니다.
    const last = [...restored].reverse().find((e) => e.kind === 'assistant')
    setPhase(last && last.kind === 'assistant' ? last.turn.phase : null)
    setError('')
    setSaveWarning('')
  }

  const startOver = async () => {
    await newConversation()
    setEntries([])
    setPhase(null)
    setError('')
    setSaveWarning('')
  }

  return (
    <main className="min-h-screen bg-page text-ink flex flex-col">
      <header className="border-b border-line px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-meta text-ink-muted hover:text-ink transition-colors">
            ← 홈
          </Link>
          <h1 className="font-display text-title">영어 학습</h1>
          {phase && (
            <span className="font-mono text-label tracking-label uppercase text-accent border border-accent/40 bg-accent/5 rounded-sm px-1.5 py-0.5">
              {PHASE_LABEL[phase]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-meta text-ink-muted">
          <span className="hidden md:inline">
            활성 모델: <span className="font-mono text-ink">{activeModel || '미설정'}</span>
          </span>
          <button
            type="button"
            onClick={() => void startOver()}
            disabled={entries.length === 0}
            className="border border-line rounded-md bg-surface-1 shadow-edge px-3 py-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-surface-1 disabled:hover:text-ink-muted transition-colors"
          >
            새 세션
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row max-w-7xl w-full mx-auto">
        <aside className="w-full md:w-80 border-b md:border-b-0 md:border-r border-line p-6 flex flex-col gap-6">
          <div>
            <label className="block font-mono text-label tracking-label uppercase text-ink-faint mb-2">
              현재 수준
            </label>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  className={`px-2 py-2 text-meta rounded-md border text-center transition-colors ${
                    l === level
                      ? 'border-accent/40 bg-accent/5 text-ink'
                      : 'border-line bg-surface-1 text-ink-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-mono text-label tracking-label uppercase text-ink-faint mb-2">
              목표
            </label>
            <select
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full bg-surface-2 border border-line rounded-md px-3 py-2 pr-8 text-meta text-ink shadow-edge outline-none focus:border-line-strong transition-colors"
            >
              {GOALS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <p className="mt-2 text-meta leading-relaxed text-ink-faint">
              여기서 고른 수준·목표는 서버가 프롬프트를 조립할 때에만 사용됩니다.
            </p>
          </div>

          <div className="border-t border-line pt-6 flex flex-col gap-6">
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              enabled={savingEnabled}
              loading={loadingList}
              onSelect={(id) => void handleSelectConversation(id)}
              onNew={() => void startOver()}
              onDelete={(id) => void removeConversation(id)}
              emptyHint="저장된 세션이 없습니다. 첫 발화를 보내면 만들어집니다."
            />

            <ModelPicker
              provider={provider}
              onProviderChange={handleProviderChange}
              model={model}
              onModelChange={setModel}
              customModel={customModel}
              onCustomModelChange={setCustomModel}
            />
          </div>
        </aside>

        <section className="flex-1 flex flex-col h-[calc(100vh-65px)] md:h-auto">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {saveWarning && (
              <div className="text-meta text-danger border border-danger/40 bg-danger/5 rounded-md px-3 py-2">
                {saveWarning}
              </div>
            )}

            {entries.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <p className="text-body text-ink-muted">수준과 목표를 고른 뒤 시작하세요.</p>
                <p className="text-meta text-ink-faint mt-1">
                  예문은 발음 듣기 버튼으로 들을 수 있습니다.
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
                    <span className="flex items-center gap-1.5 font-mono text-label tracking-label uppercase text-ink-faint">
                      {/* 강조색 두 번째 지점 (채팅 화면의 AI 점과 같은 역할) */}
                      <i className="w-1 h-1 rounded-full bg-accent" aria-hidden="true" />
                      튜터 · {PHASE_LABEL[entry.turn.phase]}
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
                  </div>
                )
              )
            )}

            {loading && (
              <div className="flex flex-col gap-1.5 self-start items-start">
                <span className="flex items-center gap-1.5 font-mono text-label tracking-label uppercase text-ink-faint">
                  <i className="w-1 h-1 rounded-full bg-accent" aria-hidden="true" />
                  튜터 응답 중
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
                placeholder="영어로 말해 보세요... (예: I would like to book a table)"
                className="flex-1 min-w-0 bg-transparent border-0 px-3 py-2 text-body text-ink placeholder:text-ink-faint focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                title="전송"
                aria-label="전송"
                className="shrink-0 w-8 h-8 rounded-md bg-accent text-page grid place-items-center disabled:opacity-30 transition-opacity"
              >
                <Icon name="send" size={16} strokeWidth={2.2} />
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}

function StepBubble({ step }: { step: LessonStep }) {
  const isPractice = step.type === 'output_prompt'

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
              {isPractice ? '직접 말하기' : '예문'}
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
