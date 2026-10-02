import { NextRequest, NextResponse } from 'next/server'
import { callLLM, type LLMMessage } from '@/lib/llm'
import {
  badRequest,
  hasValidToken,
  isKnownProvider,
  isUuid,
  unauthorized,
  userFacingMessage,
} from '@/lib/api'
import { DEFAULT_CONTEXT_BUDGET, countDropped, estimateTokens } from '@/lib/context'
import {
  attachSummary,
  planCompaction,
  readCompaction,
  summarizeDropped,
  writeCompaction,
} from '@/lib/compaction'

export async function POST(req: NextRequest) {
  // 본문 파싱보다 먼저. 토큰이 없으면 provider를 호출할 이유가 없다 —
  // 이 검사가 없으면 URL을 아는 사람이 그대로 POST로 키 크레딧을 소모할 수 있다.
  if (!hasValidToken(req)) {
    return unauthorized()
  }

  try {
    const { provider, model, messages, systemPrompt, conversationId } = await req.json()

    if (!provider) {
      return badRequest('provider가 필요합니다.')
    }

    if (!isKnownProvider(provider)) {
      return badRequest(`지원하지 않는 provider입니다: ${provider}`)
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return badRequest('messages가 필요합니다.')
    }

    // service_role이 RLS를 완전히 우회하므로 이 값이 곧 DB를 때리는 WHERE입니다.
    // uuid가 아니면 아예 묻지 않습니다 (lib/db-server.ts, lib/api.ts 참고).
    const conversation = isUuid(conversationId) ? conversationId : null

    // ── 압축 ────────────────────────────────────────────────────────────────
    // 대화 전체를 쑤셔 넣으면 비용이 선형으로 늘고 결국 한도를 넘겨 거절당한다.
    // 턴 수가 아니라 토큰 예산으로 자릅니다.
    // 잘린 자리를 요약으로 메우는 설계와 그 근거는 lib/compaction.ts에 있습니다.
    //
    // conversationId가 없으면 압축은 그냥 꺼집니다. 첫 턴에는 아직 대화가
    // DB에 없어서 그렇고, 그때는 압축할 만큼 길지도 않습니다.
    const state = conversation ? await readCompaction(conversation) : null
    const plan = planCompaction(messages as LLMMessage[], state, DEFAULT_CONTEXT_BUDGET)

    let summary = plan.summary
    let compacted = false

    if (conversation && plan.shouldSummarize) {
      const dropped = (messages as LLMMessage[]).slice(
        plan.covered,
        plan.covered + plan.newlyCovered
      )
      const nextSummary = await summarizeDropped(provider, model, plan.summary, dropped)

      // ★ 저장이 성공했을 때만 이번 턴에 씁니다 ★
      // 저장 전에 요약을 써버리면, 저장이 실패한 채 모델에게 요약만 보낸
      // 턴이 됩니다. 그때 덮은 구간은 DB에 기록이 없어 다음 턴에 또 덮입니다.
      // 그때 이전 요약이 아직 구 구간만 가리키고 있으므로 같은 내용이
      // 두 번 들어갑니다. 저장을 먼저 하고, 성공했을 때만 신뢰합니다.
      if (nextSummary) {
        const saved = await writeCompaction(conversation, {
          summary: nextSummary,
          coveredCount: plan.nextCoveredCount,
        })
        if (saved) {
          summary = nextSummary
          compacted = true
        }
      }
    }

    const context = attachSummary(compacted ? { ...plan, summary } : plan)
    const dropped = countDropped(messages.length, plan.context.length)
    const approxTokens = context.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0)
    console.log(
      `[chat] ${messages.length} → ${plan.context.length} 메시지` +
      `${dropped > 0 ? ` (${dropped}개 압축)` : ''}` +
      `${compacted ? ', 요약 갱신' : ''}` +
      `${summary ? `, 요약 ${estimateTokens(summary)} 토큰 포함` : ''}` +
      `, 약 ${approxTokens} 토큰 (예산 ${DEFAULT_CONTEXT_BUDGET})`
    )

    const result = await callLLM(provider, context, {
      model,
      systemPrompt,
    })

    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      model: result.model,
      // 버린 개수와 근사 토큰 수를 알려준다. 프런트가 다음 턴에 얼마를 더 보낼지
      // 미리 알 수 있어야 UI에 "앞부분이 잘렸습니다"를 표시할 수 있다.
      droppedMessages: dropped,
      approxTokens,
      // 압축이 실제로 일어났는가, 그리고 그 요약문.
      // 화면에 요약을 보여줄지 말지는 프런트가 정합니다 (lib/compaction.ts).
      compacted,
      summary: summary || null,
    })
  } catch (err: unknown) {
    // provider가 준 원본 응답(키 지문 등이 포함될 수 있음)은 서버 콘솔에만 남긴다.
    // 그대로 내려보내면 브라우저에 노출되고, 더 나쁘게는 AI 응답과 구분되지 않는다.
    console.error('[chat] provider 호출 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}