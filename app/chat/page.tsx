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

type Message = {
  role: 'user' | 'assistant'
  content: string
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

  // 새 메시지가 생길 때마다 하단으로. 긴 대화에서 답이 화면 밖에 생기는 것을 막는다.
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // 선택된 항목이 '직접 입력'이면 customModel 값을 실제 model ID로 사용
  const activeModel = model === CUSTOM ? customModel.trim() : model

  const handleProviderChange = (newProvider: Provider) => {
    setProvider(newProvider)
    setModel(defaultModelFor(newProvider))
  }

  /** 목록에서 대화를 고릅니다. 이전 대화의 provider·model도 되살립니다. */
  const handleSelectConversation = async (id: string) => {
    const rows = await openConversation(id)
    setMessages(rows.map((r) => ({ role: r.role, content: r.content })))
    setTrimmedNotice('')
    setError('')

    const convo = conversations.find((c) => c.id === id)
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

      setMessages([...nextMessages, { role: 'assistant', content: data.content }])

      // 화면에 먼저 찍고 저장은 그다음. 저장이 느려도 대화가 멈추지 않습니다.
      const saved = await saveTurn(userMessage.content, data.content)
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
      {/* Header */}
      <header className="border-b border-line px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-meta text-ink-muted hover:text-ink transition-colors"
          >
            ← 홈
          </Link>
          <h1 className="font-display text-title">AI 채팅</h1>
        </div>
        <div className="flex items-center gap-2 text-meta text-ink-muted">
          <span>활성 모델:</span>
          {/* 강조색은 전송 버튼과 AI 라벨 점 두 곳에만 쓴다 */}
          <span className="font-mono text-ink">
            {provider} / {activeModel || '모델 미설정'}
          </span>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row max-w-7xl w-full mx-auto">
        {/* Sidebar Controls */}
        <aside className="w-full md:w-80 border-b md:border-b-0 md:border-r border-line p-6 flex flex-col gap-6">
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
                  <span className="flex items-center gap-1.5 font-mono text-label tracking-label uppercase text-ink-faint">
                    {/* AI 라벨 앞의 점 — 강조색 두 번째(마지막) 지점 */}
                    {m.role === 'assistant' && (
                      <i className="w-1 h-1 rounded-full bg-accent" aria-hidden="true" />
                    )}
                    {m.role === 'user' ? 'You' : 'AI'}
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
                <span className="flex items-center gap-1.5 font-mono text-label tracking-label uppercase text-ink-faint">
                  <i className="w-1 h-1 rounded-full bg-accent" aria-hidden="true" />
                  AI 응답 중
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