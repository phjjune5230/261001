import { describe, it, expect } from 'vitest'
import {
  parseCompaction,
  planCompaction,
  attachSummary,
  MIN_MESSAGES_TO_SUMMARIZE,
  type CompactionState,
} from './compaction'
import { estimateTokens } from './context'
import type { LLMMessage } from './llm'

/**
 * 압축 로직의 테스트.
 *
 * lib/compaction.ts는 db-server와 llm을 import하지만, 여기서 쓰는 세 함수는
 * 그 어떤 것도 건드리지 않습니다 — env가 없어도 import는 성공합니다
 * (db-server는 클라이언트를 lazy로 만듭니다).
 *
 * ★ 여기서 막는 실패는 전부 "조용한" 실패입니다 ★
 * summarizeDropped가 실패하면 catch가 삼키고 null을 돌려줍니다. 로그를 안 보면
 * 앱은 "그냥 버리기"로 정상 동작해 보입니다. 실제로 MAX_TRANSCRIPT_TOKENS가
 * 없을 때 계속해서 그랬습니다.
 */

const ko = (n: number) => '가'.repeat(n)

/** 0번이 user, 1번이 assistant로 번갈아 오는 메시지 n개 */
const alternating = (n: number): LLMMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: ko(1_000),
  }))

describe('parseCompaction', () => {
  it('정상 값은 그대로 돌려준다', () => {
    const s = parseCompaction({ summary: '요약', coveredCount: 7 })
    expect(s).toEqual({ summary: '요약', coveredCount: 7 })
  })

  /**
   * ★ DB jsonb를 온전히 믿지 않는 함수 ★
   * 이 값은 PostgREST가 돌려준 jsonb이고, 스키마 제약이 없습니다.
   * 옛날 데이터나 수동 편집으로 모양이 깨질 수 있습니다.
   * 여기서 조용히 통과시키면 윗부분에서 messages가 undefined가 됩니다.
   */
  it('★ 아니거나 모양이 다르면 null이다 (throw 하지 않는다)', () => {
    const bad: unknown[] = [
      null,
      undefined,
      0,
      '',
      '문자열',
      true,
      [],
      [{ summary: 'x', coveredCount: 1 }],
      {},
      { summary: '요약' }, // coveredCount 없음
      { coveredCount: 3 }, // summary 없음
      { summary: '', coveredCount: 3 }, // 빈 요약문
      { summary: 123, coveredCount: 3 }, // summary가 숫자
      { summary: '요약', coveredCount: '3' }, // coveredCount가 문자열
      { summary: '요약', coveredCount: null },
      { summary: '요약', coveredCount: NaN },
      { summary: '요약', coveredCount: Infinity },
      { summary: '요약', coveredCount: -Infinity },
    ]
    for (const v of bad) {
      expect(parseCompaction(v)).toBeNull()
    }
  })

  it('음수 coveredCount는 0으로 접는다', () => {
    expect(parseCompaction({ summary: '요약', coveredCount: -5 })).toEqual({
      summary: '요약',
      coveredCount: 0,
    })
  })

  it('소수 coveredCount는 내림한다', () => {
    expect(parseCompaction({ summary: '요약', coveredCount: 3.9 })?.coveredCount).toBe(3)
  })

  it('반환값은 원본 객체를 그대로 노출하지 않는다', () => {
    const raw = { summary: '요약', coveredCount: 2, extra: '남는 필드' }
    const s = parseCompaction(raw) as Record<string, unknown>
    expect(Object.keys(s).sort()).toEqual(['coveredCount', 'summary'])
  })
})

describe('planCompaction', () => {
  it('상태가 없으면 덮인 것이 없다', () => {
    const plan = planCompaction(alternating(6), null, 100_000)
    expect(plan.summary).toBe('')
    expect(plan.covered).toBe(0)
    expect(plan.newlyCovered).toBe(0)
    expect(plan.shouldSummarize).toBe(false)
    expect(plan.nextCoveredCount).toBe(0)
    expect(plan.context.length).toBe(6)
  })

  /**
   * ★ 회귀 테스트 — safeCovered ★
   *
   * 이미 덮었다고 기록된 범위가 실제로 보낸 메시지보다 길 수는 없습니다
   * (대화 삭제는 목록에서 지웁니다). 그래도 조여야 합니다.
   * 이 값이 messages.length와 같아지면 **보낼 것이 하나도 없어집니다.**
   */
  it('★ coveredCount가 메시지 수 이상이어도 컨텍스트가 비지 않는다', () => {
    for (const [len, coveredCount] of [
      [1, 5],
      [1, 1],
      [5, 10],
      [5, 5],
      [5, 4],
      [20, 999],
    ] as const) {
      const msgs = alternating(len)
      const state: CompactionState = { summary: '요약', coveredCount }
      const plan = planCompaction(msgs, state, 100_000)
      expect(plan.context.length).toBeGreaterThanOrEqual(1)
      expect(plan.covered).toBeLessThanOrEqual(len - 1)
    }
  })

  it('예산을 넘기면 새로 덮인 개수가 생기고 임계값을 넘으면 요약한다', () => {
    const plan = planCompaction(alternating(10), null, 1_500)
    expect(plan.newlyCovered).toBeGreaterThanOrEqual(MIN_MESSAGES_TO_SUMMARIZE)
    expect(plan.shouldSummarize).toBe(true)
  })

  it('버린 것이 임계값 미만이면 요약하지 않는다', () => {
    // 10개에서 2개만 남기도록 좁게 자르면 newlyCovered = 8이라 여전히 요약합니다.
    // 임계값 미만인 상태를 만들려면 예산이 거의 없어야 합니다.
    const plan = planCompaction(alternating(5), null, 100_000)
    expect(plan.shouldSummarize).toBe(false)
  })

  /** MIN_BUDGET_FOR_MESSAGES 바닥 — 요약이 예산을 다 먹어도 컨텍스트는 남습니다. */
  it('예산이 0이어도 바닥값이 적용되어 컨텍스트가 남는다', () => {
    const zero = planCompaction(alternating(20), null, 0)
    const floor = planCompaction(alternating(20), null, 1_500)
    expect(zero.context.length).toBeGreaterThan(0)
    // 0과 바닥값(1500)이 같은 결과를 내야 합니다 — max()가 걸린 증거
    expect(zero.context.length).toBe(floor.context.length)
  })

  it('기존 요약이 있으면 그 비용을 메시지 예산에서 뺀다', () => {
    const msgs = alternating(20)
    const without = planCompaction(msgs, null, 5_000)
    const with_ = planCompaction(msgs, { summary: 'x'.repeat(2_000), coveredCount: 0 }, 5_000)
    expect(with_.context.length).toBeLessThanOrEqual(without.context.length)
  })

  it('nextCoveredCount는 covered + newlyCovered다', () => {
    for (const budget of [1_500, 3_000, 5_000, 100_000]) {
      for (const covered of [0, 3, 6]) {
        const plan = planCompaction(
          alternating(20),
          { summary: '요약', coveredCount: covered },
          budget
        )
        expect(plan.nextCoveredCount).toBe(plan.covered + plan.newlyCovered)
        expect(plan.covered).toBeLessThanOrEqual(20)
      }
    }
  })

  it('빈 메시지 배열에도 죽지 않는다', () => {
    const plan = planCompaction([], null, 1_000)
    expect(Array.isArray(plan.context)).toBe(true)
    expect(plan.shouldSummarize).toBe(false)
  })
})

describe('attachSummary', () => {
  const summary = '이전 대화에서 이름과 결정을 정했다'

  it('요약이 없으면 컨텍스트를 그대로 둔다', () => {
    const context = alternating(3)
    const plan = planCompaction(context, null, 100_000)
    expect(attachSummary(plan)).toEqual(context)
  })

  it('컨텍스트가 비었으면 요약 하나를 user로 넣는다', () => {
    const out = attachSummary({ ...planCompaction([], null, 0), summary })
    expect(out.length).toBe(1)
    expect(out[0].role).toBe('user')
    expect(out[0].content).toContain(summary)
  })

  /**
   * ★ 회귀 테스트 — gemini 400 재발 방지 ★
   *
   * ★ 이 함수가 깨지면 provider 선택만으로 채팅이 통째로 죽습니다 ★
   *
   * 앞이 assistant인 데 요약을 별도 메시지로 맨 앞에 끼우면 user가 연달아 갑니다.
   * OpenAI 호환(groq, openrouter)은 그냥 받아줍니다 — 그래서 provider를 바꿔도
   * 멀쩡하다가, gemini로 바꾸는 순간 400으로 대화가 끊깁니다.
   * 그래서 첫 user 메시지에 합칩니다.
   */
  it('★ 앞이 assistant여도 첫 메시지는 assistant가 아니다', () => {
    const context: LLMMessage[] = [
      { role: 'assistant', content: '이렇게 하죠' },
      { role: 'user', content: '네' },
    ]
    const out = attachSummary({ ...planCompaction([], null, 0), summary, context })
    expect(out[0].role).toBe('user')
    expect(out[0].content).toContain(summary)
  })

  it('★ 앞이 user면 첫 메시지에 합치고 길이는 그대로다', () => {
    const context: LLMMessage[] = [
      { role: 'user', content: '원래 첫 질문' },
      { role: 'assistant', content: '대답' },
      { role: 'user', content: '마지막' },
    ]
    const out = attachSummary({ ...planCompaction([], null, 0), summary, context })
    expect(out.length).toBe(3)
    expect(out[0].role).toBe('user')
    expect(out[0].content).toContain(summary)
    // 원래 첫 메시지의 내용이 살아 있어야 합니다 — 요약이 덮어버리면 안 됩니다
    expect(out[0].content).toContain('원래 첫 질문')
    // 뒤쪽은 손대지 않습니다
    expect(out[1]).toEqual(context[1])
    expect(out[2]).toEqual(context[2])
  })

  /** 실제 경로를 태워서 성립하는지 봅니다 (planCompaction → attachSummary). */
  it('★ 실제 압축 계획에 붙여도 첫 메시지가 assistant가 되지 않는다', () => {
    for (const n of [2, 5, 8, 10, 20]) {
      for (const budget of [500, 1_500, 3_000, 5_000, 100_000]) {
        const state: CompactionState = { summary, coveredCount: 0 }
        const out = attachSummary(planCompaction(alternating(n), state, budget))
        expect(out.length).toBeGreaterThan(0)
        expect(out[0].role).not.toBe('assistant')
      }
    }
  })

  it('원본 plan.context를 바꾸지 않는다', () => {
    const plan = planCompaction(alternating(6), null, 100_000)
    const before = JSON.stringify(plan.context)
    attachSummary(plan)
    expect(JSON.stringify(plan.context)).toBe(before)
  })

  it('요약문 블록이 눈에 보이게 표시된다', () => {
    const context: LLMMessage[] = [{ role: 'user', content: '질문' }]
    const out = attachSummary({ ...planCompaction([], null, 0), summary, context })
    expect(out[0].content).toContain('[이전 대화 요약]')
    expect(out[0].content).toContain(summary)
  })

  it('붙인 뒤에도 컨텍스트 전체가 예산 안에 들어간다 (근사치 기준)', () => {
    // 요약이 700자면 약 700토큰입니다 (MAX_SUMMARY_CHARS).
    const bigSummary = ko(700)
    const plan = planCompaction(alternating(20), { summary: bigSummary, coveredCount: 0 }, 5_000)
    const out = attachSummary(plan)
    const total = out.reduce((sum, m) => sum + estimateTokens(m.content), 0)
    // 요약 블록이 붙은 만큼 늘어나는 것은 맞지만, 무한정 늘어나지는 않습니다
    expect(total).toBeLessThan(estimateTokens(bigSummary) * 3 + 5_000)
  })
})