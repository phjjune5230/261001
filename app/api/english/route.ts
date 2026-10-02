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
import {
  LESSON_SYSTEM_PROMPT,
  parseLessonResponse,
  type LearnerProfile,
} from '@/lib/lesson'

/**
 * 영어 학습 세션.
 *
 * /api/chat 과 다른 점:
 *   - 시스템 프롬프트가 서버에 고정돼 있다 (클라이언트가 마음대로 못 바꾼다)
 *   - jsonMode로 강제하고 파서를 통과시킨다
 *   - 파싱된 구조(phase / steps)를 그대로 내보낸다
 *
 * 컨텍스트도 /api/chat과 같은 규칙을 적용한다.
 * 영어 대화는 예문과 번역이 반복되므로 특히 빨리 찬다.
 *
 * ★ 여기서는 압축(compaction)을 하지 않습니다 ★
 * 채팅과 달리 영어 세션은 예문·번역·단계가 서로 의지합니다. 요약이 그 사이의
 * 상태를 뭉개면 사용자는 "무슨 단어 연습 중이더라"를 잃고, 영어 기능이 가장
 * 잘하는 일을 못 하게 됩니다. 그래서 영어는 "버리기"만 하고 메우지 않습니다.
 * 필요해지면 messages.meta를 건드리지 않는 별도 저장소를 먼저 설계해야 합니다.
 */
export async function POST(req: NextRequest) {
  if (!hasValidToken(req)) {
    return unauthorized()
  }

  try {
    const { provider, model, messages, profile } = await req.json()

    if (!provider) {
      return badRequest('provider가 필요합니다.')
    }

    if (!isKnownProvider(provider)) {
      return badRequest(`지원하지 않는 provider입니다: ${provider}`)
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return badRequest('messages가 필요합니다.')
    }

    const trimmed = keepRecentMessages(messages as LLMMessage[])
    const dropped = countDropped(messages.length, trimmed.length)
    const approxTokens = trimmed.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0)
    console.log(
      `[english] ${messages.length} → ${trimmed.length} 메시지` +
      `${dropped > 0 ? ` (${dropped}개 버림)` : ''}, 약 ${approxTokens} 토큰 (예산 ${DEFAULT_CONTEXT_BUDGET})`
    )

    // 학습자 프로필은 첫 턴의 system 자리를 대신한다. 프런트가 시스템 프롬프트를
    // 조작할 수 없게 하려면 서버에서 조립해야 한다.
    const systemPrompt = buildSystemPrompt(profile as LearnerProfile | undefined)

    const result = await callLLM(provider, trimmed, {
      model,
      systemPrompt,
      jsonMode: true,
      maxTokens: 1200,
    })

    const turn = parseLessonResponse(result.content)

    return NextResponse.json({
      phase: turn.phase,
      content: turn.content,
      steps: turn.steps,
      provider: result.provider,
      model: result.model,
      droppedMessages: dropped,
      approxTokens,
    })
  } catch (err: unknown) {
    console.error('[english] provider 호출 실패:', err)
    return NextResponse.json({ error: userFacingMessage(err) }, { status: 500 })
  }
}

/**
 * 사용자 신원이 없으면 프로필 문장을 아예 붙이지 않는다.
 * 빈 문자열을 붙이면 "현재 학습자 수준: undefined" 같은 것이 프롬프트에 들어간다.
 */
function buildSystemPrompt(profile?: LearnerProfile): string {
  const safeLevel = profile?.level?.trim()
  const safeGoal = profile?.goal?.trim()

  const lines: string[] = []
  if (safeLevel || safeGoal) {
    lines.push('## 학습자 정보')
    if (safeLevel) lines.push(`수준: ${safeLevel}`)
    if (safeGoal) lines.push(`목표: ${safeGoal}`)
    lines.push('')
  }

  return lines.join('\n') + LESSON_SYSTEM_PROMPT
}
