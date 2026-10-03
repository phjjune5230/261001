import { describe, it, expect } from 'vitest'
import { estimateTokens, keepRecentMessages, countDropped } from './context'

/**
 * 토큰 예산 계산의 테스트.
 *
 * ★ 왜 순수 함수만 ★
 * 여기서 다루는 함수는 DB도 LLM도 network도 건드리지 않습니다.
 * provider를 실제로 호출해야만 알 수 있는 게 아니라면, 그건 테스트가 아니라
 * 실험입니다. 느리고 돈 들고, provider마다 다르게 망합니다.
 *
 * ★ 왜 이게 위험한가 ★
 * 아래의 단언들은 전부 "조용히 실패하는" 것을 막습니다.
 * lint와 tsc는 "의도가 읽히는 코드"만 검사합니다. estimateTokens의 나누는
 * 수를 4에서 3으로 바꾸면 세 검사를 모두 통과하고, provider가 400을 내기까지
 * 아무도 알아차리지 못합니다. 실제로 2026-10-01 groq "Requested 46197" 사고가
 * 정확히 그 경로였습니다 (near-실측치가 근사의 3.8배).
 */

const ko = (n: number) => '가'.repeat(n)

describe('estimateTokens', () => {
  it('빈 문자열은 0이다', () => {
    expect(estimateTokens('')).toBe(0)
  })

  /**
   * ★ 회귀 테스트 — 이게 이 파일에서 제일 중요합니다 ★
   *
   * 한글은 글자당 거의 1토큰입니다. "4글자 ≈ 1토큰" 규칙으로 나누면
   * 4배씩 과소평가되고, 예산 가드가 조용히 무력화됩니다.
   *
   * 4로 나누거나 3으로 나누거나 5로 나누거나, 결과는 N/4·N/3·N/5입니다.
   * N인 경우는 딱 하나뿐입니다 — 나눗셈을 지운 경우.
   * 이 단언이 깨졌다는 것은 곧 예산이 무력화되었다는 뜻입니다.
   */
  it('★ 한글은 글자당 1토큰으로 센다 (나눗셈이 돌아오면 무너진다)', () => {
    for (const n of [1, 100, 1_000, 3_000, 8_000]) {
      expect(estimateTokens(ko(n))).toBe(n)
    }
  })

  it('영문은 4글자에 1토큰으로 센다', () => {
    expect(estimateTokens('a')).toBe(1) // ceil(0.25)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('한자와 일본어도 CJK로 센다', () => {
    expect(estimateTokens('漢')).toBe(1)
    expect(estimateTokens('あ')).toBe(1)
    // 한글 자모도 같은 취급이어야 합니다 (읽을 때 붙는 글자이므로)
    expect(estimateTokens('ㄱ')).toBe(1)
  })

  it('한글과 영문이 섞여도 각자 계산한 값을 더한다', () => {
    // 3글자 한글(가나다) + 8글자 영문 = 3 + 8/4 = 5
    expect(estimateTokens('가나다abcdefgh')).toBe(5)
    // 한글이 늘수록 영문 쪽 몫이 줄고, 합계는 곧 한글 쪽에 수렴합니다
    expect(estimateTokens('가나다라마abcdefgh')).toBe(7)
  })

  /**
   * 이모지는 CJK로 세지 않습니다. 서로게이트 페어라 두 칸을 건너뛰고,
   * 대신 남은 문자열 길이에 /4가 적용됩니다 — 즉 이모지 1개당 1토큰쯤입니다.
   * 이 앱에서 이모지가 예산을 좌우하지는 않으므로 그대로 둡니다.
   * (한글로 오해해서 CJK 분기에 들어가는 것만 막으면 됩니다.)
   */
  it('이모지는 CJK로 세지 않는다', () => {
    const s = '😀😀'
    expect(s.length).toBe(4) // UTF-16 코드 단위로는 4
    expect(estimateTokens(s)).toBe(1) // ceil(4/4)
  })

  it('길수록 값이 줄지 않는다', () => {
    let prev = 0
    for (const n of [1, 10, 100, 1_000, 5_000]) {
      const v = estimateTokens(ko(n))
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('0을 넘지 않는다', () => {
    for (const s of ['', ' ', '\n', 'a', '가']) {
      expect(estimateTokens(s)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('keepRecentMessages', () => {
  type M = { role: string; content: string }

  const alternating = (n: number): M[] =>
    // 0번이 user, 1번이 assistant, ...
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: ko(1_000),
    }))

  it('빈 배열은 그대로 반환한다', () => {
    expect(keepRecentMessages([], 100)).toEqual([])
  })

  it('예산 안이면 아무것도 버리지 않는다', () => {
    const m = alternating(4) // 4,000 토큰
    const kept = keepRecentMessages(m, 10_000)
    expect(kept.length).toBe(4)
    expect(estimateTokens(kept[0].content)).toBe(1_000)
  })

  it('예산을 넘으면 최근 쪽만 남긴다', () => {
    const m = alternating(10) // 10,000 토큰
    const kept = keepRecentMessages(m, 2_500)
    expect(kept.length).toBeLessThan(10)
    // 뒤에서부터 남겨야 하므로 마지막 메시지는 반드시 살아 있습니다
    expect(kept[kept.length - 1].content).toBe(m[m.length - 1].content)
  })

  /**
   * ★ 회귀 테스트 — 남은 첫 메시지가 assistant면 안 됩니다 ★
   *
   * 순서만 보고 자르면 요청-응답 쌍이 중간에서 갈라집니다. 그렇게 남은
   * "응답만 있는 상태"를 OpenAI 호환 provider는 그냥 받아줍니다 — 그래서
   * 조용히 이상한 답이 나오고 원인이 보이지 않습니다. Gemini는 400입니다.
   *
   * 예산이 이미 충분해도 경계가 assistant에 걸렸다면 한 번 더 버려야 합니다.
   */
  it('★ 남은 첫 메시지는 assistant가 아니다', () => {
    for (const n of [2, 5, 8, 10, 20]) {
      for (let budget = 500; budget <= 6_000; budget += 250) {
        const kept = keepRecentMessages(alternating(n), budget)
        if (kept.length > 1) {
          expect(kept[0].role).not.toBe('assistant')
        }
      }
    }
  })

  /** 위 규칙 때문에 assistant로 시작하게 된 배열도 잡아냅니다. */
  it('★ 경계가 assistant여서 한 개 더 버린 경우를 실제로 만든다', () => {
    // 번갈아 오는 8개에서 idx5는 assistant, idx6은 user, idx7은 assistant.
    // 예산 3,000이면 idx5·idx6·idx7 세 개(3,000 토큰)가 예산 안에 들어가지만,
    // 경계(idx5)가 assistant이므로 한 개 더 버려야 2개가 남습니다.
    // role 규칙이 없으면 3개가 남습니다 — 그래서 2인지 3인지가 이 테스트입니다.
    const kept = keepRecentMessages(alternating(8), 3_000)
    expect(kept.length).toBe(2)
    expect(kept[0].role).toBe('user')
    expect(kept[1].role).toBe('assistant')
  })

  /**
   * ★ 메시지가 하나만 남으면 role이 assistant여도 남깁니다 ★
   * 여기서 남긴 첫 메시지가 assistant인 예외가 있습니다 — 위 속성이
   * "길이가 1이면 예외"로 걸러 둔 이유입니다. 이 예외는 의도입니다.
   * 마지막 메시지를 버리면 모델이 받을 것이 없어 요청이 실패합니다.
   */
  it('★ 메시지 하나만 남으면 role과 무관하게 남긴다 (의도된 예외)', () => {
    const one: M[] = [{ role: 'user', content: ko(1_000) }]
    expect(keepRecentMessages(one, 1).length).toBe(1)

    const lastIsAssistant: M[] = [
      { role: 'user', content: ko(1_000) },
      { role: 'assistant', content: ko(1_000) },
    ]
    const kept = keepRecentMessages(lastIsAssistant, 1)
    expect(kept.length).toBe(1)
    expect(kept[0].role).toBe('assistant') // 이 한 건만 예외
  })

  it('맨 앞의 system 메시지는 절대 버리지 않는다', () => {
    const m: M[] = [
      { role: 'system', content: ko(100) },
      ...alternating(10),
    ]
    for (let budget = 500; budget <= 6_000; budget += 500) {
      const kept = keepRecentMessages(m, budget)
      expect(kept[0].role).toBe('system')
      expect(kept[0].content).toBe(ko(100))
    }
  })

  it('버린 후에도 최근 순서가 유지된다', () => {
    // contents를 다르게 둬야 "어느 메시지였나"를 찾을 수 있습니다.
    // 전부 같은 문자열이면 findIndex가 맨 앞을 계속 반환해 이 검사가 무의미해집니다.
    const m: M[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `${i}: ${ko(1_000)}`,
    }))
    const kept = keepRecentMessages(m, 3_000)
    const indices = kept.map(k => m.findIndex(o => o.content === k.content))
    expect(indices.length).toBe(kept.length)
    expect(indices.every(i => i >= 0)).toBe(true)
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1])
    }
  })

  it('예산이 0이거나 음수여도 배열이 비지 않는다', () => {
    const m = alternating(6)
    for (const budget of [0, -1, -100]) {
      expect(keepRecentMessages(m, budget).length).toBeGreaterThan(0)
    }
  })
})

describe('countDropped', () => {
  it('버린 개수를 센다', () => {
    expect(countDropped(10, 4)).toBe(6)
    expect(countDropped(5, 5)).toBe(0)
  })

  /** kept가 original보다 클 수는 없으므로 음수가 새면 안 됩니다. */
  it('★ 음수를 내지 않는다', () => {
    expect(countDropped(4, 10)).toBe(0)
    expect(countDropped(0, 0)).toBe(0)
    expect(countDropped(0, 100)).toBe(0)
  })

  it('항상 0 이상의 정수다', () => {
    for (let a = 0; a <= 30; a++) {
      for (let b = 0; b <= 30; b++) {
        const d = countDropped(a, b)
        expect(Number.isInteger(d)).toBe(true)
        expect(d).toBeGreaterThanOrEqual(0)
      }
    }
  })
})