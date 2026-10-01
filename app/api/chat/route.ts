import { NextRequest, NextResponse } from 'next/server'
import { callLLM, type LLMMessage } from '@/lib/llm'
import {
  badRequest,
  hasValidToken,
  isKnownProvider,
  unauthorized,
  userFacingMessage,
} from '@/lib/api'
import {
  DEFAULT_CONTEXT_BUDGET,
  keepRecentMessages,
  countDropped,
  estimateTokens,
} from '@/lib/context'

export async function POST(req: NextRequest) {
  // 본문 파싱보다 먼저. 토큰이 없으면 provider를 호출할 이유가 없다 —
  // 이 검사가 없으면 URL을 아는 사람이 그대로 POST로 키 크레딧을 소모할 수 있다.
  if (!hasValidToken(req)) {
    return unauthorized()
  }

  try {
    const { provider, model, messages, systemPrompt } = await req.json()

    if (!provider) {
      return badRequest('provider가 필요합니다.')
    }

    if (!isKnownProvider(provider)) {
      return badRequest(`지원하지 않는 provider입니다: ${provider}`)
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return badRequest('messages가 필요합니다.')
    }

    // 대화 전체를 쑤셔 넣으면 비용이 선형으로 늘고 결국 한도를 넘겨 거절당한다.
    // 턴 수가 아니라 토큰 예산으로 최근만 남긴다 (D-014).
    const trimmed = keepRecentMessages(messages as LLMMessage[])
    const dropped = countDropped(messages.length, trimmed.length)
    const approxTokens = trimmed.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0)
    console.log(
      `[chat] ${messages.length} → ${trimmed.length} 메시지` +
      `${dropped > 0 ? ` (${dropped}개 버림)` : ''}, 약 ${approxTokens} 토큰 (예산 ${DEFAULT_CONTEXT_BUDGET})`
    )

    const result = await callLLM(provider, trimmed, {
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
    })
  } catch (err: unknown) {
    // provider가 준 원본 응답(키 지문 등이 포함될 수 있음)은 서버 콘솔에만 남긴다.
    // 그대로 내려보내면 브라우저에 노출되고, 더 나쁘게는 AI 응답과 구분되지 않는다.
    console.error('[chat] provider 호출 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}