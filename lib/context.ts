/**
 * ============================================================================
 *  컨텍스트 예산 관리
 * ============================================================================
 *
 *  왜 필요한가:
 *    매 턴 대화 전체를 그대로 API에 보내면 비용이 선형으로 늘고, 결국
 *    provider의 컨텍스트 한도를 넘겨 400으로 거절당합니다.
 *
 *  턴 수가 아니라 토큰 예산으로 자릅니다 (docs/08-decisions.md D-014).
 *    턴 수는 나쁜 기준입니다 — 코드 블록이 잔뜩인 턴이 수천 토큰이고
 *    "ㅇㅇ"가 몇 토큰인지 알 수 없기 때문입니다.
 *
 *  ── 아직 하지 않는 것 ───────────────────────────────────────────────────
 *  요약 압축(compaction)과 프리픽스 캐싱은 영어 기능이 들어온 뒤 설계합니다.
 *  여기서는 "오래된 걸 버리는" 것까지만 합니다. 요약은 별도 결정이 필요합니다.
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
 * 기본 예산.
 *
 * **모델의 컨텍스트 한도가 아니라 분당 토큰(TPM) 한도에 맞춘 값이다.**
 * 실측: groq `openai/gpt-oss-120b`의 한도는 8,000 TPM.
 * 컨텍스트 창이 128k여도 분당 8천이면 12,000 예산은 반드시 거절당합니다.
 *
 * 그래서 6,000으로 둡니다 — 시스템 프롬프트와 출력(max_tokens 1024) 자리를 남기고,
 * 순간적으로 여러 요청이 겹칠 때도 버틸 수 있는 값입니다.
 *
 * 더 큰 모델·더 큰 한도를 쓰게 되면 이 상수를 올리되,
 * provider의 실제 TPM 한도를 먼저 확인하고 바꾸세요 (docs/09-changelog.md 정기 점검).
 */
export const DEFAULT_CONTEXT_BUDGET = 6_000

type ContentLike = { content: string; role?: string }

/**
 * 예산을 넘을 때 오래된 메시지부터 버리고 최근만 남깁니다.
 * 첫 메시지가 system이면 절대 버리지 않습니다 (지시문이 사라지면 의미가 바뀝니다).
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

  // 뒤에서부터 확보 — 최근일수록 중요하므로
  while (tail.length > 1 && total > budget) {
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
