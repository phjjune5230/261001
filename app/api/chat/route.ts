import { NextRequest, NextResponse } from 'next/server'
import { callLLM, type LLMMessage } from '@/lib/llm'
import {
  badRequest,
  hasValidToken,
  isKnownProvider,
  isUuid,
  providerError,
  unauthorized,
} from '@/lib/api'
import { countDropped, contextBudgetFor, estimateTokens } from '@/lib/context'
import { limitsFor } from '@/lib/models'
import {
  attachSummary,
  planCompaction,
  readCompaction,
  summarizeDropped,
  writeCompaction,
} from '@/lib/compaction'

/**
 * 출력 상한은 여기서 더 정하지 않습니다 — lib/models.ts의 ModelInfo.maxTokens입니다.
 *
 * 이 파일에 2,000을 하드코딩했던 시기가 있었습니다. 문제는 그 숫자가 어디서
 * 왔는지 아무도 모른다는 점이었고, provider를 바꿔도 따라가지 않았습니다.
 * 그래서 고치는 사람이 값을 만질 수 있는 곳으로 옮겼습니다.
 *
 * 압축이 걸린 턴에는 더 작게 줍니다. 그 턴은 같은 분에 요약 호출이 하나 더 나가므로
 * 두 요청의 합이 TPM 이하여야 하기 때문입니다.
 */
const COMPACTION_MAX_TOKENS = 1700

/**
 * 압축이 걸린 턴의 메시지 예산.
 *
 * 합계: 요약 호출 3,000(시스템 600 + 기존요약 700 + 전사 1,000 + 출력 600)
 *     + 본 호출 4,200(시스템 300 + 메시지 2,000 + 출력 1,700) = 7,200
 * 8,000 안에 남는 여유는 800입니다. groq는 트래픽 스파이크 때 503이 잦으므로
 * (그래서 재시도가 필요하지만 아직 없습니다) 여유가 좁다는 것을 알고 한 값입니다.
 */
const COMPACTION_CONTEXT_BUDGET = 2000

/**
 * 시스템 프롬프트 상한.
 *
 * chat/page.tsx에서 사용자가 자유롭게 입력하는 값이라 길이에 제한이 없었습니다.
 * 예산 밖에서 더해지므로(llm.ts가 메시지 앞에 따로 붙입니다) 길면 그만큼
 * 메시지 예산을 파고들어 8,000을 넘깁니다. 여기서 자릅니다.
 */
const MAX_SYSTEM_PROMPT_CHARS = 1500

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

    // ★ 시스템 프롬프트도 예산에서 뺍니다 ★
    // llm.ts가 메시지 앞에 따로 붙이므로 예산 밖의 숨은 값이었습니다.
    // chat/page.tsx에서 사용자가 자유롭게 입력하는 값이라 길면 그대로 8,000을 넘겼습니다.
    const rawSystem = typeof systemPrompt === 'string' ? systemPrompt : ''
    const system =
      rawSystem.length > MAX_SYSTEM_PROMPT_CHARS
        ? rawSystem.slice(0, MAX_SYSTEM_PROMPT_CHARS)
        : rawSystem

    // ★ 고른 모델의 한도로 예산을 정합니다 ★
    // 손으로 맞춘 상수가 여기 없으므로 provider를 바꿔도 값이 따라갑니다.
    // 한도를 모르는 모델이면 기본값으로 돌아갑니다 (lib/context.ts).
    const limits = limitsFor(provider, typeof model === 'string' ? model : undefined)
    const budget = contextBudgetFor(limits.tpm, limits.maxTokens)

    let plan = planCompaction(
      messages as LLMMessage[],
      state,
      budget - estimateTokens(system)
    )

    // ★ 압축이 걸린 턴은 예산을 한 번 더 좁힙니다 ★
    // 그 턴에는 요약 호출이 하나 더 나가므로, 두 요청의 합이 TPM 이하여야 합니다.
    // (planCompaction이 MIN_BUDGET_FOR_MESSAGES로 바닥을 두므로 음수가 들어가도 안전합니다)
    if (plan.shouldSummarize) {
      plan = planCompaction(
        messages as LLMMessage[],
        state,
        Math.min(COMPACTION_CONTEXT_BUDGET, budget)
      )
    }

    // 압축 턴은 같은 분에 요약 호출이 하나 더 나가므로 더 작게 줍니다.
    const maxTokens = plan.shouldSummarize
      ? Math.min(COMPACTION_MAX_TOKENS, limits.maxTokens)
      : limits.maxTokens

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
      `, 입력 약 ${approxTokens + estimateTokens(system)} (예산 ${budget}, ` +
      `출력 상한 ${maxTokens}, 모델 ${limits.name}` +
      `${limits.tpm ? ` · TPM ${limits.tpm}` : ' · TPM 미상'})`
    )

    const result = await callLLM(provider, context, {
      model,
      systemPrompt: system,
      maxTokens,
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
    // 원본 오류는 로그에도 응답으로도 내보내지 않습니다 (RULE.md 1절).
    // provider 본문에는 API 키 지문이 들어간 적이 있습니다 (v0.2.0 사고).
    // 종류·provider·상태 코드만 남기면 원인 집계에는 충분하고 누출은 없습니다.
    // 분류표와 그 근거는 lib/api.ts에 있습니다.
    return providerError(err, 'chat')
  }
}