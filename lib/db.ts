'use client'

import { clearToken, getToken } from '@/lib/auth-client'

/**
 * ============================================================================
 *  대화 저장 — 우리 API를 통해서만
 * ============================================================================
 *
 *  ★ 왜 브라우저가 더 이상 Supabase에 직접 붙지 않는가 ★
 *
 *  v0.4.0까지는 여기서 anon 키로 Supabase에 직접 붙었습니다.
 *  "보안 경계를 서버가 아니라 Postgres(RLS)에 두자"는 판단이었습니다.
 *
 *  그런데 이 앱은 **한 사람이 씁니다** (사용자 결정). 로그인이 필요해졌을 때
 *  그 논리가 통하지 않게 됐습니다. RLS 정책은 전부 `auth.uid()`를 보는데,
 *  계정이 없으니 auth.uid()는 늘 null이고 **아무 정책도 통과하지 못합니다.**
 *  RLS가 "누가 이 대화를 볼 수 있나"를 정하는 장치에서
 *  "아무도 못 본다"를 정하는 장치로 바뀐 것뿐이었습니다.
 *
 *  policies를 걷어내서 "아무도 못 보게" 하면, 그 다음 질문이 남습니다.
 *  "누가 저장을 하나?" — 답은 서버입니다.
 *
 *    브라우저 ──x-app-token──▶ 우리 서버 /api/conversations ──service_role──▶ DB
 *
 *  옮긴 결과:
 *    - anon은 아무것도 못 읽습니다. RLS는 켜져 있고 정책이 0개입니다.
 *    - 접근 문이 하나입니다. LLM 호출과 대화 저장이 같은 검사를 통과합니다.
 *    - service_role은 서버에만 있습니다. `NEXT_PUBLIC_` 접두사가 없으므로
 *      Next.js가 클라이언트 번들에 인라인하지 않습니다.
 *
 *  그래서 이 파일에는 Supabase SDK가 더 이상 없습니다.
 *  남아 있는 것은 fetch 하나와 타입 몇 개입니다.
 *  서버 쪽 구현은 lib/db-server.ts, 라우트는 app/api/conversations/입니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  환경 변수에 대해 하나 분명히 해 둡니다
 *  ─────────────────────────────────────────────────────────────────────────
 *  클라이언트는 이제 **Supabase URL도 anon 키도 읽지 않습니다.**
 *  `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 .env.local에서 지워도 앱이 돌아갑니다.
 *  anon 키는 어차피 URL을 아는 사람에게 공개된 값이므로, 코드에 안 둬도
 *  보안이 같고 번들이 한 가벼워집니다.
 */

/**
 * /api 호출 + 공통 처리.
 *
 * fetch를 함수마다 직접 쓰면 매번 (1) 토큰 헤더, (2) 401 처리,
 * (3) 서버가 준 한국어 메시지 꺼내기를 반복하게 됩니다. 그 셋 중 하나라도
 * 까먹으면 "저장이 조용히 안 되는" 버그가 됩니다.
 *
 * 401은 잠금이 풀렸다는 뜻입니다. 이때 토큰을 지워야 AuthGate가
 * 잠금 화면으로 되돌아갑니다 — 그래야 저절로 복구됩니다.
 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-app-token': token } : {}),
      ...init?.headers,
    },
  })

  if (res.status === 401) {
    // 잠금이 풀렸다는 뜻입니다. 토큰을 지우면 AuthGate가 잠금 화면으로
    // 되돌아가므로, 사용자가 화면을 새로고침하지 않아도 스스로 복구됩니다.
    clearToken()
    throw new Error('잠금 해제가 필요합니다.')
  }

  if (!res.ok) {
    // 서버가 준 message가 있으면 그것이 사용자용 문구입니다 (lib/api.ts).
    // 없는 경우는 5xx이고, 원본은 서버 콘솔에만 남아 있습니다.
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || '요청에 실패했습니다.')
  }

  if (res.status === 204) return null as T
  return (await res.json()) as T
}

// ============================================================================
//  데이터 모델 — supabase/schema.sql과 1:1로 대응합니다
// ============================================================================

export type ConversationKind = 'chat' | 'english'

export type Conversation = {
  id: string
  kind: ConversationKind
  title: string
  provider: string | null
  model: string | null
  created_at: string
  updated_at: string
}

export type StoredMessage = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  /** 영어 학습은 LessonTurn(phase + steps)을 여기에 통째로 넣습니다 */
  meta: Record<string, unknown> | null
  created_at: string
}

// ============================================================================
//  대화
// ============================================================================

/**
 * 목록 조회 — 최신순 100개.
 *
 * 라우트가 {" conversations": [...] }로 감싸서 줍니다.
 * 감싼 이유는 성공/실패를 한 필드로 구분하기 위해서입니다
 * (Supabase SDK는 rows가 비어 있는 것과 실패를 { error }로 나누는데,
 * 지금은 직접 판단할 수 없어 단순히 "배열이 있나"로 봅니다).
 */
export async function listConversations(kind: ConversationKind): Promise<Conversation[]> {
  const data = await api<{ conversations: Conversation[] }>(
    `/api/conversations?kind=${encodeURIComponent(kind)}`
  )
  return data.conversations ?? []
}

/**
 * 새 대화를 만듭니다.
 *
 * 제목은 여기서 정하지 않습니다 — 첫 메시지를 넣을 때 DB 트리거가
 * 앞 30자를 잘라 붙입니다 (supabase/single-user.sql).
 * 미리 제목을 정해두면 트리거가 "새 대화인지"를 구분할 수 없어
 * 목록에 빈 제목이 그대로 남습니다.
 */
export async function createConversation(
  kind: ConversationKind,
  provider?: string,
  model?: string
): Promise<Conversation> {
  const data = await api<{ conversation: Conversation }>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({
      kind,
      provider: provider ?? null,
      model: model ?? null,
    }),
  })
  return data.conversation
}

/**
 * provider·model을 이어받습니다.
 *
 * 라우트가 updated_at도 함께 올립니다. 대화 설정만 바뀌면 메시지 트리거가
 * 울리지 않는데, 목록 정렬이 updated_at에 의존하므로 여기서 밀어줘야
 * 방금 쓴 대화가 목록 맨 위로 올라옵니다.
 */
export async function updateConversationSettings(
  id: string,
  patch: { provider?: string | null; model?: string | null; title?: string }
): Promise<void> {
  await api(`/api/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** 대화를 지우면 messages는 on delete cascade로 함께 사라집니다 */
export async function deleteConversation(id: string): Promise<void> {
  await api(`/api/conversations/${id}`, { method: 'DELETE' })
}

// ============================================================================
//  메시지
// ============================================================================

/** 한 대화의 메시지를 시간순으로 */
export async function listMessages(conversationId: string): Promise<StoredMessage[]> {
  const data = await api<{ messages: StoredMessage[] }>(
    `/api/conversations/${conversationId}/messages`
  )
  return data.messages ?? []
}

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  meta?: Record<string, unknown> | null
): Promise<void> {
  await api(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content, meta: meta ?? null }),
  })
}

// ============================================================================
//  영어 학습 기록
// ============================================================================
//
//  ★ messages.meta에 섞지 않습니다 ★
//  meta는 영어 턴 복원 전용입니다 (예문·번역). 누적 학습 기록을 거기 넣으면
//  원본과 파생이 한 덩어리가 되고 나중에 하나를 고칠 때 다른 하나가 깨집니다
//  (docs/RULE.md §2). 그래서 별도 테이블과 별도 라우트를 씁니다.

export type EnglishChunk = {
  id: string
  conversation_id: string
  session_id: string | null
  /** 구 자체. 단어가 아니라 구 단위로 남깁니다 */
  phrase: string
  meaning: string
  scenario: string
  seen_count: number
  created_at: string
  last_seen_at: string
}

export type EnglishErrorRecord = {
  id: string
  conversation_id: string
  session_id: string | null
  turn_index: number
  original: string
  corrected: string
  reason: string
  /** lib/lesson.ts의 ErrorCategory */
  category: string
  created_at: string
}

export type EnglishRecords = {
  chunks: EnglishChunk[]
  errors: EnglishErrorRecord[]
}

/**
 * 학습 기록 조회.
 *
 * ★ 실패를 삼키고 빈 값을 돌려줍니다 ★
 * SQL(add-english-learning.sql)을 아직 실행하지 않은 배포에서도 대화는 계속
 * 되어야 합니다. lib/compaction.ts가 하는 것과 같습니다 —
 * "기록이 꺼진 상태"는 정상 상태이지 500을 낼 일이 아닙니다.
 *
 * 대화 저장이 아예 없는 배포(503)도 여기서 삼켜집니다. 목록 UI가 "저장 꺼짐"을
 * 이미 표시하고 있으므로 여기서 또 경고를 만들지 않습니다.
 */
export async function listEnglishRecords(
  conversationId?: string
): Promise<EnglishRecords> {
  const empty: EnglishRecords = { chunks: [], errors: [] }
  try {
    const query = conversationId
      ? `?conversationId=${encodeURIComponent(conversationId)}`
      : ''
    const data = await api<EnglishRecords>(`/api/english/records${query}`)
    return { chunks: data.chunks ?? [], errors: data.errors ?? [] }
  } catch {
    return empty
  }
}

/**
 * 세션 하나를 저장합니다 (마무리 버튼을 누를 때 한 번).
 *
 * 성공/실패를 boolean으로 돌려줍니다 — useConversations의 saveTurn과 같은 방식입니다.
 * 말미 요약은 화면에 이미 떠 있으므로, 저장이 조용히 안 돼도 사용자는 대화를
 * 계속 볼 수 있습니다. 그래도 "이 세션은 기록되지 않았습니다"를 알려야 합니다.
 */
export async function saveEnglishRecords(payload: {
  conversationId: string
  scenario: string
  summary: string
  errors: { original: string; corrected: string; reason: string; category: string; turnIndex: number }[]
  expressions: { phrase: string; meaning: string }[]
}): Promise<boolean> {
  try {
    await api('/api/english/records', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return true
  } catch {
    return false
  }
}
