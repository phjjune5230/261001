/**
 * ============================================================================
 *  모델 레지스트리 API
 * ============================================================================
 *
 *  v0.13.0 신규. 모델 등록·수정을 앱 안에서 하려고 생겼습니다.
 *  이전에는 `lib/models.ts`를 고치고 배포해야 했습니다 — 그래서 아무것도
 *  못 넣고 있었습니다. 강한 무료 모델을 찾았을 때 쓸 수 있게 하는 것이 목적입니다.
 *
 *  규칙은 다른 라우트와 같습니다:
 *    1. 본문 파싱 *이전에* 토큰 검사
 *    2. 원본 오류를 브라우저로 흘리지 않기
 *
 *  ★ service_role은 RLS를 완전히 우회합니다 ★
 *  여기서 주는 필터가 곧 유일한 필터입니다 (lib/db-server.ts 참고).
 *  그래서 provider·model_id는 **화면에서 왔든 말든 값을 검사합니다.**
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  badRequest,
  hasValidToken,
  isKnownProvider,
  storageUnavailable,
  unauthorized,
  userFacingMessage,
} from '@/lib/api'
import { getServerSupabase, isDbConfigured } from '@/lib/db-server'
import { getModelRegistry, invalidateRegistry } from '@/lib/model-registry'
import { ALL_PROVIDERS } from '@/lib/llm'
import type { Provider } from '@/lib/llm'

/**
 * POST·PUT가 받는 한 줄.
 *
 * ★ 브라우저를 믿지 않습니다 ★
 * 모든 필드를 여기서 다시 검사합니다. 값을 그대로 넣으면 tpm에 문자열이
 * 들어갈 수도 있고, maxTokens가 0인 모델이 생길 수도 있습니다.
 * 잘못된 값은 예산 계산에서 조용히 어긋나기 때문입니다.
 */
type IncomingModel = {
  provider: Provider
  modelId: string
  name: string
  maxTokens: number
  tpm: number | null
  rpm: number | null
  sortOrder: number
}

/** 빈 문자열이면 "모른다"로 바꿉니다. 0이나 음수는 숫자가 아닙니다. */
function readNumber(value: unknown): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 'invalid'
  return Math.floor(n)
}

function readIncoming(body: unknown): IncomingModel | string {
  if (!body || typeof body !== 'object') return '본문이 비어 있습니다.'
  const b = body as Record<string, unknown>

  const provider = b.provider
  if (!isKnownProvider(provider)) {
    return `provider가 필요합니다. (${ALL_PROVIDERS.join(', ')})`
  }

  const modelId = typeof b.modelId === 'string' ? b.modelId.trim() : ''
  if (!modelId) return 'modelId가 필요합니다. provider에 넘길 정확한 ID를 적으세요.'
  if (modelId.length > 200) return 'modelId가 너무 깁니다.'

  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : modelId
  if (name.length > 120) return '표시 이름이 너무 깁니다.'

  const maxTokens = readNumber(b.maxTokens)
  if (maxTokens === 'invalid' || maxTokens === null) {
    return 'maxTokens가 필요합니다. 이 모델에 줄 출력 상한을 숫자로 적으세요.'
  }

  const tpm = readNumber(b.tpm)
  if (tpm === 'invalid') return 'tpm은 양의 숫자이거나 비워 두세요. 모르면 비워 두세요.'

  const rpm = readNumber(b.rpm)
  if (rpm === 'invalid') return 'rpm은 양의 숫자이거나 비워 두세요. 모르면 비워 두세요.'

  const sortOrder = readNumber(b.sortOrder) ?? 100
  const order = typeof sortOrder === 'number' ? sortOrder : 100

  return { provider, modelId, name, maxTokens, tpm, rpm, sortOrder: order }
}

/** GET /api/models — 목록 */
export async function GET(req: NextRequest) {
  if (!hasValidToken(req)) return unauthorized()

  try {
    const registry = await getModelRegistry()
    return NextResponse.json(registry)
  } catch (err: unknown) {
    console.error('[models] 목록 조회 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}

/**
 * POST /api/models — 등록 또는 수정
 *
 * 같은 (provider, modelId)가 있으면 **수정**입니다. 화면에서 고친 한도를
 * 다시 넣을 때 별도의 수정 경로를 따로 만들지 않기 위함입니다.
 */
export async function POST(req: NextRequest) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  let incoming: IncomingModel | string
  try {
    incoming = readIncoming(await req.json())
  } catch {
    return badRequest('본문을 읽을 수 없습니다.')
  }
  if (typeof incoming === 'string') return badRequest(incoming)

  try {
    const row = {
      provider: incoming.provider,
      model_id: incoming.modelId,
      name: incoming.name,
      max_tokens: incoming.maxTokens,
      tpm: incoming.tpm,
      rpm: incoming.rpm,
      sort_order: incoming.sortOrder,
      updated_at: new Date().toISOString(),
    }

    // ★ supabase-js는 upsert를 한 번에 안 줍니다 ★
    // 그래서 고칠지 안 고칠지 먼저 보고 분기합니다.
    const { data: existing, error: findErr } = await getServerSupabase()
      .from('models')
      .select('model_id')
      .eq('provider', incoming.provider)
      .eq('model_id', incoming.modelId)
      .maybeSingle()

    if (findErr) throw new Error(findErr.message)

    let savedId: string
    if (existing) {
      const { error } = await getServerSupabase()
        .from('models')
        .update(row)
        .eq('provider', incoming.provider)
        .eq('model_id', incoming.modelId)
      if (error) throw new Error(error.message)
      savedId = incoming.modelId
    } else {
      const { error } = await getServerSupabase().from('models').insert(row)
      if (error) throw new Error(error.message)
      savedId = incoming.modelId
    }

    // 화면이 다음 목록을 곧바로 맞게 그려야 하므로 캐시를 즉시 지웁니다.
    invalidateRegistry()
    const registry = await getModelRegistry()
    return NextResponse.json({ ok: true, modelId: savedId, ...registry })
  } catch (err: unknown) {
    console.error('[models] 저장 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}

/**
 * DELETE /api/models?provider=groq&modelId=openai%2Fgpt-oss-120b
 *
 * provider와 modelId가 **둘 다** 있어야 합니다. 하나만 받고 지우면
 * 그 provider의 다른 모델까지 같이 날아갈 수 있습니다.
 */
export async function DELETE(req: NextRequest) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  const provider = req.nextUrl.searchParams.get('provider')
  const modelId = req.nextUrl.searchParams.get('modelId')

  if (!isKnownProvider(provider)) {
    return badRequest(`provider가 필요합니다. (${ALL_PROVIDERS.join(', ')})`)
  }
  if (!modelId || !modelId.trim()) {
    return badRequest('modelId가 필요합니다. 어느 모델을 지울지 적으세요.')
  }

  try {
    const { error } = await getServerSupabase()
      .from('models')
      .delete()
      .eq('provider', provider)
      .eq('model_id', modelId.trim())

    if (error) throw new Error(error.message)

    invalidateRegistry()
    const registry = await getModelRegistry()
    return NextResponse.json({ ok: true, ...registry })
  } catch (err: unknown) {
    console.error('[models] 삭제 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}