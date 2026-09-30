'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * ============================================================================
 *  Supabase 연결 — 대화의 저장과 로그인
 * ============================================================================
 *
 *  ★ 왜 API 라우트를 거치지 않고 브라우저가 Supabase에 직접 붙는가 ★
 *
 *  우리가 만든 테이블의 보호는 전부 RLS 정책이 합니다 (D-019).
 *  즉, **누가 볼 수 있는지는 서버가 아니라 Postgres가 정하고 있습니다.**
 *
 *  그래도 우리 서버를 거치게 하려면 service_role 키가 필요합니다.
 *  service_role은 RLS를 **완전히 우회**합니다 — 그 키가 우리 서버에 있으면
 *  애플리케이션 코드의 실수 하나가 곧 전 데이터 유출이 됩니다.
 *
 *  브라우저가 anon 키로 직접 붙으면 RLS가 끝까지 살아 있고,
 *  service_role 키는 우리 코드 어디에도 존재하지 않게 됩니다.
 *  보안 경계를 DB에 두는 것이 이 설계의 전부입니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  LLM 호출만 예외입니다.
 *  /api/chat, /api/english는 provider 키가 서버에만 있어야 하므로
 *  반드시 우리 서버를 거칩니다. 거기에는 여전히 x-app-token 검사가 있습니다 (D-019).
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * 환경 변수가 없으면 클라이언트를 아예 만들지 않습니다.
 *
 * createClient에 빈 문자열을 넘기면 "설정 오류"가 아니라
 * "인증 실패"처럼 보이는 에러가 나서, 원인을 알기 어렵습니다.
 * 여기서 명시적으로 막습니다.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(URL && ANON_KEY)
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Supabase가 설정되지 않았습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_ANON_KEY를 .env.local에 등록하세요.'
    )
  }
  // Next dev의 HMR가 모듈을 여러 번 평가해도 클라이언트가 하나만 살아야 합니다.
  // 안 만들면 세션이 끊깁니다 (로그인이 자꾸 풀립니다).
  if (!client) {
    client = createClient(URL as string, ANON_KEY as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  }
  return client
}

// ============================================================================
//  로그인 상태 (useSyncExternalStore용 외부 저장소)
// ============================================================================
//
//  supabase.auth.getSession()은 비동기입니다. useSyncExternalStore는 동기
//  스냅샷만 읽으므로, onAuthStateChange로 모듈 변수에 캐시해 두고 그걸 읽습니다.
//  AuthGate.tsx의 토큰 저장소와 같은 방식입니다.

export type AuthUser = { id: string; username: string; email: string | null }

export type AuthSnapshot = {
  /** Supabase가 저장된 세션을 읽어냈는가 — false면 아직 로그인 화면을 띄우면 안 됨 */
  ready: boolean
  user: AuthUser | null
}

const INITIAL: AuthSnapshot = { ready: false, user: null }
let snapshot: AuthSnapshot = INITIAL
const listeners = new Set<() => void>()
let listening = false

function emit() {
  listeners.forEach((l) => l())
}

type SessionUser = {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

function applySession(session: { user?: SessionUser | null } | null) {
  const u = session?.user
  const next: AuthSnapshot = {
    ready: true,
    user: u
      ? { id: u.id, username: usernameOf(u), email: u.email ?? null }
      : null,
  }
  // 객체가 매번 새로 만들어지면 useSyncExternalStore가 무한 렌더에 빠집니다.
  // 내용이 같으면 아예 교체하지 않습니다.
  if (next.ready === snapshot.ready && next.user?.id === snapshot.user?.id) return
  snapshot = next
  emit()
}

function startListening() {
  if (listening || !isSupabaseConfigured()) return
  listening = true
  try {
    const sb = getSupabase()
    // 저장된 세션을 먼저 읽고 — 이게 새고로침 후에도 로그인이 유지되는 경로입니다.
    void sb.auth.getSession().then(({ data }) => applySession(data.session ?? null))
    sb.auth.onAuthStateChange((_event, session) => applySession(session))
  } catch {
    applySession(null)
  }
}

export function subscribeAuth(onStoreChange: () => void) {
  startListening()
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function getAuthSnapshot(): AuthSnapshot {
  return snapshot
}

export function getServerAuthSnapshot(): AuthSnapshot {
  return INITIAL
}

// ============================================================================
//  로그인 / 로그아웃 — 아이디 + 비밀번호
// ============================================================================
//
//  ★ 왜 화면은 아이디인데 내부에서는 이메일을 쓰나 (D-021) ★
//
//  Supabase Auth에는 "아이디"라는 종류가 없습니다.
//  신원의 유일한 기준이 이메일입니다 — auth.users의 고유 키가 email이고,
//  비밀번호 찾기(링크 발송)도 전제하고 만들어진 시스템입니다.
//
//  그런데 우리에게 중요한 건 email이 아니라 **id(uuid)** 입니다.
//  RLS 정책은 auth.uid()로만 동작합니다 (supabase/schema.sql).
//  이메일이 정확히 무엇인지는 어떤 정책도 참조하지 않습니다.
//
//  그러므로 아이디를 내부용 이메일로 바꿔서 넘깁니다.
//  example.com은 RFC 2606이 문서용으로 예약해 둔 도메인이라
//  누구도 메일을 받을 수 없습니다 — 실제 주소가 새어 나올 길이 없습니다.
//
//  이 설계의 대가 하나: 비밀번호 찾기를 이메일로 할 수 없습니다.
//  잊어버리면 관리자(Supabase 대시보드에서 SQL)로 직접 지워야 합니다.
//  쓰이는 사람이 몇 명이고 직접 통제하므로 감수할 만합니다.

/** 아이디 뒤에 붙이는 예약 도메인. 메일 발송 대상이 될 수 없습니다. */
const INTERNAL_DOMAIN = '@example.com'

/** 정규화한 뒤 검사합니다 — 대소문자를 섞어도 같은 계정으로 취급합니다. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,19}$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function validateUsername(username: string): string | null {
  if (USERNAME_PATTERN.test(username)) return null
  return '아이디는 영문·숫자 3~20자이며, 첫 글자는 영문·숫자여야 합니다.'
}

/** Supabase에 넘길 내부용 이메일. 아이디가 다르면 주소도 다릅니다. */
function toInternalEmail(username: string): string {
  return username + INTERNAL_DOMAIN
}

/**
 * 화면에 보여줄 아이디를 세션에서 복원합니다.
 *
 * 가입할 때 user_metadata에 넣어 두지만, 그 값이 없더라도 이메일에서
 * 거꾸로 복원할 수 있어야 합니다 — 그렇지 않으면 로그인한 사람이
 * 자기 아이디를 화면에서 확인할 수 없습니다.
 */
function usernameOf(user: SessionUser): string {
  const meta = user.user_metadata?.username
  if (typeof meta === 'string' && meta) return meta
  const email = user.email
  if (email && email.endsWith(INTERNAL_DOMAIN)) {
    return email.slice(0, email.length - INTERNAL_DOMAIN.length)
  }
  // 예외 상황에서의 최후 수단. UUID 앞부분을 써서 빈칸이 안 보이게 합니다.
  return user.id.slice(0, 8)
}

export async function signIn(username: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: toInternalEmail(username),
    password,
  })
  if (error) throw new Error(mapAuthError(error.message))
}

export async function signUp(
  username: string,
  password: string
): Promise<{ needsEmailConfirm: boolean }> {
  const { data, error } = await getSupabase().auth.signUp({
    email: toInternalEmail(username),
    password,
    // 로그인 상태를 새로고침해도 아이디를 표시할 수 있도록 함께 남깁니다.
    options: { data: { username } },
  })
  if (error) throw new Error(mapAuthError(error.message))
  // Supabase 기본값은 이메일 확인을 요구합니다.
  // 꺼져 있으면(권장) identities가 채워지고 session이 바로 열립니다.
  return { needsEmailConfirm: data.user?.identities?.length === 0 }
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut()
  applySession(null)
}

/**
 * Supabase의 영문 에러를 한국어로.
 * 원문을 그대로 보여주면 "AuthApiError: Invalid login credentials"가 떠서
 * 무엇을 잘못했는지 오히려 안 보입니다.
 *
 * ★ 위장이 바뀌는 지점 ★ — 내부적으로는 이메일을 쓰기 때문에
 * Supabase는 "이미 등록된 이메일"이라는 말을 합니다. 사용자 관점의
 * 사실("이미 쓰고 있는 아이디")으로 번역해야 혼선이 없습니다.
 */
function mapAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return '아이디 또는 비밀번호가 올바르지 않습니다.'
  if (m.includes('already registered') || m.includes('already been registered')) {
    return '이미 사용 중인 아이디입니다. 로그인해 보세요.'
  }
  if (m.includes('email not confirmed')) {
    return 'Supabase 대시보드의 Authentication → Sign In Providers → Email에서 ' +
      '"Confirm email"을 꺼주세요. 켜져 있으면 인증 링크를 받을 주소가 없어 계정을 쓸 수 없습니다.'
  }
  if (m.includes('password should be')) return '비밀번호는 6자 이상이어야 합니다.'
  if (m.includes('rate limit') || m.includes('too many')) {
    return '시도가 너무 많습니다. 잠시 후에 다시 시도하세요.'
  }
  if (m.includes('fetch')) return '서버에 연결할 수 없습니다. 네트워크를 확인하세요.'
  return '로그인 중 문제가 발생했습니다.'
}

// ============================================================================
//  데이터 모델 — supabase/schema.sql과 1:1로 대응합니다
// ============================================================================

export type ConversationKind = 'chat' | 'english'

export type Conversation = {
  id: string
  user_id: string
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

/**
 * Supabase는 에러를 throw하지 않고 { error }로 돌려줍니다.
 * 예외로 바꾸지 않으면 호출부마다 error를 까먹기 쉽고,
 * 까먹으면 "빈 목록"처럼 보이는 버그가 됩니다.
 * 여기서 한 번에 throw합니다.
 */
function unwrap<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) {
    // RLS가 막았다면 이게 원인입니다. 다만 원인은 "권한 없음"이 아니라
    // "로그인 안 됨"일 때가 많아서, 그 가능성을 함께 남깁니다.
    if (result.error.message.includes('row-level security')) {
      throw new Error('접근이 거부되었습니다. 로그인 상태를 확인하세요.')
    }
    throw new Error(result.error.message)
  }
  return result.data
}

// ============================================================================
//  대화
// ============================================================================

export async function listConversations(kind: ConversationKind): Promise<Conversation[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('conversations')
    .select('*')
    .eq('kind', kind)
    // updated_at 정렬은 conversations_owner_idx 인덱스가 받습니다 (schema.sql)
    .order('updated_at', { ascending: false })
    .limit(100)
  return unwrap({ data, error }) ?? []
}

export async function createConversation(
  kind: ConversationKind,
  provider?: string,
  model?: string
): Promise<Conversation> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('conversations')
    .insert({ kind, provider: provider ?? null, model: model ?? null })
    .select('*')
    .single()
  return unwrap({ data, error })
}

/**
 * provider·model을 이어받습니다.
 * updated_at은 메시지 추가 트리거가 올리지만, 대화 자체의 설정 변경은
 * 애플리케이션이 알려야 합니다 (schema.sql 참고).
 */
export async function updateConversationSettings(
  id: string,
  patch: { provider?: string | null; model?: string | null; title?: string }
): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb
    .from('conversations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  unwrap({ data: null, error })
}

/** 대화를 지우면 messages는 on delete cascade로 함께 사라집니다 */
export async function deleteConversation(id: string): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('conversations').delete().eq('id', id)
  unwrap({ data: null, error })
}

// ============================================================================
//  메시지
// ============================================================================

export async function listMessages(conversationId: string): Promise<StoredMessage[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  return unwrap({ data, error }) ?? []
}

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  meta?: Record<string, unknown> | null
): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('messages').insert({
    conversation_id: conversationId,
    role,
    content,
    meta: meta ?? null,
  })
  unwrap({ data: null, error })
}
