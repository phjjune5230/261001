import { NextRequest, NextResponse } from 'next/server'
import {
  badRequest,
  hasValidToken,
  storageUnavailable,
  unauthorized,
  userFacingMessage,
} from '@/lib/api'
import { getServerSupabase, isDbConfigured } from '@/lib/db-server'

/**
 * ============================================================================
 *  대화 목록 · 생성
 * ============================================================================
 *
 *  v0.5.0 신규 (D-022). 이전에는 브라우저가 anon 키로 Supabase에 직접 붙었고,
 *  여기를 거치지 않았습니다. 로그인이 사라지면서 RLS가 통제할 수 없게 되어
 *  접근을 서버로 옮겼습니다. 배경은 lib/db-server.ts에 있습니다.
 *
 *  규칙은 /api/chat과 같습니다:
 *    1. 본문 파싱 *이전에* 토큰 검사
 *    2. provider(여기서는 Supabase) 원본 오류를 브라우저로 흘리지 않는 봉쇄
 *
 *  service_role은 RLS를 우회하므로, 여기서 주는 필터가 곧 유일한 필터입니다.
 *  "화면에서 안 골라 준 것"을 신뢰하지 마세요 — 라우트가 직접 조건을 적어야 합니다.
 */

const KINDS = ['chat', 'english'] as const
type Kind = (typeof KINDS)[number]

function readKind(value: unknown): Kind | null {
  return KINDS.includes(value as Kind) ? (value as Kind) : null
}

/** GET /api/conversations?kind=chat — 목록 (최신순, 100개) */
export async function GET(req: NextRequest) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  const kind = readKind(req.nextUrl.searchParams.get('kind'))
  if (!kind) return badRequest('kind가 필요합니다. (chat 또는 english)')

  try {
    const { data, error } = await getServerSupabase()
      .from('conversations')
      .select('*')
      .eq('kind', kind)
      .order('updated_at', { ascending: false })
      .limit(100)

    if (error) throw new Error(error.message)
    return NextResponse.json({ conversations: data ?? [] })
  } catch (err: unknown) {
    // 원본은 서버 콘솔에만. Supabase 에러에는 스키마·테이블 이름이 함께 오는 경우가
    // 많아, 그대로 내려가면 "설정 문제인지 버그인지"를 구분할 단서가 사라집니다.
    console.error('[conversations] 목록 조회 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}

/**
 * POST /api/conversations — 새 대화
 *
 * provider·model은 "이 대화를 만들 때 쓰던 설정"입니다. 목록에서 대화를
 * 이어 열 때 복원용으로 쓰이므로, 지금 선택된 걸로 함께 남깁니다.
 */
export async function POST(req: NextRequest) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  try {
    const body = await req.json()
    const kind = readKind(body?.kind)
    if (!kind) return badRequest('kind가 필요합니다. (chat 또는 english)')

    const { data, error } = await getServerSupabase()
      .from('conversations')
      .insert({
        kind,
        provider: typeof body.provider === 'string' ? body.provider : null,
        model: typeof body.model === 'string' ? body.model : null,
      })
      .select('*')
      .single()

    if (error) throw new Error(error.message)
    return NextResponse.json({ conversation: data }, { status: 201 })
  } catch (err: unknown) {
    console.error('[conversations] 생성 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}
