/**
 * ============================================================================
 *  대화 압축 (compaction)
 * ============================================================================
 *
 *  ⚠️ 서버 전용입니다. `lib/db-server.ts`를 거치므로 클라이언트에서
 *     import하면 안 됩니다 (RULE.md 1절).
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  왜 필요한가
 *  ─────────────────────────────────────────────────────────────────────────
 *  예산이 넘으면 오래된 메시지를 버립니다 (lib/context.ts). 화면과 DB에는
 *  그대로 남아 있지만 모델에게는 없습니다. 그래서 "아까 그거 얘기했는데"가
 *  안 됩니다 — 사용자는 저도 그 말을 했다는 걸 알기 때문입니다.
 *
 *  압축은 버린 자리를 **요약문으로 메우는** 것입니다. 되돌린 정보가 아니라
 *  대체 정보입니다. 그래서 요약이 무너지면 대화가 어긋난다는 전제가 깔립니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  요약을 어디에 두는가 — 왜 `meta`가 아니라 새 열인가
 *  ─────────────────────────────────────────────────────────────────────────
 *  `messages.meta`에 넣는 방법도 있습니다. 표를 더 안 만들어도 되니까.
 *  그 길은 파생 상태는 대화 소속이지 메시지 소속이 아니라는 점입니다.
 *  요약은 "무엇이 말해졌나"가 아니라 "이 대화를 지금까지 얼마나 덮었나"이고,
 *  덮은 범위는 대화를 열 때마다 다시 계산해야 합니다.
 *
 *  게다가 `meta`는 영어 학습의 예문·연습 단계를 원형으로 보존하는 자리(D-016)입니다.
 *  압축 상태를 거기 섞으면 어느 것이 원본이고 어느 것이 파생물인지 구분이 없어집니다.
 *  그래서 `conversations.compaction`(jsonb) 하나를 씁니다.
 *  → supabase/add-compaction.sql 을 실행해야 켜집니다. 안 실행된 배포에서는
 *    조용히 꺼져 있고(아래 try/catch), 앱은 지금처럼 "그냥 버리기"로 동작합니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  coveredCount가 왜 "개수"인가
 *  ─────────────────────────────────────────────────────────────────────────
 *  요약이 덮는 범위를 id나 시각으로 가리킬 수도 있습니다. 하지만 이 대화에는
 *  **삽입만 있고 수정·삭제가 없습니다** — 턴 삭제는 없고 대화 삭제는 전부입니다.
 *  그러므로 "앞에서부터 N개"는 시간이 지나도 정확합니다. 같은 타임스탬프를
 *  비교하거나 uuid 정서를 믿는 것보다 단순하고 확실합니다.
 */

import { getServerSupabase, isDbConfigured } from './db-server'
import { callLLM, type LLMMessage, type Provider } from './llm'
import { estimateTokens, keepRecentMessages } from './context'

export type CompactionState = {
  /** 지금까지 압축된 대화의 요약문 */
  summary: string
  /** 요약이 덮는 메시지 수 — 대화의 앞에서부터 */
  coveredCount: number
}

/**
 * 새로 덮이는 메시지가 이만큼 쌓일 때만 요약을 다시 만듭니다.
 *
 * 이 숫자가 없으면 요약을 매 턴 생성합니다. 예산을 넘긴 뒤로는 매 턴
 * 적어도 한 개가 버려지므로 "버린 게 있으면 요약"은 곧 "매 턴 요약"이고,
 * 요약 호출이 본 호출보다 비싸지는 순서가 됩니다.
 */
export const MIN_MESSAGES_TO_SUMMARIZE = 4

/**
 * 요약문 상한. 한글이 글자당 1토큰이므로 1500자는 1500토큰쯤입니다 (lib/context.ts).
 * 생성 쪽은 maxTokens로 막지만, 모델이 상한을 무시하고 길게 쓰는 경우를 막습니다.
 * 여기서 자른 뒤는 뒤가 잘린 요약이 됩니다 — 앞부분이 살아 있는 편이 낫습니다.
 */
const MAX_SUMMARY_CHARS = 1500

/** 요약 자체가 예산을 다 먹지 못하도록 남겨 두는 바닥값 */
const MIN_BUDGET_FOR_MESSAGES = 1500

/**
 * 요약에게 주는 지시.
 *
 * 요약이 망하는 방식은 두 가지입니다. 하나는 "처음부터 정리합니다"를 하며
 * 앞 결정을 지우는 것, 다른 하나는 사담·인사를 남기고 이름·숫자·결정을 빼는
 * 것입니다. 그래서 남길 것과 버릴 것을 구체적으로 적습니다.
 *
 * provider를 갈라 적지 않는 게 중요합니다 — 이 앱의 응답 언어가 무엇이든
 * 지시문은 한국어 한 덩어리로 갑니다.
 */
const SUMMARY_SYSTEM_PROMPT = `당신은 긴 대화의 요약을 만드는 담당입니다.
아래 <요약> 또는 <새로 압축할 대화>에 담긴 내용만 근거로 요약문을 씁니다.
근거가 없는 내용은 절대 지어내지 않습니다.

반드시 남길 것:
- 사람이름, 파일·라이브러리·함수 같은 고유명사
- 이미 정한 결정과 그 이유
- 사용자가 밝힌 목표, 취향, 제약
- 오류 메시지, 숫자, 코드 조각 (짧게 줄여도 식별은 되게)

버릴 것:
- 인사, 확인, "네", "좋아요" 같은 맞장구
- 되풀이된 설명
- 이미 끝난 자잘한 교환

형식:
- 한국어 서술형으로 쓴다. 목록 번호는 쓰지 않습니다.
- 앞부분에 "[이전 대화 요약]"이라는 제목 한 줄을 둡니다.
- 요약문 그 외에는 아무것도 쓰지 않습니다. 설명이나 머리말을 붙이지 않습니다.`

/** DB에 저장된 jsonb가 이 모양인지 확인합니다. 온전히 믿지는 않습니다. */
export function parseCompaction(raw: unknown): CompactionState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.summary !== 'string' || obj.summary === '') return null
  if (typeof obj.coveredCount !== 'number' || !Number.isFinite(obj.coveredCount)) return null
  return { summary: obj.summary, coveredCount: Math.max(0, Math.floor(obj.coveredCount)) }
}

/**
 * 요약문 하나가 예산에서 얼마나 차지하는지.
 *
 * 제목 줄과 구분자는 세지 않습니다 — 어림값이어도 괜찮고,
 * 이 값을 빼면 나머지 대화가 줄어드니까 오히려 안전합니다.
 */
function summaryCost(summary: string): number {
  return summary ? estimateTokens(summary) : 0
}

/**
 * 요약 앞뒤로 붙는 고정 문구. summaryCost와 짝을 이룹니다.
 */
const SUMMARY_HEADER = '[이전 대화 요약]\n'
const SUMMARY_FOOTER =
  '\n(대화의 앞부분은 위 요약으로 압축되었습니다. 원본은 화면에 남아 있습니다.)\n[이전 대화 요약 끝]'

export type CompactionPlan = {
  /** 요약을 아직 붙이지 않은, 모델에게 보낼 메시지 */
  context: LLMMessage[]
  /** 기존 요약문 (없으면 빈 문자열) */
  summary: string
  /** 요약이 이미 덮고 있는 개수 */
  covered: number
  /** 이번에 새로 덮을 개수 */
  newlyCovered: number
  /** 새로 덮는 개수가 임계값을 넘었는가 */
  shouldSummarize: boolean
  /** 요약을 갱신한다면 다음 coveredCount */
  nextCoveredCount: number
}

/**
 * 압축 계획을 세웁니다. DB도 LLM도 건드리지 않는 순수 계산입니다.
 *
 * 판단 근거는 이 파일 헤더와 lib/context.ts에 있습니다. 여기서는 숫자만 맞춥니다.
 */
export function planCompaction(
  messages: LLMMessage[],
  state: CompactionState | null,
  budget: number
): CompactionPlan {
  const summary = state?.summary ?? ''
  const covered = state?.coveredCount ?? 0

  // 이미 덮었다고 기록된 범위가 실제로 보낸 메시지보다 길 수는 없습니다
  // (대화 삭제는 훅이 목록에서 지웁니다). 그래도 한 번 더 조입니다 —
  // 이 값이 messages.length와 같으면 보낼 것이 하나도 없어집니다.
  const safeCovered = Math.min(covered, Math.max(0, messages.length - 1))

  const summaryTokens = summaryCost(summary)
  const budgetForMessages = Math.max(MIN_BUDGET_FOR_MESSAGES, budget - summaryTokens)

  const recent = messages.slice(safeCovered)
  const kept = keepRecentMessages(recent, budgetForMessages)
  const newlyCovered = recent.length - kept.length

  return {
    context: kept,
    summary,
    covered: safeCovered,
    newlyCovered,
    shouldSummarize: newlyCovered >= MIN_MESSAGES_TO_SUMMARIZE,
    nextCoveredCount: safeCovered + newlyCovered,
  }
}

/** 요약을 모델 앞 메시지 배열에 넣습니다. 버린 자리에 요약이 서는 모양입니다. */
export function attachSummary(plan: CompactionPlan): LLMMessage[] {
  if (!plan.summary) return plan.context
  return [
    { role: 'user', content: `${SUMMARY_HEADER}${plan.summary}${SUMMARY_FOOTER}` },
    ...plan.context,
  ]
}

/**
 * 방금 버린 부분을 기존 요약에 합칩니다.
 *
 * 기존 요약은 매번 새로 만들지 않고 계속 이어 붙입니다. 대화가 한 번에
 * 압축되는 게 아니라 조금씩 압축되므로, 이전 요약을 버리면 그 사이
 * 내용이 통째로 사라집니다.
 *
 * ★ 요약 지시문은 systemPrompt로 줍니다 ★
 * messages 배열의 system 항목을 쓰는 관성은 lib/llm.ts의 gemini 분기에서
 * 깨집니다 — 거기는 배열의 system을 버리고 systemInstruction만 씁니다.
 * 그러면 provider를 gemini로 고른 순간 요약 지시문만 사라집니다.
 *
 * 실패하면 null입니다. 요약이 못 만들어져도 이번 턴의 대답은 해야 합니다.
 */
export async function summarizeDropped(
  provider: Provider,
  model: string | undefined,
  previousSummary: string,
  droppedMessages: LLMMessage[]
): Promise<string | null> {
  if (droppedMessages.length === 0) return null

  const transcript = droppedMessages
    .map((m, i) => `${i + 1}. ${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`)
    .join('\n\n')

  const previousBlock = previousSummary
    ? `<요약>\n${previousSummary}\n</요약>\n\n위 <요약>은 이 대화의 앞부분을 이미 압축한 것입니다.\n여기에 새로 압축할 부분을 이어서 **하나의 새 요약문**으로 다시 씁니다.\n이미 들어 있는 내용을 중복해서 옮기지 말고 새로 생긴 내용만 더합니다.\n\n`
    : ''

  const prompt =
    `${previousBlock}<새로 압축할 대화>\n${transcript}\n</새로 압축할 대화>\n\n` +
    `위 ${droppedMessages.length}개 메시지를 위 규칙대로 요약문 하나로 만드세요.`

  try {
    const result = await callLLM(provider, [{ role: 'user', content: prompt }], {
      model,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      maxTokens: 900,
    })
    const text = result.content.trim()
    if (!text) return null
    return text.length > MAX_SUMMARY_CHARS ? text.slice(0, MAX_SUMMARY_CHARS) : text
  } catch (err: unknown) {
    // provider 오류 원본은 서버 콘솔에만. 브라우저로 내려갈 이유가 없습니다 (RULE.md 1절).
    console.error('[compaction] 요약 생성 실패, 이번 턴은 버리기만 합니다:', err)
    return null
  }
}

/**
 * 저장된 압축 상태를 읽습니다.
 *
 * ★ 없는 열이어도 앱이 죽지 않게 합니다 ★
 * add-compaction.sql을 아직 실행하지 않은 배포에서 이 호출은 42703으로
 * 실패합니다. 그걸 그대로 던지면 채팅이 통째로 500이 되므로 삼킵니다.
 * "압축이 꺼져 있다"는 정상 상태로 취급해야 합니다.
 */
export async function readCompaction(conversationId: string): Promise<CompactionState | null> {
  if (!conversationId || !isDbConfigured()) return null
  try {
    const { data, error } = await getServerSupabase()
      .from('conversations')
      .select('compaction')
      .eq('id', conversationId)
      .maybeSingle()
    if (error) {
      console.warn('[compaction] 압축 상태를 읽지 못했습니다:', error.message)
      return null
    }
    return parseCompaction(data?.compaction)
  } catch (err: unknown) {
    console.warn('[compaction] 압축 상태 조회 중 예외:', err)
    return null
  }
}

/** 압축 상태를 씁니다. 실패해도 대화는 계속됩니다 (위와 같은 이유). */
export async function writeCompaction(
  conversationId: string,
  state: CompactionState
): Promise<boolean> {
  if (!conversationId || !isDbConfigured()) return false
  try {
    const { error } = await getServerSupabase()
      .from('conversations')
      .update({ compaction: state })
      .eq('id', conversationId)
    if (error) {
      console.warn('[compaction] 압축 상태를 저장하지 못했습니다:', error.message)
      return false
    }
    return true
  } catch (err: unknown) {
    console.warn('[compaction] 압축 상태 저장 중 예외:', err)
    return false
  }
}
