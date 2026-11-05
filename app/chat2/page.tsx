'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Provider } from '@/lib/llm'
import { DEFAULT_PROVIDER, defaultModelFor } from '@/lib/models'
import { clearToken, getToken } from '@/lib/auth-client'
import ModelPicker, { CUSTOM } from '@/components/ModelPicker'
import ConversationList from '@/components/ConversationList'
import SidePanel, { type SidePanelTab } from '@/components/SidePanel'
import Icon from '@/components/Icon'
import { useConversations } from '@/hooks/useConversations'
import { useModelRegistry } from '@/hooks/useModelRegistry'

/**
 * 채팅2 — 기존 /chat을 그대로 두고 옆에 둔 화면.
 * Vercel AI SDK(useChat + 스트리밍)로 연결한다.
 * 저장은 기존 conversations 테이블의 kind='chat2'를 쓴다
 * (supabase/add-chat2-kind.sql 실행 후 켜진다).
 */
const CHAT2_TABS: SidePanelTab[] = [
  { id: 'chat', label: '대화' },
  { id: 'model', label: '모델' },
  { id: 'prompt', label: '프롬프트' },
]

/** UIMessage의 text 파트만 합친다. */
function textOf(m: { parts: { type: string; text?: string }[] }): string {
  return m.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('')
}

export default function Chat2Page() {
  const [provider, setProvider] = useState<Provider>(DEFAULT_PROVIDER)
  const [model, setModel] = useState<string>(defaultModelFor(DEFAULT_PROVIDER))
  const [customModel, setCustomModel] = useState<string>('')
  const [systemPrompt, setSystemPrompt] = useState<string>('You are a helpful AI assistant.')
  const [input, setInput] = useState<string>('')

  const registry = useModelRegistry()

  const {
    enabled: savingEnabled,
    conversations,
    activeId,
    loadingList,
    newConversation,
    openConversation,
    removeConversation,
    saveTurn,
  } = useConversations('chat2')

  const [saveWarning, setSaveWarning] = useState<string>('')
  const [listReset, setListReset] = useState<number>(0)

  const activeModel = model === CUSTOM ? customModel.trim() : model

  // transport는 한 번만 만든다. provider/model/systemPrompt는
  // sendMessage/regenerate의 body로 그 시점 값을 실어 보낸다.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat2',
        headers: () => ({ 'x-app-token': getToken() || '' }),
      }),
    []
  )

  const requestBody = () => ({
    provider,
    model: activeModel,
    systemPrompt,
  })

  const { messages, sendMessage, setMessages, stop, regenerate, status, error } = useChat({
    transport,
    onError: (err) => {
      if (err.message.includes('401')) {
        clearToken()
        window.location.reload()
      }
    },
  })

  const busy = status === 'submitted' || status === 'streaming'

  // 답이 끝난 뒤 한 쌍(user+assistant)을 저장한다.
  // 이미 저장한 assistant 메시지 id는 다시 저장하지 않는다 —
  // 과거 대화를 열어 복원했을 때 중복 저장이 되는 것을 막는다.
  const savedIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (status !== 'ready') return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || savedIdsRef.current.has(last.id)) return
    const userMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (!userMsg) return
    savedIdsRef.current.add(last.id)
    void saveTurn(textOf(userMsg), textOf(last), { provider, model: activeModel }).then((saved) => {
      setSaveWarning(saved ? '' : '이 대화는 저장되지 않았습니다. Supabase 연결을 확인하세요.')
    })
  }, [status, messages, saveTurn, provider, activeModel])

  const handleSelectConversation = async (id: string) => {
    const rows = await openConversation(id)
    const convo = conversations.find((c) => c.id === id)
    const loaded = rows.map((r) => ({
      id: r.id,
      role: r.role,
      parts: [{ type: 'text' as const, text: r.content }],
    }))
    // 복원한 메시지는 저장된 것이므로 저장 대상에서 제외한다.
    loaded.forEach((m) => savedIdsRef.current.add(m.id))
    setMessages(loaded)
    setSaveWarning('')
    if (convo?.provider && convo?.model) {
      setProvider(convo.provider as Provider)
      setModel(convo.model)
    }
  }

  const handleNewConversation = async () => {
    await newConversation()
    setMessages([])
    setSaveWarning('')
    setListReset((n) => n + 1)
  }

  const handleProviderChange = (newProvider: Provider) => {
    setProvider(newProvider)
    setModel(registry.models[newProvider]?.[0]?.id ?? '')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    if (!activeModel) return
    setInput('')
    void sendMessage({ text }, { body: requestBody() })
  }

  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  return (
    <main className="min-h-screen bg-page text-ink flex flex-col">
      <header className="border-b border-line px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 sm:gap-4 shrink-0 min-w-0">
          <Link href="/" className="text-meta text-ink-muted hover:text-ink transition-colors shrink-0">
            ← 홈
          </Link>
          <h1 className="font-display text-sub sm:text-title whitespace-nowrap">
            AI 채팅2
            <span className="ml-2 text-meta text-ink-faint font-normal">Vercel AI SDK · 스트리밍</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 min-w-0 text-meta text-ink-muted">
          <span className="hidden sm:inline shrink-0">활성 모델:</span>
          <span
            className="font-mono text-ink truncate"
            title={`${provider} / ${activeModel || '모델 미설정'}`}
          >
            {activeModel || '모델 미설정'}
          </span>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row max-w-7xl w-full mx-auto">
        <SidePanel tabs={CHAT2_TABS}>
          {(tab) =>
            tab === 'chat' ? (
              <ConversationList
                conversations={conversations}
                activeId={activeId}
                enabled={savingEnabled}
                loading={loadingList}
                onSelect={(id) => void handleSelectConversation(id)}
                onNew={() => void handleNewConversation()}
                onDelete={(id) => void removeConversation(id)}
                emptyHint="저장된 대화가 없습니다. 첫 메시지를 보내면 만들어집니다."
                resetSignal={listReset}
              />
            ) : tab === 'model' ? (
              <ModelPicker
                provider={provider}
                onProviderChange={handleProviderChange}
                model={model}
                onModelChange={setModel}
                customModel={customModel}
                onCustomModelChange={setCustomModel}
                registry={registry}
              />
            ) : (
              <div>
                <label className="block font-mono text-label tracking-label uppercase text-ink-faint mb-2">
                  시스템 프롬프트
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={6}
                  className="w-full bg-surface-2 border border-line rounded-md p-3 text-sub text-ink font-mono shadow-edge outline-none focus:border-line-strong transition-colors resize-none"
                />
                <p className="text-meta text-ink-faint mt-2">
                  대화는 Supabase에 저장됩니다. 저장이 안 되면 목록 칸에 안내가 뜹니다
                  (supabase/add-chat2-kind.sql 실행 여부를 확인하세요).
                </p>
              </div>
            )
          }
        </SidePanel>

        <section className="flex-1 flex flex-col h-[calc(100vh-65px)] md:h-auto">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {saveWarning && (
              <div className="text-meta text-danger border border-danger/40 bg-danger/5 rounded-md px-3 py-2">
                {saveWarning}
              </div>
            )}
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <p className="text-body text-ink-muted">대화를 시작해보세요.</p>
                <p className="text-meta text-ink-faint mt-1">
                  기존 채팅(/chat)과 같은 모델·키를 쓰지만, 답이 스트리밍으로 흘러나옵니다.
                </p>
              </div>
            ) : (
              messages.map((m) => {
                const text = m.parts
                  .filter((p) => p.type === 'text')
                  .map((p) => (p.type === 'text' ? p.text : ''))
                  .join('')
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-1.5 max-w-[80%] ${
                      m.role === 'user' ? 'self-end items-end' : 'self-start items-start'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-label tracking-label uppercase text-ink-faint min-w-0 max-w-full">
                      {m.role === 'assistant' && (
                        <i className="w-1 h-1 rounded-full bg-accent shrink-0" aria-hidden="true" />
                      )}
                      <span className={m.role === 'assistant' ? 'truncate' : undefined}>
                        {m.role === 'user' ? 'You' : `AI: ${provider} / ${activeModel || ''}`}
                      </span>
                    </span>
                    <div
                      className={`rounded-lg px-4 py-3 text-body border shadow-edge ${
                        m.role === 'user'
                          ? 'bg-bubble-me border-line-strong whitespace-pre-wrap'
                          : 'bg-bubble-them border-line'
                      }`}
                    >
                      {m.role === 'assistant' ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                      ) : (
                        text
                      )}
                    </div>
                  </div>
                )
              })
            )}

            {busy && (
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
                {error.message || '요청에 실패했습니다.'}
                <button
                  type="button"
                  onClick={() => setMessages(messages.slice(0, -1))}
                  className="block mt-2 text-meta text-danger/70 hover:text-danger transition-colors"
                >
                  실패한 메시지 지우기
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSubmit} className="border-t border-line p-4">
            <div className="flex items-center gap-2 p-2 bg-surface-2 border border-line rounded-xl shadow-edge focus-within:border-line-strong transition-colors">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="메시지를 입력하세요..."
                className="flex-1 min-w-0 bg-transparent border-0 px-3 py-2 text-body text-ink placeholder:text-ink-faint focus:outline-none"
              />
              {busy ? (
                <button
                  type="button"
                  onClick={() => stop()}
                  title="중지"
                  aria-label="중지"
                  className="shrink-0 h-8 px-3 rounded-md bg-surface-3 text-ink grid place-items-center transition-opacity"
                >
                  중지
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || !activeModel}
                  title="전송"
                  aria-label="전송"
                  className="shrink-0 w-8 h-8 rounded-md bg-accent text-page grid place-items-center disabled:opacity-30 transition-opacity"
                >
                  <Icon name="send" size={16} strokeWidth={2.2} />
                </button>
              )}
            </div>
            {messages.length > 0 && !busy && (
              <div className="flex gap-3 mt-2 px-1">
                <button
                  type="button"
                  onClick={() => void regenerate({ body: requestBody() })}
                  className="text-meta text-ink-muted hover:text-ink transition-colors"
                >
                  마지막 답 다시 생성
                </button>
                <button
                  type="button"
                  onClick={() => void handleNewConversation()}
                  className="text-meta text-ink-muted hover:text-ink transition-colors"
                >
                  새 대화
                </button>
              </div>
            )}
          </form>
        </section>
      </div>
    </main>
  )
}
