'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Provider } from '@/lib/llm'
import { DEFAULT_PROVIDER, defaultModelFor } from '@/lib/models'
import { clearToken, getToken } from '@/lib/auth-client'
import ModelPicker, { CUSTOM } from '@/components/ModelPicker'
import ConversationList from '@/components/ConversationList'
import Icon from '@/components/Icon'
import { useConversations } from '@/hooks/useConversations'
import { useModelRegistry } from '@/hooks/useModelRegistry'

type Message = {
  role: 'user' | 'assistant'
  content: string
  /**
   * ★ 이 메시지를 만들어낸 provider·model ★
   *
   * 라벨에 "AI"만 쓰면 어떤 모델이 답했는지 알 수 없습니다. 화면에 있는
   * provider/model은 **지금 고른 것**이지 그 메시지를 만든 것이 아닙니다.
   * 대화를 오가며 모델을 바꾸면 라벨이 거짓말을 하게 됩니다.
   *
   * 그래서 답을 받을 때 붙여서 저장합니다 (messages.meta). 열 때도 meta에서
   * 되읽습니다 — 그래야 새로고침해도 라벨이 남습니다.
   *
   * ★ 없는 경우의 처리 ★
   * 이 값을 쓰기 전에 저장된 메시지에는 meta에 모델이 없습니다. 그때는
   * 대화 설정으로 대체합니다. 근사치이지 정답은 아닙니다 — 대화가 중간에
   * 모델을 바꿨다면 그중 몇 턴은 잘못 표시됩니다. 대부분은 이 경우에
   * 해당하지 않으므로, 없는 값을 지어내느라 라벨을 떨군 것보다 낫다고
   * 판단했습니다. 이 판정이 틀린 적은 없습니다.
   */
  provider?: string
  model?: string
}

export default function ChatPage() {
  const [provider, setProvider] = useState<Provider>(DEFAULT_PROVIDER)
  const [model, setModel] = useState<string>(defaultModelFor(DEFAULT_PROVIDER))
  const [customModel, setCustomModel] = useState<string>('')
  const [systemPrompt, setSystemPrompt] = useState<string>('You are a helpful AI assistant.')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  // 에러를 대화 말풍선에 섞지 않는다. provider 원본 JSON이 AI 답처럼 보이던 것을 분리.
  const [error, setError] = useState<string>('')
  // 서버가 컨텍스트 예산 때문에 버린 메시지 수. 숨기면 사용자가 모른다.
  const [trimmedNotice, setTrimmedNotice] = useState<string>('')
  // 저장이 실패했을 때만 경고합니다. 성공은 조용합니다.
  const [saveWarning, setSaveWarning] = useState<string>('')
  /**
   * 왼쪽 설정 칸(대화 목록 · 모델 · 프롬프트)을 펼쳤나.
   *
   * ★ 기본은 접힘 ★
   * 이 앱의 주된 행동은 메시지를 보내는 것이고, 대화 목록·모델 선택·시스템
   * 프롬프트 세 덩어리는 그 옆에서 계속 자리를 차지했습니다. 모바일에서는
   * 대화창을 반 이하로 밀어냈습니다. 그래서 접힌 상태로 시작합니다.
   */
  const [panelOpen, setPanelOpen] = useState<boolean>(false)

  const {
    enabled: savingEnabled,
    conversations,
    activeId,
    loadingList,
    newConversation,
    openConversation,
    removeConversation,
    saveTurn,
  } = useConversations('chat')

  // 모델 목록은 서버(DB)에서 옵니다. v0.13.0 이전엔 코드에 박혀 있었습니다.
  const registry = useModelRegistry()

  // 새 메시지가 생길 때마다 하단으로. 긴 대화에서 답이 화면 밖에 생기는 것을 막는다.
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // 선택된 항목이 '직접 입력'이면 customModel 값을 실제 model ID로 사용
  const activeModel = model === CUSTOM ? customModel.trim() : model

  const handleProviderChange = (newProvider: Provider) => {
    setProvider(newProvider)
    // 목록을 서버에서 읽으므로, provider를 바꾸면 그 목록의 첫 것으로 갑니다.
    // (예전에는 코드에 박힌 기본값을 썼습니다)
    setModel(registry.models[newProvider]?.[0]?.id ?? '')
  }

  /** 목록에서 대화를 고릅니다. 이전 대화의 provider·model도 되살립니다. */
  const handleSelectConversation = async (id: string) => {
    const rows = await openConversation(id)

    const convo = conversations.find((c) => c.id === id)
    const fallbackProvider = convo?.provider ?? provider
    const fallbackModel = convo?.model ?? ''

    // AI 라벨에 쓸 provider·model을 되읽습니다. meta에 없는 옛 메시지는
    // 대화 설정으로 대체합니다 (Message 타입의 주석 참고).
    setMessages(
      rows.map((r) => {
        const meta = r.meta as { provider?: unknown; model?: unknown } | null
        return {
          role: r.role,
          content: r.content,
          provider:
            typeof meta?.provider === 'string'
              ? meta.provider
              : r.role === 'assistant'
                ? fallbackProvider
                : undefined,
          model:
            typeof meta?.model === 'string'
              ? meta.model
              : r.role === 'assistant'
                ? fallbackModel || activeModel
                : undefined,
        }
      })
    )
    setTrimmedNotice('')
    setError('')

    if (convo?.provider && convo?.model) {
      const p = convo.provider as Provider
      setProvider(p)
      setModel(convo.model)
    }
  }

  const handleNewConversation = async () => {
    await newConversation()
    setMessages([])
    setTrimmedNotice('')
    setError('')
    setSaveWarning('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || loading) return
    if (!activeModel) {
      setError('모델 ID를 입력해주세요.')
      return
    }

    const userMessage: Message = { role: 'user', content: input.trim() }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-token': getToken() || '',
        },
        body: JSON.stringify({
          provider,
          model: activeModel,
          systemPrompt,
          messages: nextMessages,
          // 압축은 대화 단위라 서버가 알아야 합니다.
          // 첫 턴에는 아직 대화가 없어서 null입니다 — 그때는 압축할 만큼 길지도 않습니다.
          conversationId: activeId,
        }),
      })

      const data = await res.json()

      // 토큰이 만료됐거나 서버의 APP_TOKEN이 바뀌었을 수 있다.
      // 세션을 지우고 잠금 화면으로 되돌린다.
      if (res.status === 401) {
        clearToken()
        window.location.reload()
        return
      }

      if (!res.ok) {
        throw new Error(data.error || '요청에 실패했습니다.')
      }

      // ★ 라벨에 쓸 모델은 "우리가 보낸 것"이 아니라 "provider가 되돌린 것" ★
      // provider가 대표 모델로 되돌려줄 수 있고, 그때 실제 답을 쓴 것은
      // 돌려받은 쪽입니다. data가 없는 예외 상황에만 보낸 값으로 대체합니다.
      const repliedProvider: string = data.provider || provider
      const repliedModel: string = data.model || activeModel

      setMessages([
        ...nextMessages,
        { role: 'assistant', content: data.content, provider: repliedProvider, model: repliedModel },
      ])

      // 화면에 먼저 찍고 저장은 그다음. 저장이 느려도 대화가 멈추지 않습니다.
      // meta에 모델을 함께 넣어 라벨이 새로고침 뒤에도 남게 합니다.
      const saved = await saveTurn(userMessage.content, data.content, {
        provider: repliedProvider,
        model: repliedModel,
      })
      setSaveWarning(saved ? '' : '이 대화는 저장되지 않았습니다. Supabase 연결을 확인하세요.')

      // 버린 게 있을 때만 알려준다. 매번 말을 걸면 노이즈가 된다.
      if (typeof data.droppedMessages === 'number' && data.droppedMessages > 0) {
        // 압축까지 갱신됐다면 "잘라 버렸다"는 설명이 사실과 어긋납니다.
        // 그 자리는 요약문이 대신하고 있고, 모델은 그것을 읽습니다.
        setTrimmedNotice(
          data.compacted
            ? `앞에서 ${data.droppedMessages}개 메시지를 요약으로 대체했습니다 ` +
              `(약 ${data.approxTokens ?? 0} 토큰). 원본은 화면에 그대로 남아 있습니다.`
            : `앞에서 ${data.droppedMessages}개 메시지를 잘랐습니다 ` +
              `(약 ${data.approxTokens ?? 0} 토큰). 화면에는 그대로 남아 있습니다.`
        )
      } else {
        setTrimmedNotice('')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-page text-ink flex flex-col">
      {/*
        Header

        ★ 모바일에서 한 줄을 지킨다 ★
        예전에는 `← 홈 · AI 채팅 · 활성 모델: groq / openai/gpt-oss-120b`가
        한 줄에 얹혔습니다. 좁은 화면에서는 모델 ID가 길어서 줄이 두 줄로
        깨지고 헤더가 화면을 두 배로 먹었습니다.

        고친 것
          - 패딩·간격을 모바일에서 줄였습니다 (px-6 py-4 → px-4 py-3).
          - 제목은 text-sub(13px)로 내렸고 sm 이상에서만 text-title(17px)입니다.
          - "활성 모델:" 라벨은 sm 미만에서 숨깁니다.
          - provider 접두어도 뺍니다. 모델명만 남깁니다.
          - 남은 모델명은 truncate로 앞부분만 보여주고, title 속성에 전체를 둡니다
            (데스크톱 커서를 올리면 전체가 나옵니다).
        그래도 긴 모델 ID는 아무리 줄여도 한 화면에 들어가지 않습니다 —
        그래서 truncate로 끊습니다. 접는 것이 지터를 없앨 뿐이진 않습니다.
      */}
      <header className="border-b border-line px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 shrink-0 min-w-0">
          <Link
            href="/"
            className="text-meta text-ink-muted hover:text-ink transition-colors shrink-0"
          >
            ← 홈
          </Link>
          <h1 className="font-display text-sub sm:text-title whitespace-nowrap">AI 채팅</h1>
        </div>
        <div className="flex items-center gap-2 min-w-0 text-meta text-ink-muted">
          <span className="hidden sm:inline shrink-0">활성 모델:</span>
          {/* 강조색은 전송 버튼과 AI 라벨 점 두 곳에만 쓴다 */}
          <span
            className="font-mono text-ink truncate"
            title={`${provider} / ${activeModel || '모델 미설정'}`}
          >
            {activeModel || '모델 미설정'}
          </span>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row max-w-7xl w-full mx-auto">
        {/*
          Sidebar

          ★ 기본은 접힌 상태입니다 ★
          대화 목록 + 모델 선택 + 시스템 프롬프트가 세 덩어리인데, 이 앱의
          주된 행동은 "메시지를 보내는 것"입니다. 그 세 덩어리는 chatscroll을
          계속 밀어내면서 아무것도 하지 않는 반열이었고, 모바일에서는 대화창
          절반을 차지했습니다.

          기본을 펼침으로 두면 화면 첫 진입에 가장 많이 쓰는 대화창이 제일
          좁아집니다. 그래서 접힘이 기본이고, 펼칠 때만 그 칸이 됩니다.

          접었다 폈다는 화면 상태일 뿐 대화 상태가 아닙니다. 서버에도 저장하지
          않습니다 — 저장하면 다음에 열 때 예측 못 하는 화면이 됩니다.
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
              <span className="text-ink-faint"> · 대화 · 모델 · 프롬프트</span>
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
              <ConversationList
                conversations={conversations}
                activeId={activeId}
                enabled={savingEnabled}
                loading={loadingList}
                onSelect={(id) => void handleSelectConversation(id)}
                onNew={() => void handleNewConversation()}
                onDelete={(id) => void removeConversation(id)}
                emptyHint="저장된 대화가 없습니다. 첫 메시지를 보내면 만들어집니다."
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

              <div>
                <label className="block font-mono text-label tracking-label uppercase text-ink-faint mb-2">
                  시스템 프롬프트
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                  className="w-full bg-surface-2 border border-line rounded-md p-3 text-sub text-ink font-mono shadow-edge outline-none focus:border-line-strong transition-colors resize-none"
                />
              </div>
            </div>
          )}
        </aside>

        {/* Chat Area */}
        <section className="flex-1 flex flex-col h-[calc(100vh-65px)] md:h-auto">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {trimmedNotice && (
              <div className="text-meta text-ink-muted border border-line rounded-md px-3 py-2 bg-surface-1 shadow-edge">
                {trimmedNotice}
              </div>
            )}

            {saveWarning && (
              <div className="text-meta text-danger border border-danger/40 bg-danger/5 rounded-md px-3 py-2">
                {saveWarning}
              </div>
            )}

            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <p className="text-body text-ink-muted">대화를 시작해보세요.</p>
                <p className="text-meta text-ink-faint mt-1">
                  프로바이더와 모델을 변경하며 테스트할 수 있습니다.
                </p>
              </div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col gap-1.5 max-w-[80%] ${
                    m.role === 'user' ? 'self-end items-end' : 'self-start items-start'
                  }`}
                >
                  <span
                    className="flex items-center gap-1.5 font-mono text-label tracking-label uppercase text-ink-faint min-w-0 max-w-full"
                    title={m.role === 'assistant' ? `AI: ${m.provider} / ${m.model}` : undefined}
                  >
                    {/* AI 라벨 앞의 점 — 강조색 두 번째(마지막) 지점 */}
                    {m.role === 'assistant' && (
                      <i className="w-1 h-1 rounded-full bg-accent shrink-0" aria-hidden="true" />
                    )}
                    {/*
                      ★ "AI"만 쓰면 어떤 모델이 답했는지 알 수 없습니다 ★
                      provider와 모델명을 함께 적습니다. 대화가 길어질수록 모델을
                      바꿔 쓰게 되는데, 라벨에 없으면 왜 답투가 달라졌는지 확인할
                      단서가 없습니다.

                      truncate를 줬습니다. 모델 ID는 길고 말풍선은 80% 폭이라,
                      라벨이 한 줄을 넘어가면 메시지 전체의 폭까지 줄어들 있었습니다.
                    */}
                    <span className={m.role === 'assistant' ? 'truncate' : undefined}>
                      {m.role === 'user'
                        ? 'You'
                        : `AI: ${m.provider ?? ''} / ${m.model ?? ''}`.trim()}
                    </span>
                  </span>
                  <div
                    className={`rounded-lg px-4 py-3 text-body whitespace-pre-wrap border shadow-edge ${
                      m.role === 'user'
                        ? 'bg-bubble-me border-line-strong'
                        : 'bg-bubble-them border-line'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex flex-col gap-1.5 self-start items-start">
                <span className="flex items-center gap-1.5 font-mono text-label tracking-label uppercase text-ink-faint min-w-0 max-w-full">
                  <i className="w-1 h-1 rounded-full bg-accent shrink-0" aria-hidden="true" />
                  <span className="truncate">AI 응답 중 · {provider} / {activeModel || '모델 미설정'}</span>
                </span>
                <div className="rounded-lg px-4 py-3 text-body bg-bubble-them border border-line shadow-edge text-ink-faint">
                  생성 중...
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

          {/*
            컴포저를 컨테이너 하나로.
            인풋과 버튼이 나란한 회색 박스 2개로 보이던 구조를 접었다.
            포커스는 컨테이너가 받아 테두리만 바꾼다(인풋에 링을 두지 않음).
          */}
          {/*
            마이크 버튼이 없는 것은 빠뜨린 게 아니라 판단입니다.
            이 앱에는 음성 입력 기능이 없습니다 (BACKLOG의 STT 항목 — 브라우저
            SpeechRecognition은 Chrome 한정이고 오인식이 잦아 보류 중).
            동작하지 않는 버튼을 두면 조용한 버그가 되므로, 기능부터 넣고
            그때 버튼을 추가하세요.
          */}
          <form onSubmit={handleSubmit} className="border-t border-line p-4">
            <div className="flex items-center gap-2 p-2 bg-surface-2 border border-line rounded-xl shadow-edge focus-within:border-line-strong transition-colors">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="메시지를 입력하세요..."
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