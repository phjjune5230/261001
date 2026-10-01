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
 *  대화 하나 — 설정 변경 · 삭제
 * ============================================================================
 *
 *  v0.5.0 신규 (D-022). 배경은 app/api/conversations/route.ts에 있습니다.
 *
 *  ★ Next 16에서 params는 Promise입니다 ★
 *  `context.params`를 바로 분해하면 undefined가 됩니다. await 해야 합니다.
 */

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  const { id } = await ctx.params
  if (!isUuid(id)) return badRequest('대화 ID 형식이 올바르지 않습니다.')

  try {
    const body = await req.json()

    // 보낼 필드는 클라이언트가 정합니다. 없는 필드는 건드리지 않으려면
    // patch에 없는 키를 아예 넣지 않아야 합니다 — 값을 넣어 버리면
    // provider/model이 null로 지워집니다.
    const patch: Record<string, unknown> = {}
    if ('provider' in body) patch.provider = body.provider ?? null
    if ('model' in body) patch.model = body.model ?? null
    if (typeof body.title === 'string') patch.title = body.title

    if (Object.keys(patch).length === 0) {
      return badRequest('바꿀 값이 없습니다.')
    }

    // updated_at은 메시지 추가 트리거가 올리지만, 대화 설정만 바꾸는 경우에는
    // 아무도 안 올립니다. 목록 정렬이 updated_at에 의존하므로 여기서 직접 올립니다.
    patch.updated_at = new Date().toISOString()

    const { error } = await getServerSupabase()
      .from('conversations')
      .update(patch)
      .eq('id', id)

    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('[conversations] 수정 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}

/** 대화를 지우면 messages는 on delete cascade로 함께 사라집니다 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  const { id } = await ctx.params
  if (!isUuid(id)) return badRequest('대화 ID 형식이 올바르지 않습니다.')

  try {
    const { error } = await getServerSupabase().from('conversations').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('[conversations] 삭제 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}
