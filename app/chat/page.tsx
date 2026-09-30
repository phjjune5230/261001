'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Provider } from '@/lib/llm'
import { DEFAULT_PROVIDER, defaultModelFor } from '@/lib/models'
import { clearToken, getToken } from '@/lib/auth-client'
import ModelPicker, { CUSTOM } from '@/components/ModelPicker'
import ConversationList from '@/components/ConversationList'
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
  // 서버가 컨텍스트 예산 때문에 버린 메시지 수. 숨기면 사용자가 모른다 (D-014).
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
        setTrimmedNotice(
          `앞에서 ${data.droppedMessages}개 메시지를 잘랐습니다 (약 ${data.approxTokens ?? 0} 토큰). ` +
          `화면에는 그대로 남아 있습니다.`
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
    <main className="min-h-screen bg-[#0f0f0f] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-[#222] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[#555] hover:text-[#e8ff47] text-xs transition-colors">
            ← 홈
          </Link>
          <h1 style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }} className="text-lg">
            AI 채팅
          </h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#555]">
          <span>활성 모델:</span>
          <span className="text-[#e8ff47] font-mono">{provider} / {activeModel || '모델 미설정'}</span>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex flex-col md:flex-row max-w-7xl w-full mx-auto">
        {/* Sidebar Controls */}
        <aside className="w-full md:w-80 border-b md:border-b-0 md:border-r border-[#222] p-6 flex flex-col gap-6">
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
            <label className="block text-xs font-semibold text-[#888] mb-2">시스템 프롬프트</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              className="w-full bg-[#151515] border border-[#222] rounded p-3 text-xs text-white focus:border-[#e8ff47] outline-none resize-none"
            />
          </div>
        </aside>

        {/* Chat Area */}
        <section className="flex-1 flex flex-col h-[calc(100vh-65px)] md:h-auto">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {trimmedNotice && (
              <div className="text-[11px] text-[#666] border border-[#222] rounded px-3 py-2 bg-[#151515]">
                {trimmedNotice}
              </div>
            )}

            {saveWarning && (
              <div className="text-[11px] text-[#ef8888] border border-[#ef4444]/40 bg-[#ef4444]/5 rounded px-3 py-2">
                {saveWarning}
              </div>
            )}

            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-[#555] text-sm">
                <p>대화를 시작해보세요.</p>
                <p className="text-xs text-[#444] mt-1">프로바이더와 모델을 변경하며 테스트할 수 있습니다.</p>
              </div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={idx}
                  className="flex flex-col"
                >
                  <span className="text-[10px] text-[#444] mb-1">
                    {m.role === 'user' ? 'You' : 'AI'}
                  </span>
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-[#e8ff47] text-black self-end'
                        : 'bg-[#181818] border border-[#222] text-[#ddd]'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex flex-col items-start">
                <span className="text-[10px] text-[#444] mb-1">AI 응답 중...</span>
                <div className="bg-[#181818] border border-[#222] rounded-xl px-4 py-3 text-sm text-[#777] animate-pulse">
                  생성 중...
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

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="border-t border-[#222] p-4 bg-[#0f0f0f] flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="메시지를 입력하세요..."
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
