import { NextRequest, NextResponse } from 'next/server'
import {
  badRequest,
  hasValidToken,
  isUuid,
  storageUnavailable,
  unauthorized,
  userFacingMessage,
} from '@/lib/api'
import { getServerSupabase, isDbConfigured } from '@/lib/db-server'

/**
 * ============================================================================
 *  메시지 — 대화 하나에 속한 턴들
 * ============================================================================
 *
 *  v0.5.0 신규 (D-022). 배경은 app/api/conversations/route.ts에 있습니다.
 *
 *  이 라우트가 특히 조심해야 할 지점은 POST입니다.
 *  외래 키(conversation_id)가 걸려 있으므로 없는 대화에 넣으면 DB가 거절하지만,
 *  그 오류는 형식 검사보다 훨씬 뒤에야 나옵니다. 그래서 먼저 id를 확인합니다.
 */

type Ctx = { params: Promise<{ id: string }> }

const ROLES = ['user', 'assistant'] as const
type Role = (typeof ROLES)[number]

/** GET /api/conversations/:id/messages — 시간순 */
export async function GET(req: NextRequest, ctx: Ctx) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  const { id } = await ctx.params
  if (!isUuid(id)) return badRequest('대화 ID 형식이 올바르지 않습니다.')

  try {
    const { data, error } = await getServerSupabase()
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      // messages_conversation_idx (conversation_id, created_at)가 받습니다
      .order('created_at', { ascending: true })

    if (error) throw new Error(error.message)
    return NextResponse.json({ messages: data ?? [] })
  } catch (err: unknown) {
    console.error('[messages] 조회 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}

/**
 * POST /api/conversations/:id/messages — 턴 하나 저장
 *
 * 턴은 사용자 1 + AI 1이 한 쌍입니다 (useConversations.persist).
 * 라우트는 한 번에 하나만 받습니다. 두 개를 한 번에 받는 설계는
 * "앞은 들어갔고 뒤는 안 들어갔을 때"를 복구할 방법이 없어서입니다 —
 * 지금처럼 첫 insert가 실패하면 아예 안 넣는 쪽이 낫습니다.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  const { id } = await ctx.params
  if (!isUuid(id)) return badRequest('대화 ID 형식이 올바르지 않습니다.')

  try {
    const body = await req.json()

    if (!ROLES.includes(body?.role)) {
      return badRequest('role이 필요합니다. (user 또는 assistant)')
    }
    if (typeof body.content !== 'string' || body.content === '') {
      return badRequest('content가 필요합니다.')
    }

    // meta는 영어 학습 전용입니다 (D-016). 예문·연습 단계(phase, steps)를
    // 문장 텍스트로 펴면 예문과 번역이 뒤섞여 재구성이 불가능해지므로
    // 통째로 jsonb에 넣습니다. 채팅은 meta 없이 씁니다.
    const meta =
      body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
        ? body.meta
        : null

    const { data, error } = await getServerSupabase()
      .from('messages')
      .insert({
        conversation_id: id,
        role: body.role as Role,
        content: body.content,
        meta,
      })
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json({ message: data }, { status: 201 })
  } catch (err: unknown) {
    console.error('[messages] 저장 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}
