/**
 * ============================================================================
 *  컨텍스트 예산 관리
 * ============================================================================
 *
 *  왜 필요한가:
 *    매 턴 대화 전체를 그대로 API에 보내면 비용이 선형으로 늘고, 결국
 *    provider의 컨텍스트 한도를 넘겨 400으로 거절당합니다.
 *
 *  턴 수가 아니라 토큰 예산으로 자릅니다.
 *    턴 수는 나쁜 기준입니다 — 코드 블록이 잔뜩인 턴이 수천 토큰이고
 *    "ㅇㅇ"가 몇 토큰인지 알 수 없기 때문입니다.
 *
 *  ── 여기까지가 예산 관리 ──────────────────────────────────────────────────
 *  요약 압축(compaction)은 lib/compaction.ts에 있습니다.
 *  여기는 "버릴 것을 고르는" 것까지만 책임집니다. 왜 잘렸는지는
 *  압축이 답합니다 — 여기서는 알 필요가 없습니다.
 */

/**
 * 토큰 근사값.
 *
 * 영문만 "4글자 ≈ 1토큰"으로 재면 한국어에서 완전히 틀립니다.
 * 실제 측정 결과: 한글은 글자 1개가 거의 1토큰입니다. 4로 나누면
 * 4배씩 과소평가되고, 예산 가드가 조용히 무력화됩니다.
 *
 * 2026-10-01 실측으로 확인된 사고:
 *   한글 3,000자 × 41턴 → char/4 기준 12,000토큰으로 판단해 잘라 보냈는데
 *   groq가 "Requested 46197" 이라고 거절했습니다. 실제값이 근사의 3.8배였습니다.
 *
 * 그래서 CJK(한글·한자·일본어)는 따로 센다.
 */
export function estimateTokens(text: string): number {
  let cjk = 0

  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) as number
    // 서로게이트 페어(출렁이모지 등)는 두 칸을 건너뛴다
    if (code > 0xffff) i++

    if (
      (code >= 0xac00 && code <= 0xd7a3) || // 한글 음절
      (code >= 0x1100 && code <= 0x11ff) || // 한글 자모
      (code >= 0x3130 && code <= 0x318f) || // 한글 호환 자모
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 통합 한자
      (code >= 0x3040 && code <= 0x30ff)    // 일본어 히라가나·카타카나
    ) {
      cjk++
    }
  }

  return Math.ceil(cjk + (text.length - cjk) / 4)
}

/**
 * 기본 예산 — 한 턴이 **메시지**에 쓸 수 있는 토큰.
 *
 * **모델의 컨텍스트 한도가 아니라 분당 토큰(TPM) 한도에 맞춘 값이다.**
 * groq `openai/gpt-oss-120b`의 한도는 8,000 TPM입니다
 * (console.groq.com/docs/rate-limits, Developer Plan 기준).
 * 컨텍스트 창이 128k여도 분당 8천이면 그 위는 반드시 거절당합니다.
 *
 * 한 턴이 8,000을 통째로 쓰면 안 됩니다. TPM은 분당 **총량**이라,
 * 같은 분에 요약 호출이 하나라도 더 붙으면 본 호출이 밀립니다.
 * 그래서 실제 사용분은 7,000 이내로 두고 1,000을 여유로 남깁니다.
 *
 *   평시 턴:  시스템 300 + 메시지 4,300 + 출력 2,000 = 6,600
 *   압축 턴:  (요약 3,000) + (시스템 300 + 메시지 2,000 + 출력 1,700) = 7,000
 *
 * 6,000 → 4,300으로 내린 이유는 출력을 1,024 → 2,000으로 올리기 위해서입니다.
 * 합계는 7,024에서 6,600으로 오히려 줄었고, 그럼에도 답이 두 배로 깁니다.
 * (lib/api/chat/route.ts의 CHAT_MAX_TOKENS 참고)
 *
 * provider를 바꾸면 이 상수를 바꿉니다 — 값은 provider의 실제 TPM에서 나옵니다.
 * groq를 쓰는 한 8,000이 정답이고, 이를 넘기면 거절당합니다.
 */
export const DEFAULT_CONTEXT_BUDGET = 4_300

type ContentLike = { content: string; role?: string }

/**
 * 예산을 넘을 때 오래된 메시지부터 버리고 최근만 남깁니다.
 * 첫 메시지가 system이면 절대 버리지 않습니다 (지시문이 사라지면 의미가 바뀝니다).
 *
 * ★ 남은 첫 메시지는 반드시 user여야 합니다 ★
 * 순서만 보고 자르면 요청-응답 쌍이 중간에서 갈라집니다. 그렇게 남은
 * "응답만 있는 상태"를 provider는 보통 정상으로 받습니다 — 그래서
 * 조용히 이상한 답이 나오고, 원인이 보이지 않습니다.
 * 그래서 예산이 이미 충분해도 경계가 assistant에 걸렸다면 한 번 더 버립니다.
 *
 * 예외: 메시지가 하나뿐이면 남깁니다. 마지막 메시지를 버리면
 * 모델이 받을 것이 없어 요청이 실패합니다. 이 한 건은 의도적으로 남습니다.
 */
export function keepRecentMessages<T extends ContentLike>(
  messages: T[],
  budget: number = DEFAULT_CONTEXT_BUDGET
): T[] {
  if (messages.length === 0) return messages

  const keepSystem = messages[0]?.role === 'system'
  const start = keepSystem ? 1 : 0
  const head = messages.slice(0, start)
  const tail = [...messages.slice(start)]

  let total = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  if (total <= budget) return messages

  // 뒤에서부터 확보 — 최근일수록 중요하므로.
  // 남은 맨 앞이 assistant인 동안에는 계속 버립니다 (요청이 없는데 답부터 있으니).
  while (tail.length > 1 && (total > budget || tail[0].role === 'assistant')) {
    const dropped = tail.shift()
    if (!dropped) break
    total -= estimateTokens(dropped.content)
  }

  return [...head, ...tail]
}

/**
 * 몇 개가 버려졌는지 — 개발 중 실제로 작동하는지 확인용으로 라우트에서 로그합니다.
 */
export function countDropped(original: number, kept: number): number {
  return Math.max(0, original - kept)
}
