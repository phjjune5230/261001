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
import { ERROR_CATEGORIES, type ErrorCategory } from '@/lib/lesson'

/**
 * ============================================================================
 *  영어 학습 기록 — 세션 / 오류 / 배운 표현
 * ============================================================================
 *
 *  v0.8.0 신규. 세 테이블은 supabase/add-english-learning.sql이 만듭니다.
 *
 *  ★ 이 라우트를 "있으면 좋겠다"로 만들면 안 됩니다 ★
 *  이 기능의 존재 이유는 대화가 쌓이는 데 있지 않습니다. "내가 틀린 것"이
 *  남고, 다음 세션에서 그 표현이 먼저 다시 나오는 것입니다 (docs/10-english-guide.md §5).
 *  1~3단계(모델·프롬프트·화면)까지만 하고 여기 없으면 그건 그냥 채팅입니다.
 *
 *  규칙은 다른 라우트와 같습니다:
 *    1. 본문 파싱 *이전에* 토큰 검사
 *    2. provider 원본 오류를 브라우저로 흘리지 않는 봉쇄
 *
 *  service_role은 RLS를 우회하므로, 여기서 주는 필터가 곧 유일한 필터입니다.
 *  "화면에서 안 골라 준 것"을 신뢰하지 마세요.
 */

const MAX_ERRORS = 50
const MAX_EXPRESSIONS = 50
const MAX_TEXT = 2000

/** insert로 넘길 행. 타입을 박아두면 화면 입력 때문에 모양이 틀려도 여기서 드러납니다. */
type EnglishErrorRow = {
  conversation_id: string
  session_id: string
  turn_index: number
  original: string
  corrected: string
  reason: string
  category: ErrorCategory
}

type EnglishChunkRow = {
  conversation_id: string
  session_id: string
  phrase: string
  phrase_key: string
  meaning: string
  scenario: string
  seen_count: number
  last_seen_at: string
}

/** 구 표현의 중복 판정 키. DB의 phrase_key 규칙과 같습니다. */
function phraseKeyOf(phrase: string): string {
  return phrase.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 화면이 준 분류를 신뢰하지 않습니다.
 * 목록에 없는 값이면 'other'로 떨어뜨립니다 — DB의 check constraint를
 * 통과시키기 위함이 아니라, 조용히 insert가 실패해서 기록 전체가 사라지는 것을
 * 막기 위함입니다. 한 건의 오류를 버리면 그 세션의 기록이 통째로 날아갑니다.
 */
function readCategory(value: unknown): ErrorCategory {
  return ERROR_CATEGORIES.includes(value as ErrorCategory)
    ? (value as ErrorCategory)
    : 'other'
}

/** 한 줄 문자열. 비었으면 ''. 화면 입력이므로 길이를 잘라 프롬프트·DB를 보호합니다. */
function readText(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/**
 * GET /api/english/records
 *
 * conversationId가 있으면 그 대화의 기록만, 없으면 전체 최근 기록을 줍니다.
 * 복습 화면과 "지난 표현 되살리기"가 같은 라우트를 씁니다 — 조회 조건이
 * 거의 같으므로 두 라우트로 나누면 같은 조건이 두 곳에 생깁니다.
 */
export async function GET(req: NextRequest) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  const raw = req.nextUrl.searchParams.get('conversationId')
  const scoped = raw ? isUuid(raw) : false
  if (raw && !scoped) return badRequest('대화 ID 형식이 올바르지 않습니다.')

  try {
    const db = getServerSupabase()

    // 정렬을 조건에 따라 나눠서 붙입니다. 조건 뒤에 붙이면 정렬이 빠져
    // 목록의 순서가 DB가 정한 대로 되어 복습 화면이 매번 달라집니다.
    let chunkQuery = db.from('english_chunks').select('*')
    let errorQuery = db.from('english_error_records').select('*')

    if (scoped) {
      const id = raw as string
      chunkQuery = chunkQuery.eq('conversation_id', id)
      errorQuery = errorQuery.eq('conversation_id', id)
    }

    const { data: chunks, error: chunkErr } = await chunkQuery
      .order('last_seen_at', { ascending: false })
      .limit(200)
    if (chunkErr) throw new Error(chunkErr.message)

    const { data: errors, error: errorErr } = await errorQuery
      .order('created_at', { ascending: false })
      .limit(200)
    if (errorErr) throw new Error(errorErr.message)

    return NextResponse.json({ chunks: chunks ?? [], errors: errors ?? [] })
  } catch (err: unknown) {
    // 원본은 서버 콘솔에만. Supabase 에러에는 스키마·테이블 이름이 함께 옵니다.
    // SQL을 안 실행한 경우 여기서 잡힙니다 — 클라이언트는 조용히 빈 목록으로 갑니다.
    console.error('[english-records] 조회 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}

/**
 * POST /api/english/records — 세션 하나를 저장합니다.
 *
 * 마무리 버튼을 눌렀을 때 한 번만 호출됩니다.
 *
 * ★ 세 테이블을 한 요청에서 씁니다 ★
 * 세션·오류·표현은 따로 떨어지면 다시 묶을 방법이 없습니다. 세션은 말미 한 번에
 * 끝나므로 부분 성공을 복구할 일이 없습니다 — 실패하면 사용자에게 경고하고 끝냅니다
 * (lib/db.ts의 saveEnglishRecords가 그 신호를 boolean으로 돌려줍니다).
 *
 * ★ chunks는 덮어씁니다 ★
 * 같은 구를 또 배우면 행을 늘리지 않고 seen_count만 올립니다
 * (english_chunks.phrase_key가 unique). 중복을 세면 "오늘 몇 가지 늘었나"를
 * 읽는 사람이 헷갈립니다.
 */
export async function POST(req: NextRequest) {
  if (!hasValidToken(req)) return unauthorized()
  if (!isDbConfigured()) return storageUnavailable()

  try {
    const body = await req.json()

    const conversationId = body?.conversationId
    if (!isUuid(conversationId)) {
      return badRequest('대화 ID 형식이 올바르지 않습니다.')
    }

    const scenario = readText(body?.scenario, 200)
    const summary = readText(body?.summary, 4000)

    // ── 1. 세션 ──────────────────────────────────────────────────────────
    // conversation_id가 unique이므로 upsert로 한 행을 유지합니다.
    // 대화가 몇 번을 다시 열어도 세션은 하나입니다.
    const { data: session, error: sessionErr } = await getServerSupabase()
      .from('english_sessions')
      .upsert(
        {
          conversation_id: conversationId,
          scenario,
          summary,
          ended_at: new Date().toISOString(),
        },
        { onConflict: 'conversation_id' }
      )
      .select('id')
      .single()
    if (sessionErr) throw new Error(sessionErr.message)

    // ── 2. 오류 ──────────────────────────────────────────────────────────
    const rawErrors = Array.isArray(body?.errors) ? body.errors.slice(0, MAX_ERRORS) : []
    const errorRows: EnglishErrorRow[] = []

    for (const raw of rawErrors as unknown[]) {
      if (typeof raw !== 'object' || raw === null) continue
      const e = raw as Record<string, unknown>

      const original = readText(e.original, 500)
      const corrected = readText(e.corrected, 500)
      const reason = readText(e.reason, 500)
      // 세 칸 중 하나라도 비면 버립니다. 부분 기록은 화면에 엉뚱한 항목으로 남습니다.
      if (!original || !corrected || !reason) continue

      const turnIndex = Number(e.turnIndex)
      errorRows.push({
        conversation_id: conversationId,
        session_id: session.id,
        turn_index: Number.isInteger(turnIndex) ? turnIndex : 0,
        original,
        corrected,
        reason,
        category: readCategory(e.category),
      })
    }

    if (errorRows.length > 0) {
      const { error: insertErr } = await getServerSupabase()
        .from('english_error_records')
        .insert(errorRows)
      if (insertErr) throw new Error(insertErr.message)
    }

    // ── 3. 배운 표현 ─────────────────────────────────────────────────────
    const rawExpressions = Array.isArray(body?.expressions)
      ? body.expressions.slice(0, MAX_EXPRESSIONS)
      : []
    const seen = new Set<string>()
    const chunkRows: EnglishChunkRow[] = []

    for (const raw of rawExpressions as unknown[]) {
      if (typeof raw !== 'object' || raw === null) continue
      const e = raw as Record<string, unknown>

      const phrase = readText(e.phrase, 300)
      if (!phrase) continue

      // 한 번만 보냅니다. 같은 구가 두 번 있으면 "몇 가지 늘었나"가 틀어집니다.
      const key = phraseKeyOf(phrase)
      if (seen.has(key)) continue
      seen.add(key)

      chunkRows.push({
        conversation_id: conversationId,
        session_id: session.id,
        phrase,
        phrase_key: key,
        meaning: readText(e.meaning, 300),
        scenario,
        seen_count: 1,
        last_seen_at: new Date().toISOString(),
      })
    }

    if (chunkRows.length > 0) {
      // 같은 구가 있으면 행을 늘리지 않고 최근 본 시각만 밀어 올립니다.
      // seen_count는 이 앱의 다른 곳에서 늘릴 수 없으므로 여기서는 1로 둡니다
      // — "몇 번 만났나"를 세는 기준을 지금 정하면 계측 없이 추측을 코드에 박게 됩니다.
      const { error: chunkErr } = await getServerSupabase()
        .from('english_chunks')
        .upsert(chunkRows, { onConflict: 'phrase_key' })
      if (chunkErr) throw new Error(chunkErr.message)
    }

    return NextResponse.json(
      { ok: true, errors: errorRows.length, expressions: chunkRows.length },
      { status: 201 }
    )
  } catch (err: unknown) {
    console.error('[english-records] 저장 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}
