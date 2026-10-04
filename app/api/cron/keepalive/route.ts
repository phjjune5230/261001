/**
 * ============================================================================
 *  유지 점검 — 매일 한 번, provider를 한 번씩, 저장을 한 번씩
 * ============================================================================
 *
 *  ★ 왜 이것이 있나 — "오래 안 쓰면 해지되나"에 대한 사실 정리 ★
 *
 *  두 가지가 섞여 있었는데, **실제 위험은 하나뿐**입니다.
 *
 *    • LLM provider 키 (openrouter / groq / gemini)
 *      → "무활동 만료" 같은 규칙은 없습니다. 다만 key 자체는 눈치껏
 *        상용화되므로, 하루 한 번 한마디를 던져 **유효함과 사용량**을
 *        함께 확인합니다. 비용은 세 건 합쳐도 1천 토큰이 안 됩니다.
 *
 *    • Supabase free tier ★ 이것이 진짜 위험 ★
 *      2026-10-05 확인, supabase.com/docs/guides/platform/going-into-prod
 *      원문: "We may pause applications on the Free Plan that exhibit low
 *      activity in a 7-day period to save on server resources."
 *      즉 일주일 뜸하면 project가 **중지**되고, 대화가 전부 거기로 갑니다.
 *
 *  그래서 provider 한 번 + 저장 한 번을 **매일** 돌립니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  ★ Vercel Cron으로 도는 이유 — GitHub Actions가 아니고 ★
 *
 *  사용자가 GitHub Actions를 제안했고, **될 수는 있습니다.** 안 된 게 아니라
 *  이쪽이 나은 것이고, 이유는 다음 한 줄입니다.
 *
 *    → 지금 키 다섯 개는 Vercel 환경 변수에만 있습니다.
 *      Actions로 돌리려면 OPENROUTER_API_KEY · GROQ_API_KEY · GEMINI_API_KEY ·
 *      SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY를 GitHub Secrets에 **다시** 넣어야 합니다.
 *      특히 SUPABASE_SERVICE_ROLE_KEY는 RLS를 완전히 우회하는 키라,
 *      키가 사는 곳이 두 군데가 됩니다.
 *
 *    → 여기는 CRON_SECRET **하나만** 더 넣으면 됩니다.
 *    → 로직(callLLM, getServerSupabase)이 이미 이 저장소에 있습니다.
 *      Actions로 하면 자기 자신을 curl로 때려야 해서 같은 일을 하는 코드 두 벌입니다.
 *    → Hobby 플랜 cron은 하루 1회로 제한되는데, 필요한 것도 하루 1회입니다. 딱 맞습니다.
 *
 *  (GitHub Actions는 CI 용도로 BACKLOG에 남아 있습니다. 그건 secret이 필요 없어서
 *   별개입니다 — "secret이 걸리는 업무는 Vercel, 안 걸리는 업무는 Actions"로
 *   나눠 두는 편이 안전합니다.)
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  실행 흐름 (provider 3개를 병렬로)
 *
 *    1. CRON_SECRET 검사
 *    2. 각 provider마다: defaultModelOf()로 모델을 잡아 짧게 한 번 호출
 *    3. 그 요청·응답을 Supabase에 대화 1건 + 메시지 2건으로 저장
 *    4. **읽어온다** — select로 되읽어 내용이 그대로인지 확인
 *    5. **지운다** — 대화를 delete. messages는 on delete cascade로 함께 사라집니다.
 *
 *  ★ 왜 저장하고 나서 지우나 ★
 *    "연결이 된다"만 확인하면 저장 경로가 죽어도 모릅니다. 실제로 넣고,
 *    실제로 읽고, 지웁니다. 읽기까지 해야 RLS 우회(service_role)가 살아 있는지
 *    증명됩니다 — 쓰기만 하고 안 읽으면 깨진 읽기 경로를 못 잡습니다.
 *
 *    지우기 때문에 사용자에게는 아무것도 남지 않습니다. 대화 목록에
 *    "ping"이 쌓이는 것보다 나쁩니다.
 *
 *  ★ 왜 kind는 'chat'인가 — 새 값을 만들지 않았습니다 ★
 *    conversations.kind의 check 제약이 ('chat','english')뿐입니다.
 *    'keepalive'을 쓰려면 사용자가 SQL을 직접 실행해야 하고, 그러면
 *    "왜 이게 안 돌아요"의 원인이 스키마 차이로 돌아갑니다.
 *    하루 만에 지울 행이니 'chat'으로 충분합니다.
 *
 *  ★ provider 오류 원본은 로그에 남기지 않습니다 ★
 *    lib/api.ts의 describeError()는 provider 이름과 상태 코드만 꺼냅니다.
 *    그 규칙을 여기서 바꾸지 않습니다 (app/api/chat/route.ts 주석 참고).
 */

import { NextRequest, NextResponse } from 'next/server'
import { describeError } from '@/lib/api'
import { getServerSupabase, isDbConfigured } from '@/lib/db-server'
import { ALL_PROVIDERS, callLLM, PROBE_TOKEN_CEILING, type Provider } from '@/lib/llm'
import { defaultModelOf, limitsForModel } from '@/lib/model-registry'

/**
 * ★ 이게 없으면 cron이 조용히 아무것도 안 합니다 ★
 *
 * Next.js는 사용하지 않는 GET 라우트를 빌드 시점에 정적 평가할 수 있습니다.
 * 그렇게 되면 "실행됐는데 아무 일도 안 일어나는" 상태가 됩니다 — 로그에
 * 에러조차 없습니다. 매일 도는 라우트에서 이건 가장 나쁜 고장 형태입니다.
 */
export const dynamic = 'force-dynamic'

/**
 * 짧게 한마디. 답이 없어도 됩니다 — 본문이 오는지만 봅니다.
 * "ping" 정도가 적당합니다. 문장을 시키면 이유를 지어내며 토큰을 씁니다.
 */
const PROBE_PROMPT = 'ping'

/**
 * 저장할 응답 길이 상한.
 *
 * 이 라우트는 "저장 경로가 살아 있나"를 보는 것이지 내용을 읽는 것이 아닙니다.
 * provider가 무엇을 뱉든 그대로 저장하면 되지만, 판독 없이 넣을 이유도 없습니다.
 * 잘라서 넣으면 되읽음 비교가 정확해지고, 실수로 긴 응답이 남더라도 대가가 작습니다.
 */
const STORED_REPLY_MAX = 500

/** provider 하나를 돌린 결과. */
type ProviderResult = {
  provider: Provider
  model: string
  ok: boolean
  /** 실패했을 때의 분류 (empty/quota/auth 등). 성공이면 null */
  kind: string | null
  status: number | null
  /**
   * provider가 본문을 못 채운 이유. kind가 'empty'일 때만 값이 있고,
   * 그 값이 "상한 부족(length)"인지 "다른 문제"인지 갈라 줍니다.
   * lib/api.ts의 describeError()가 꺼냅니다 — 여기서 새로 만들지 않습니다.
   */
  finishReason: string | null
  ms: number
  /** 저장에 쓸 실제 응답 본문. 실패하면 빈 문자열 */
  reply: string
}

/** Vercel Cron은 `Authorization: Bearer $CRON_SECRET`을 자동으로 붙여 보냅니다. */
function hasValidCronSecret(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET || ''
  const got = req.headers.get('authorization') || ''
  return Boolean(expected) && got === `Bearer ${expected}`
}

/**
 * provider 하나를 찔러봅니다. 응답 본문도 돌려줍니다 (저장에 씁니다).
 *
 * ★ maxTokens를 여기서 정합니다 — 하드코딩하지 않습니다 ★
 * 각 모델에 등록된 maxTokens를 쓰되 PROBE_TOKEN_CEILING에서 자릅니다.
 * 추론 모델은 본문 전에 reasoning 토큰을 쓰므로, 상한이 너무 낮으면
 * 빈 응답이 돌아오고 그것은 "연결 실패"로 읽힙니다 (2026-10-04의 gpt-oss-120b).
 */
async function pingProvider(provider: Provider): Promise<ProviderResult> {
  const startedAt = Date.now()
  const ms = () => Date.now() - startedAt
  const model = await defaultModelOf(provider)

  if (!model) {
    // 모델 목록이 비었다는 사실입니다. 기본값을 지어내지 않습니다.
    console.error(`[keepalive] ${provider}: 등록된 모델이 없습니다 (모델 관리 확인)`)
    return {
      provider,
      model: '',
      ok: false,
      kind: 'no-model',
      status: null,
      finishReason: null,
      ms: ms(),
      reply: '',
    }
  }

  try {
    const limits = await limitsForModel(provider, model)
    const result = await callLLM(provider, [{ role: 'user', content: PROBE_PROMPT }], {
      model,
      maxTokens: Math.min(limits.maxTokens, PROBE_TOKEN_CEILING),
    })

    // provider가 대표 모델로 되돌려줄 수 있습니다. 조용히 넘어가지 않습니다 —
    // "설정한 모델이 안 쓰이고 있다"는 사실은 따로 알려야 합니다.
    if (result.model && result.model !== model) {
      console.warn(
        `[keepalive] ${provider}: ${model} 요청 → ${result.model} 응답 (대표 모델로 대체됨)`
      )
    }

    return {
      provider,
      model: result.model || model,
      ok: true,
      kind: null,
      status: 200,
      finishReason: null,
      ms: ms(),
      reply: result.content ?? '',
    }
  } catch (err: unknown) {
    const { kind, provider: p, status, finishReason } = describeError(err)
    console.error(
      `[keepalive] ${provider} 실패: kind=${kind}` +
        `${p ? ` provider=${p}` : ''}${status ? ` status=${status}` : ''}` +
        `${finishReason ? ` finish_reason=${finishReason}` : ''}`
    )
    // ★ finish_reason을 결과에 싣습니다 ★
    // 'empty'만 보면 "무엇을 고쳐야 하나"를 알 수 없습니다.
    //   length — 이 경로의 출력 상한(512)이 작았습니다. 채팅은 2000을 받아
    //           정상일 수 있으므로, 이것만 보고 모델이 죽었다고 결론내리지 마세요.
    //   그 외   — 상한 문제가 아닙니다.
    return { provider, model, ok: false, kind, status, finishReason, ms: ms(), reply: '' }
  }
}

/** 저장 → 읽기 → 삭제 결과 */
type StoreResult = { saved: boolean; readBack: boolean; note: string; ms: number }

/**
 * 보낸 것과 받은 것을 저장하고, 되읽고, 지웁니다.
 *
 * provider별로 대화 한 건을 만듭니다. 하나가 실패해도 다른 둘은 계속되도록
 * 각자 try/catch로 감쌉니다 — 셋을 한 try로 묶으면 첫 실패로 나머지를 놓칩니다.
 */
async function roundTrip(provider: Provider, model: string, reply: string): Promise<StoreResult> {
  const startedAt = Date.now()
  const ms = () => Date.now() - startedAt

  if (!isDbConfigured()) {
    return {
      saved: false,
      readBack: false,
      note: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 없음',
      ms: 0,
    }
  }

  const db = getServerSupabase()
  const storedReply = reply.slice(0, STORED_REPLY_MAX)
  let conversationId: string | null = null

  try {
    // 1. 대화 만들기. title은 직접 주지 않습니다 — after_message_insert() 트리거가
    //    첫 사용자 메시지로 제목을 정합니다. 여기서 값을 주면 곧 덮어씁니다.
    const { data: convo, error: convoErr } = await db
      .from('conversations')
      .insert({ kind: 'chat', provider, model })
      .select('id')
      .single()
    if (convoErr) throw new Error(convoErr.message)
    conversationId = convo.id as string

    // 2. 저장 — 보낸 것과 받은 것을 그대로 넣습니다.
    const { error: msgErr } = await db.from('messages').insert([
      { conversation_id: conversationId, role: 'user', content: PROBE_PROMPT },
      {
        conversation_id: conversationId,
        role: 'assistant',
        content: storedReply,
        meta: { provider, model, keepalive: true },
      },
    ])
    if (msgErr) throw new Error(msgErr.message)

    // 3. 읽기 — 방금 넣은 게 그대로 나오는지 확인합니다.
    //    service_role이 RLS를 우회하므로, 여기서 안 읽히면 "저장 경로가 죽었다"입니다.
    //
    //    판정은 **순서가 아니라 내용**으로 합니다. Postgres의 now()는 트랜잭션
    //    단위라 한 insert 안의 두 행은 타임스탬프가 같습니다. order를 믿으면
    //    어느 쪽이 먼저인지 확정할 수 없습니다.
    //    (메시지 목록을 읽는 app/api/conversations/[id]/messages는 시간이 지난
    //     뒤의 행만 다루므로 문제가 없습니다 — 이 두 행만 예외입니다.)
    const { data: read, error: readErr } = await db
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
    if (readErr) throw new Error(readErr.message)

    const rows = read ?? []
    const readBack = rows.length === 2 && rows.some((r) => r.content === storedReply)

    return {
      saved: true,
      readBack,
      note: readBack
        ? `메시지 ${rows.length}건 되읽음`
        : `되읽은 내용이 다릅니다 (${rows.length}건)`,
      ms: ms(),
    }
  } catch (err: unknown) {
    // Supabase 에러에는 표·열 이름이 함께 오는 경우가 많습니다.
    // 여기에 provider 키는 없습니다. 다만 그래도 브라우저로는 안 보냅니다.
    console.error(`[keepalive] ${provider} 저장 실패:`, err)
    return { saved: false, readBack: false, note: '저장 중 오류 (서버 로그 참고)', ms: ms() }
  } finally {
    // 4. 삭제 — messages는 on delete cascade라 대화를 지우면 함께 사라집니다.
    //    지우기가 실패해도 다음 날 목록에 "ping"이 쌓입니다. 조용히 넘기지 않고
    //    남긴 id를 로그에 찍습니다 — 직접 지울 수 있게요.
    if (conversationId) {
      const { error: delErr } = await db.from('conversations').delete().eq('id', conversationId)
      if (delErr) {
        console.error(
          `[keepalive] ${provider} 정리 실패 — 이 대화가 목록에 남습니다: ${conversationId}`
        )
      }
    }
  }
}

/** GET /api/cron/keepalive — Vercel Cron이 하루 한 번 부릅니다. */
export async function GET(req: NextRequest) {
  /**
   * ★ CRON_SECRET이 없으면 **거부**합니다 (fail-closed) ★
   *
   * "비밀번호가 없으니 일단 열어두자"는 이 라우트에서 치명적입니다.
   * 이 라우트는 provider를 때리고 데이터를 씁니다. 공개돼 있으면
   * 남의 요청으로 계속 태우게 됩니다.
   *
   * 401이 아니라 503을 줍니다 — 요청자가 틀린 게 아니라 **설정이 안 된 것**이므로.
   */
  if (!process.env.CRON_SECRET) {
    console.error(
      '[keepalive] CRON_SECRET이 설정되지 않았습니다. 이 라우트는 거부합니다. ' +
        'Vercel 환경 변수에 CRON_SECRET을 등록한 뒤 Redeploy하세요.'
    )
    return NextResponse.json(
      {
        ok: false,
        error: 'CRON_SECRET이 설정되지 않았습니다. Vercel 환경 변수에 등록한 뒤 Redeploy하세요.',
      },
      { status: 503 }
    )
  }

  if (!hasValidCronSecret(req)) {
    return NextResponse.json({ ok: false, error: '인증되지 않았습니다.' }, { status: 401 })
  }

  const startedAt = Date.now()

  // ★ 병렬로 돌립니다 ★
  // 순차로 하면 세 번의 왕복이 더해집니다. 셋 중 하나가 느려도 나머지는 끝납니다.
  const results = await Promise.all(
    ALL_PROVIDERS.map(async (provider) => {
      const pinged = await pingProvider(provider)
      // provider가 실패했다면 저장은 건너뜁니다. 없는 답을 저장할 이유가 없습니다.
      const stored = pinged.ok
        ? await roundTrip(provider, pinged.model, pinged.reply)
        : { saved: false, readBack: false, note: 'provider 실패 — 저장 생략', ms: 0 }
      return { pinged, stored }
    })
  )

  const summary = results.map(({ pinged, stored }) => ({
    provider: pinged.provider,
    model: pinged.model,
    ok: pinged.ok,
    kind: pinged.kind,
    status: pinged.status,
    finishReason: pinged.finishReason,
    ms: pinged.ms,
    saved: stored.saved,
    readBack: stored.readBack,
    note: stored.note,
  }))

  const failed = summary
    .filter((r) => !r.ok || !r.saved || !r.readBack)
    .map((r) => r.provider)

  /**
   * provider가 실패해도 200을 돌려줍니다.
   *
   * 이 라우트는 "제대로 실행됐고, 무슨 일이 있었는지 보고했다" 자체가 성공입니다.
   * 상태 코드는 "cron이 돌아왔나"만 말하고, 각 provider의 성패는 본문과 로그가
   * 말합니다. 상태 코드로 실패를 알리면 Vercel이 재시도할 수 있어서
   * 하루에 몇 번씩 중복 호출되며, 그만큼 provider를 더 때립니다.
   */
  return NextResponse.json({
    ok: failed.length === 0,
    ranAt: new Date(startedAt).toISOString(),
    totalMs: Date.now() - startedAt,
    failed,
    results: summary,
  })
}