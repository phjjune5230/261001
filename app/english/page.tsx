'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Provider } from '@/lib/llm'
import { DEFAULT_PROVIDER, defaultModelFor } from '@/lib/models'
import { clearToken, getToken } from '@/lib/auth-client'
import ModelPicker, { CUSTOM } from '@/components/ModelPicker'
import SpeakButton from '@/components/SpeakButton'
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const startOver = () => {
    setEntries([])
    setPhase(null)
    setError('')
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
      <header className="border-b border-[#222] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[#555] hover:text-[#e8ff47] text-xs transition-colors">
            ← 홈
          </Link>
          <h1
            style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }}
            className="text-lg"
          >
            영어 학습
          </h1>
          {phase && (
            <span className="text-[10px] px-2 py-1 rounded border border-[#e8ff47]/40 text-[#e8ff47] bg-[#e8ff47]/5">
              {PHASE_LABEL[phase]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-[#555]">
          <span className="hidden md:inline">
            활성 모델: <span className="text-[#e8ff47] font-mono">{activeModel || '미설정'}</span>
          </span>
          <button
            type="button"
            onClick={startOver}
            disabled={entries.length === 0}
            className="border border-[#222] px-3 py-1.5 rounded text-[#666] hover:border-[#444] hover:text-[#888] disabled:opacity-40 disabled:hover:border-[#222] disabled:hover:text-[#666] transition-colors"
          >
            새 세션
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row max-w-7xl w-full mx-auto">
        <aside className="w-full md:w-80 border-b md:border-b-0 md:border-r border-[#222] p-6 flex flex-col gap-6">
          <div>
            <label className="block text-xs font-semibold text-[#888] mb-2">현재 수준</label>
            <div className="grid grid-cols-3 gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  className={`px-2 py-2 text-xs rounded border transition-colors ${
                    l === level
                      ? 'border-[#e8ff47] text-[#e8ff47] bg-[#e8ff47]/5'
                      : 'border-[#222] text-[#555] hover:border-[#444] hover:text-[#888]'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#888] mb-2">목표</label>
            <select
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full bg-[#151515] border border-[#222] rounded px-3 py-2 text-xs text-white focus:border-[#e8ff47] outline-none"
            >
              {GOALS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[10px] leading-relaxed text-[#444]">
              여기서 고른 수준·목표는 서버가 프롬프트를 조립할 때에만 사용됩니다.
            </p>
          </div>

          <div className="border-t border-[#222] pt-6 flex flex-col gap-6">
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
            {entries.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-[#555] text-sm">
                <p>수준과 목표를 고른 뒤 시작하세요.</p>
                <p className="text-xs text-[#444] mt-1">
                  예문은 🔊 버튼으로 들을 수 있습니다.
                </p>
              </div>
            ) : (
              entries.map((entry, idx) =>
                entry.kind === 'user' ? (
                  <div key={idx} className="flex flex-col items-end">
                    <span className="text-[10px] text-[#444] mb-1">나</span>
                    <div className="max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed bg-[#e8ff47] text-black">
                      {entry.text}
                    </div>
                  </div>
                ) : (
                  <div key={idx} className="flex flex-col items-start">
                    <span className="text-[10px] text-[#444] mb-1">
                      튜터 · {PHASE_LABEL[entry.turn.phase]}
                    </span>

                    {entry.turn.content && (
                      <div className="max-w-[90%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed bg-[#181818] border border-[#222] text-[#ddd]">
                        {entry.turn.content}
                      </div>
                    )}

                    {entry.turn.steps.length > 0 && (
                      <div className="mt-2 space-y-2 w-full max-w-[90%]">
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
              <div className="flex flex-col items-start">
                <span className="text-[10px] text-[#444] mb-1">튜터 응답 중...</span>
                <div className="bg-[#181818] border border-[#222] rounded-xl px-4 py-3 text-sm text-[#777] animate-pulse">
                  생각 중...
                </div>
              </div>
            )}

            {error && (
              <div className="border border-[#ef4444]/40 bg-[#ef4444]/5 rounded-lg px-4 py-3 text-sm text-[#ef8888] whitespace-pre-wrap leading-relaxed">
                {error}
                <button
                  type="button"
                  onClick={() => setError('')}
                  className="block mt-2 text-xs text-[#ef4444] hover:text-[#ef8888] transition-colors"
                >
                  닫기
                </button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="border-t border-[#222] p-4 bg-[#0f0f0f] flex gap-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="영어로 말해 보세요... (예: I would like to book a table)"
              className="flex-1 bg-[#151515] border border-[#222] rounded-lg px-4 py-3 text-sm text-white focus:border-[#e8ff47] outline-none"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-[#e8ff47] text-black font-semibold px-6 py-3 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              전송
            </button>
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
      className={`rounded-lg border px-4 py-3 ${
        isPractice
          ? 'border-[#e8ff47]/40 bg-[#e8ff47]/5'
          : 'border-[#222] bg-[#151515]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                isPractice ? 'bg-[#e8ff47] text-black font-semibold' : 'bg-[#222] text-[#888]'
              }`}
            >
              {isPractice ? '직접 말하기' : '예문'}
            </span>
            <span className="text-[10px] text-[#555] font-mono">{step.speaker}</span>
          </div>

          <p className="text-sm text-white font-medium leading-relaxed">{step.text}</p>
          {step.translation && (
            <p className="text-xs text-[#777] mt-1 leading-relaxed">{step.translation}</p>
          )}
          {step.hint && (
            <p className="text-[11px] text-[#e8ff47]/70 mt-1.5 leading-relaxed">{step.hint}</p>
          )}
        </div>

        <SpeakButton text={step.text} />
      </div>
    </div>
  )
}
