'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  addMessage,
  createConversation,
  deleteConversation,
  getAuthSnapshot,
  getServerAuthSnapshot,
  isSupabaseConfigured,
  listConversations,
  listMessages,
  subscribeAuth,
  updateConversationSettings,
  type Conversation,
  type ConversationKind,
  type StoredMessage,
} from '@/lib/db'

/**
 * ============================================================================
 *  대화 목록 + 저장 (Supabase)
 * ============================================================================
 *
 *  왜 훅인가 — 채팅과 영어가 완전히 같은 동작을 합니다:
 *    목록 조회, 새 대화, 열기, 삭제, 메시지 저장.
 *  이걸 두 페이지에 각각 쓰면 한쪽만 고치는 사고가 반드시 납니다.
 *
 *  ★ Supabase가 없거나 로그인하지 않은 상태에서는 아무 것도 하지 않습니다. ★
 *  enabled가 false면 목록은 비어 있고 저장은 조용히 무시됩니다.
 *  이게 의도입니다 — "저장이 안 된다"는 사실만으로는 채팅을 쓸 수 없어야 하므로
 *  전체 기능을 막으면 안 됩니다. 화면에 표시만 해줍니다 (D-018).
 *
 *  저장을 안 해도 되는 건 알람이나 낙관적 갱신 같은 것뿐입니다.
 *  대화 내용은 화면 상태가 이미 갖고 있으므로, 저장 실패를 굳이 전파하지
 *  않으면 사용자는 chat이 동작하는지 판단할 수 없게 됩니다.
 *  그래서 saveTurn은 성공/실패를 boolean으로 돌려줍니다.
 */

export type ConversationState = {
  /** 저장이 가능한 상태인가 — 미설정이거나 로그인 안 했으면 false */
  enabled: boolean
  conversations: Conversation[]
  activeId: string | null
  loadingList: boolean
  newConversation: () => Promise<void>
  openConversation: (id: string | null) => Promise<StoredMessage[]>
  removeConversation: (id: string) => Promise<void>
  rememberSettings: (provider: string, model: string) => Promise<void>
  /**
   * 사용자+AI 한 쌍을 저장. 첫 저장이면 대화를 자동으로 만듭니다.
   *
   * meta는 영어 학습용입니다. 예문·연습 단계(phase, steps)는 문장 텍스트로
   * 펴면 예문과 번역이 뒤섞여 재구성이 불가능해집니다. 그래서 통째로 meta에 넣습니다
   * (D-016). 채팅은 meta 없이 씁니다.
   */
  saveTurn: (
    userContent: string,
    assistantContent: string,
    meta?: Record<string, unknown> | null
  ) => Promise<boolean>
}

export function useConversations(kind: ConversationKind): ConversationState {
  const auth = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getServerAuthSnapshot)

  // 로그인 세션 로딩이 끝나기 전에 "로그인 안 함"으로 판단하면
  // 저장 안 되는 화면이 잠깐 보인다 (또는 그 반대로 튄다).
  const enabled = isSupabaseConfigured() && auth.ready && auth.user !== null

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setConversations(await listConversations(kind))
    } catch {
      // 목록 못 불러와도 채팅은 계속된다. 목록 칸만 비어 있게 둔다.
      setConversations([])
    }
  }, [kind])

  // enabled가 바뀌거나 종류가 바뀌면 목록을 다시 읽습니다.
  //
  // 로그아웃해서 enabled가 false가 될 때는 setState를 하지 않습니다.
  // 비활성 상태에서 목록을 비우는 것은 **파생값**입니다 — 비워두는 게
  // 아니라 처음부터 안 보이게 하는 것이 맞습니다 (below의 derived).
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      setLoadingList(true)
      try {
        const list = await listConversations(kind)
        if (!cancelled) setConversations(list)
      } catch {
        if (!cancelled) setConversations([])
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, kind])

  const newConversation = useCallback(async () => {
    setActiveId(null)
    if (!enabled) return
    try {
      const created = await createConversation(kind)
      setConversations((prev) => [created, ...prev])
      setActiveId(created.id)
    } catch {
      // 못 만들어도 새 대화는 쓸 수 있다. 다음 저장 때 다시 시도됩니다.
    }
  }, [enabled, kind])

  const openConversation = useCallback(
    async (id: string | null): Promise<StoredMessage[]> => {
      setActiveId(id)
      if (!id) return []
      try {
        return await listMessages(id)
      } catch {
        return []
      }
    },
    []
  )

  const removeConversation = useCallback(
    async (id: string) => {
      if (!enabled) return
      try {
        await deleteConversation(id)
        setConversations((prev) => prev.filter((c) => c.id !== id))
        setActiveId((cur) => (cur === id ? null : cur))
      } catch {
        // 삭제는 조용히 실패합니다. 목록이 어긋난 상태를 만드는 게 더 나쁩니다.
      }
    },
    [enabled]
  )

  const rememberSettings = useCallback(
    async (provider: string, model: string) => {
      if (!enabled || !activeId) return
      try {
        await updateConversationSettings(activeId, { provider, model })
        // 목록 갱신은 다음 진입 때 — 매번 하면 타이핑할 때마다 요청이 나갑니다.
      } catch {
        // provider/model은 부가 정보입니다. 실패해도 대화는 이어집니다.
      }
    },
    [enabled, activeId]
  )

  /**
   * 저장을 실제로 수행합니다. 헤더가 현재 대화 ID를 상태로만 들면
   * setState는 비동기라 그 시점에 아직 반영이 안 되어 있습니다.
   * 그래서 현재 ID를 인자로 받아 씁니다.
   */
  const persist = useCallback(
    async (
      conversationId: string,
      userContent: string,
      assistantContent: string,
      meta?: Record<string, unknown> | null
    ) => {
      try {
        await addMessage(conversationId, 'user', userContent)
        await addMessage(conversationId, 'assistant', assistantContent, meta ?? null)
        return true
      } catch {
        return false
      }
    },
    []
  )

  const saveTurn = useCallback(
    async (userContent: string, assistantContent: string, meta?: Record<string, unknown> | null) => {
      if (!enabled) return false

      // 첫 저장이면 대화를 먼저 만듭니다 (제목은 DB 트리거가 첫 메시지로 채웁니다).
      let id = activeId
      if (!id) {
        try {
          const created = await createConversation(kind)
          setConversations((prev) => [created, ...prev])
          setActiveId(created.id)
          id = created.id
        } catch {
          return false
        }
      }

      const ok = await persist(id, userContent, assistantContent, meta)
      if (ok) await refresh()
      return ok
    },
    [enabled, activeId, kind, persist, refresh]
  )

  return {
    enabled,
    // enabled가 false면 화면에 내보내는 목록을 비웁니다.
    // 로그아웃했을 때 이전 계정의 목록이 순간이라도 보이는 것을 막습니다.
    conversations: enabled ? conversations : [],
    activeId: enabled ? activeId : null,
    loadingList: enabled ? loadingList : false,
    newConversation,
    openConversation,
    removeConversation,
    rememberSettings,
    saveTurn,
  }
}
