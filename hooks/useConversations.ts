'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  addMessage,
  createConversation,
  deleteConversation,
  listConversations,
  listMessages,
  updateConversationSettings,
  type Conversation,
  type ConversationKind,
  type StoredMessage,
} from '@/lib/db'

/**
 * ============================================================================
 *  대화 목록 + 저장 (서버 경유)
 * ============================================================================
 *
 *  왜 훅인가 — 채팅과 영어가 완전히 같은 동작을 합니다 (목록·생성·열기·삭제·저장).
 *  이걸 두 페이지에 각각 쓰면 한쪽만 고치는 사고가 반드시 납니다.
 *
 *  ★ enabled를 어떻게 정하나 (D-022) ★
 *  ─────────────────────────────────────────────────────────────────────────
 *  이전에는 isSupabaseConfigured() && auth.ready && auth.user !== null 이었습니다.
 *  v0.4.0에서는 그럴듯했습니다 — 클라이언트가 `NEXT_PUBLIC_`로
 *  "Supabase가 설정돼 있는가"와 "로그인했는가"를 알 수 있었으니까요.
 *
 *  D-022에서 로그인을 없애면서 두 문제가 생깁니다.
 *  하나는 Supabase 설정 여부를 클라이언트가 알 수 없어졌다는 것입니다.
 *  프로젝트 URL과 anon 키를 서버에만 둡니다. anon 키는 어차피 URL을 아는
 *  사람에게 이미 공개된 값이라 코드에서 없애도 보안은 같고 번들만 가벼워집니다.
 *  다른 하나는 저장 안 됨을 미리 알 수 없다는 것입니다.
 *  배포에 service_role이 없으면 503이 나는 것은 실제로 요청했을 때뿐입니다.
 *
 *  그래서 판정 기준을 바꿉니다: enabled는 "첫 목록 조회가 성공했는가"입니다.
 *  흔들려 보이지만 이게 정확한 답입니다. env가 설정돼 있는데 RLS 정책이
 *  남아 있으면 403이, 테이블이 없으면 404가, service_role이 없으면 503이
 *  납니다. 전부 "이 배포에서는 저장이 안 된다"로 수렴합니다.
 *  반대로 정상 배포에서는 첫 조회가 성공하므로 목록이 보입니다.
 *
 *  처음부터 false로 시작하지 않는 이유: 첫 페인트에 "저장 꺼짐"이 잠깐
 *  보인다가 사라지는 깜빡임이 생깁니다. 이 앱은 대화 기능 하나 때문에
 *  전체를 막지 않습니다 (D-018). 저장이 안 된다는 사실만 고지할 뿐입니다.
 *
 *  저장을 안 해도 되는 건 알람이나 낙관적 갱신 같은 것뿐입니다.
 *  대화 내용은 화면 상태가 이미 갖고 있으므로, 저장 실패를 굳이 전파하지
 *  않으면 사용자는 chat이 동작하는지 판단할 수 없게 됩니다.
 *  그래서 saveTurn은 성공/실패를 boolean으로 돌려줍니다.
 */

export type ConversationState = {
  /** 저장이 되는 상태인가 — 첫 목록 조회가 성공했으면 true */
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
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)

  // 첫 목록 조회가 성공했는가 — 헤더 주석의 D-022 참조.
  // 처음부터 false가 아니라 true인 이유도 그 주석에 있습니다.
  const [storageOk, setStorageOk] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setConversations(await listConversations(kind))
    } catch {
      // 목록 못 불러와도 채팅은 계속된다. 목록 칸만 비어 있게 둔다.
      setConversations([])
    }
  }, [kind])

  // 종류가 바뀌면 목록을 다시 읽습니다.
  //
  // 여기가 storageOk를 정하는 유일한 자리입니다. 헤더에서 적었듯
  // enabled를 여기서 미리 false로 내려놓지 않습니다.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadingList(true)
      try {
        const list = await listConversations(kind)
        if (cancelled) return
        setConversations(list)
        setStorageOk(true)
      } catch {
        if (cancelled) return
        setConversations([])
        setStorageOk(false)
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [kind])

  const newConversation = useCallback(async () => {
    setActiveId(null)
    try {
      const created = await createConversation(kind)
      setConversations((prev) => [created, ...prev])
      setActiveId(created.id)
    } catch {
      // 못 만들어도 새 대화는 쓸 수 있다. 다음 저장 때 다시 시도됩니다.
    }
  }, [kind])

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

  const removeConversation = useCallback(async (id: string) => {
    try {
      await deleteConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      setActiveId((cur) => (cur === id ? null : cur))
    } catch {
      // 삭제는 조용히 실패합니다. 목록이 어긋난 상태를 만드는 게 더 나쁩니다.
    }
  }, [])

  const rememberSettings = useCallback(
    async (provider: string, model: string) => {
      if (!activeId) return
      try {
        await updateConversationSettings(activeId, { provider, model })
        // 목록 갱신은 다음 진입 때 — 매번 하면 타이핑할 때마다 요청이 나갑니다.
      } catch {
        // provider/model은 부가 정보입니다. 실패해도 대화는 이어집니다.
      }
    },
    [activeId]
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
    [activeId, kind, persist, refresh]
  )

  return {
    enabled: storageOk,
    // 저장이 안 되는 상태면 화면에 내보내는 목록을 비웁니다.
    // 목록 UI 자체가 꺼짐 안내로 바뀌므로 (ConversationList) 목록이
    // 비어 있는 것과 저장이 안 되는 것이 화면에서 구분됩니다.
    conversations: storageOk ? conversations : [],
    activeId: storageOk ? activeId : null,
    loadingList: storageOk ? loadingList : false,
    newConversation,
    openConversation,
    removeConversation,
    rememberSettings,
    saveTurn,
  }
}
