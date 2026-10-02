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
  FINISH_INSTRUCTION,
  LESSON_SYSTEM_PROMPT,
  parseLessonResponse,
  type LessonTurn,
} from '@/lib/lesson'

/**
 * 출력 상한.
 *
 * 평소 턴은 1200이면 충분했습니다. 말미 요약은 예문 10개 + 다음 할 일까지
 * JSON으로 감싸지라 1200에서 잘립니다 — 잘리면 파서가 조용히 형식을 버리고
 * 사용자에게는 "요약 없는 마무리"가 보입니다. 2000으로 갈립니다.
 *
 * Provider별로 다른 값을 두지 않습니다. 여기서 늘리는 것이 TPM 예산에
 * 실제로 걸리는 값이기 때문입니다 (lib/context.ts의 DEFAULT_CONTEXT_BUDGET 참고).
 */
const TOKENS_PER_TURN = 1200
const TOKENS_FINISH = 2000

/** 과거 기록을 첫 턴에 되살릴 때 쓰는 형태. 화면이 채우고 서버가 문장을 만듭니다. */
type ReviewInput = {
  expressions?: unknown
  mistakes?: unknown
}

/**
 * 영어 학습 세션.
 *
 * /api/chat 과 다른 점:
 *   - 시스템 프롬프트가 서버에 고정돼 있다 (클라이언트가 마음대로 못 바꾼다)
 *   - jsonMode로 강제하고 파서를 통과시킨다
 *   - 파싱된 구조(steps / corrections / summary)를 그대로 내보낸다
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
    const { provider, model, messages, scenario, finish, review } = await req.json()

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
      `${dropped > 0 ? ` (${dropped}개 버림)` : ''}, 약 ${approxTokens} 토큰 (예산 ${DEFAULT_CONTEXT_BUDGET})` +
      `${finish ? ' · 마무리' : ''}`
    )

    const systemPrompt = buildSystemPrompt(
      typeof scenario === 'string' ? scenario : '',
      Boolean(finish),
      review as ReviewInput | undefined
    )

    // ★ Gemini는 역할을 번갈아 요구합니다 ★
    // user가 두 개 연달아 가면 400입니다. 마무리 지시를 아무 때나 붙이면
    // 사용자가 보낸 직후에 두 번째 user가 생깁니다. 마지막이 assistant인
    // 경우에만 붙입니다 — 마지막이 user라면 방금 보낸 그 문장이 프롬프트가
    // 되므로 지시 없이도 마무리 규칙은 시스템 프롬프트로 전달됩니다.
    const withFinish: LLMMessage[] = [...trimmed]
    if (finish && withFinish.length > 0 && withFinish[withFinish.length - 1].role === 'assistant') {
      withFinish.push({ role: 'user', content: FINISH_INSTRUCTION })
    }

    const result = await callLLM(provider, withFinish, {
      model,
      systemPrompt,
      jsonMode: true,
      maxTokens: finish ? TOKENS_FINISH : TOKENS_PER_TURN,
    })

    const turn: LessonTurn = parseLessonResponse(result.content)

    return NextResponse.json({
      content: turn.content,
      steps: turn.steps,
      corrections: turn.corrections,
      summary: turn.summary,
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
 * 시스템 프롬프트를 서버에서 조립합니다.
 *
 * 클라이언트가 지시를 마음대로 바꿀 수 없게 하려면 프롬프트 조립도 서버에 있어야
 * 합니다. 학습자 기준은 lib/lesson.ts의 서버 상수로 들어 있고(LESSON_SYSTEM_PROMPT에
 * 이미 포함됨), 여기에는 **그 세션에만 해당하는 것**만 덧붙입니다.
 */
function buildSystemPrompt(scenario: string, finish: boolean, review?: ReviewInput): string {
  const lines: string[] = []

  // 오늘의 상황. 빈 문자열이면 아예 붙이지 않습니다 — 빈 줄이 프롬프트에 남아도
  // 결과는 같지만, "상황이 정해지지 않았다"를 모델이 어떻게 해석할지 알 수 없습니다.
  const safeScenario = scenario.trim()
  if (safeScenario) {
    lines.push('## 오늘의 상황')
    lines.push(safeScenario)
    lines.push('이 상황에서 실제 할 수 있는 대화만 하세요.')
    lines.push('')
  }

  // ★ 이 기능의 존재 이유입니다 ★
  // 새 표현만 계속 늘면 유창함이 안 느는 이유가 됩니다. 지난 표현과 오류를
  // 첫 턴에 먼저 꺼내서 대화 안에서 다시 만나게 합니다
  // (docs/10-english-guide.md §5).
  const reviewLines = buildReviewLines(review)
  if (reviewLines.length > 0) {
    lines.push('## 지난 기록 — 오늘 먼저 다시 쓸 것들')
    lines.push(...reviewLines)
    lines.push('')
  }

  if (finish) {
    lines.push('## 지금은 마무리입니다')
    lines.push('이번 응답은 마무리 요약이어야 합니다. 새 주제를 꺼내지 마세요.')
    lines.push('')
  }

  return lines.join('\n') + LESSON_SYSTEM_PROMPT
}

/**
 * 과거 기록을 프롬프트 문장으로 만듭니다.
 *
 * ★ 개수는 아직 정하지 않습니다 ★
 * 반복 간격 정책(빈도? 경과 시간? 마지막 실패 시점?)은 계측이 쌓인 뒤에 정합니다
 * (docs/10-english-guide.md §5). 여기서는 **자연스러운 최대치만** 걸고,
 * 그 숫자가 곧 정책이 되면 안 된다는 사실을 주석에 남깁니다.
 */
function buildReviewLines(review?: ReviewInput): string[] {
  if (!review) return []

  const lines: string[] = []

  const expressions = toStringList(review.expressions)
  if (expressions.length > 0) {
    lines.push('- 지난번에 다룬 표현 (아무 설명 없이 먼저 써 보세요):')
    for (const e of expressions) lines.push(`  · ${e}`)
  }

  const mistakes = toStringList(review.mistakes)
  if (mistakes.length > 0) {
    lines.push('- 예전에 내가 틀렸던 것 (지금 한 번 더 정확하게 말하게 하세요):')
    for (const m of mistakes) lines.push(`  · ${m}`)
  }

  return lines
}

/**
 * 화면이 준 배열을 신뢰하지 않습니다.
 * service_role은 RLS를 우회하므로 서버가 주는 필터가 곧 유일한 필터입니다
 * (lib/db-server.ts 참고). 여기서 자르지 않으면 프롬프트에 빈 문자열이 줄을
 * 차지하고, 객체가 문자열로 렌더되어 모델이 이상한 문장을 읽게 됩니다.
 */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string') continue
    const s = v.trim()
    // 너무 긴 항목은 프롬프트를 밀어냅니다. 브라우저 입력처럼 보여도 방어합니다.
    if (s) out.push(s.slice(0, 200))
    if (out.length >= 8) break
  }
  return out
}
