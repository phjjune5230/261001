/**
 * ============================================================================
 *  영어 학습 세션 — 타입 / 시스템 프롬프트 / 응답 파서
 * ============================================================================
 *
 *  왜 이렇게 나눴나:
 *    OLD는 이 로직이 한 500줄짜리 컴포넌트 안에 박혀 있어서 "무엇이 계약이고
 *    무엇이 화면인가"가 구분되지 않았다. 여기서는 둘을 나눈다.
 *      - lib/lesson.ts   계약 (타입 · 프롬프트 · 파서) — 서버/클라이언트 공용
 *      - app/english/    화면
 *    계약이 바뀌면 파서가 바뀌고, 화면은 안 건드린다.
 *
 *  OLD에서 가져온 것은 **컨셉 둘뿐**이다 (코드는 이식하지 않는다):
 *    1. 모델이 한 줄 답변이 아니라 *구조화된 문서*를 반환한다
 *    2. 화면 전용 메시지(번역 예문 등)는 다음 API 호출에 넣지 않는다
 *
 *  ── v0.8.0에서 무엇이 바뀌었나 ────────────────────────────────────────────
 *  · Phase(단계)와 PHASE_LABEL을 **삭제했습니다.**
 *    프롬프트가 부탁했을 뿐 강제되지 않은 흐름을 헤더 배지로 표시했는데,
 *    그 배지가 거짓말을 했습니다 (docs/10-english-guide.md §8).
 *    흐름은 시나리오와 사용자 발화가 만듭니다.
 *  · 교정을 말미로 미루었습니다. MAX_LIVE_CORRECTIONS로 개수를 **코드가** 자릅니다.
 *  · 교정(corrections)과 배운 표현(chunks)은 따로 쌓입니다.
 *    이 파일의 타입이 그대로 supabase/add-english-learning.sql의 정본이 됩니다.
 *
 *  ── 아직 하지 않는 것 ───────────────────────────────────────────────────
 *    STT(음성 입력). 브라우저 SpeechRecognition은 Chrome 한정이고 오인식이 잦아
 *    보류했습니다 (사용자 결정 2026-10-02). "기계가 이렇게 들었다" 형태로
 *    표면화하는 대안이 남아 있습니다.
 *    반복 간격 정책. 기록만 쌓아 두고 언제 꺼낼지는 계측 뒤에 정합니다.
 */

/**
 * 학습 형식.
 *
 * 예전에는 `example` / `output_prompt` 둘뿐이었습니다. 그건 형식이 둘뿐이라는
 * 뜻이 아니라 **프롬프트에 둘만 적어뒀을 뿐**입니다 (docs/10-english-guide.md §8).
 *
 * `phrase`(연결·완충 표현)를 셋째로 둡니다. "So…", "Let me get back to you on
 * that" 같은 것은 예문이라 부르기엔 어색하고 그렇다고 연습 문장이라 부를 것도
 * 아닙니다. 그런데 목표 2번(연결과 완충)은 이걸로 실려 나갑니다
 * (docs/10-english-guide.md §2). 두 분법으로는 그 항목을 표현할 수 없었습니다.
 */
export const STEP_TYPES = ['example', 'phrase', 'prompt'] as const
export type StepType = (typeof STEP_TYPES)[number]

export type LessonStep = {
  type: StepType
  /** 화자. 롤플레이면 'A' / 'B', 예문 학습이면 'A' 하나. */
  speaker: string
  /** 영어 문장. */
  text: string
  /** 한국어 번역. */
  translation: string
  /** prompt일 때만 — 이 문장을 왜 쓰는지 한 줄. */
  hint?: string
}

/**
 * 오류 분류 — 8개로 고정합니다.
 *
 * 자유 텍스트 사유로 두지 않는 이유: "지금 무엇을 연습할지"를 결정하려면
 * 분류가 비교 가능해야 합니다. 사유가 자유 문장이면 세 개를 나란히 놓았을 때
 * "이 셋은 같은 것인가"를 판단할 수 없습니다.
 *
 * 값이 여기로부터 나옵니다. supabase/add-english-learning.sql의 check constraint와
 * 같은 목록이므로 **한쪽만 고치지 마세요** — 코드와 DB가 어긋나면 insert가 조용히
 * 실패합니다 (lib/db.ts의 saveEnglishRecords가 실패를 삼키기 때문에 조용해집니다).
 */
export const ERROR_CATEGORIES = [
  'tense',
  'article',
  'preposition',
  'word_order',
  'agreement',
  'connector',
  'lexical_choice',
  'other',
] as const
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number]

export const ERROR_CATEGORY_LABEL: Record<ErrorCategory, string> = {
  tense: '시제',
  article: '관사',
  preposition: '전치사',
  word_order: '어순',
  agreement: '일치',
  connector: '연결 표현',
  lexical_choice: '어휘 선택',
  other: '기타',
}

/**
 * 말하고 있는 문장에서 내가 한 가지로 틀린 것.
 *
 * 원문 / 수정 / 사유 / 분류 네 칸이 다 있어야 합니다. 분류가 비면 "무엇을
 * 연습할지"가 결정되지 않고, 사유가 비면 나중에 왜 그랬는지 볼 수 없습니다.
 */
export type LessonCorrection = {
  original: string
  corrected: string
  /** 한국어 한 줄. */
  reason: string
  category: ErrorCategory
}

/**
 * 마무리 요약.
 *
 * ★ "내가 틀린 것"은 여기에 없습니다 ★
 * 세션 내내 모은 `LessonTurn.corrections`가 정본입니다. 요약에도 넣으면
 * 같은 정보가 두 곳에 생기고 어느 쪽이 옳은지 어긋납니다 (docs/RULE.md §2).
 * 화면은 누적 corrections를 "내가 틀린 것"으로 보여줍니다.
 */
export type LessonSummary = {
  /** 오늘 이 세션을 한 줄로. */
  headline: string
  /** 오늘 실제로 쓴 표현. */
  expressions: { phrase: string; meaning: string }[]
  /** 다음에 연습할 것. 회고일 뿐이라 확정된 계획을 만들지 않습니다. */
  next: string[]
}

/** 화면이 그리는 단위. */
export type LessonTurn = {
  content: string
  steps: LessonStep[]
  corrections: LessonCorrection[]
  /** 마무리 요청에서만 채워집니다. 평소엔 null. */
  summary: LessonSummary | null
}

/** 모델이 실제로 돌려주어야 하는 JSON 형태. */
type RawLessonResponse = {
  content?: string
  steps?: unknown[]
  corrections?: unknown[]
  summary?: unknown
}

const VALID_STEP_TYPES: StepType[] = [...STEP_TYPES]

/**
 * 턴당 즉시 교정 개수 상한.
 *
 * ★ 이 값은 프롬프트가 아니라 **코드가 자릅니다** ★
 * 프롬프트에 "많이 하지 마세요"라고 적는 것은 부탁이지 규칙이 아닙니다.
 * 기존 프롬프트는 "지금 바로 고쳐 주세요"라고 *요구*했는데 모델이 안 들을 수
 * 있었다면, 반대 방향의 부탁도 안 들을 수 있습니다. 그래야 보장됩니다
 * (parseLessonResponse이 이 값으로 자릅니다).
 *
 * 왜 1이고 0이 아니냐:
 *   0이면 "이해되지 않는 오류만 즉시 짚는다"는 규칙이 발화할 일이 없어집니다.
 *   규칙을 실제로 살리면서도 거의 하지 않으려면 1이 최소입니다.
 *   (사용자 결정 2026-10-02 — 보수적으로 시작하되 규칙은 죽이지 않는다)
 *
 * 높이고 싶어지면 2가 그 다음 값입니다. 계측 없이 더 올리는 것은 아닙니다.
 */
export const MAX_LIVE_CORRECTIONS = 1

/**
 * 학습자 기준 — 서버 상수입니다.
 *
 * 화면에서 수준·목표를 고르던 UI를 걷어냈습니다 (사용자 결정 2026-10-02).
 * CEFR 레벨 선택 UI는 "지금 수준은 이미 알고 있고, 선택지가 되돌 제약이 된다"
 * 는 이유였습니다 (docs/10-english-guide.md §2). 선택지를 없애면서 프롬프트에서
 * 수준 정보까지 지우면 모델이 초급에게도 원어민에게도 같은 말을 하므로,
 * 값은 서버에 고정합니다.
 *
 * 여기 있는 이유를 기억할 것: 이건 사용자 입력값이 아니라 **판단**입니다.
 * 수준이 바뀌면 이 상수만 고칩니다.
 */
export const LEARNER_BASELINE =
  '수준: B1 (초중급). 초중학생 수준 대화가 됩니다. 문법 용어를 쓰지 마세요.\n' +
  '목표: 해외 고객과의 비즈니스 대화를 유창하게 이어가는 것.'

/**
 * 연습할 상황.
 *
 * 세션 시작 화면에서 하나를 고릅니다. **직접 입력도 됩니다** — 실제로
 * 만나게 될 상황은 우리가 미리 알 수 없으므로, 이 목록은 시작점일 뿐
 * 고정된 선택지가 아닙니다 (사용자 결정 2026-10-02).
 *
 * brief는 프롬프트에 붙는 영어 한 줄입니다. 한국어 라벨과 영어 지시를
 * 둘 다 두는 이유: 모델은 영어로 지시를 읽는 쪽이 훨씬 잘 따릅니다.
 */
export type Scenario = {
  id: string
  label: string
  brief: string
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'greeting',
    label: '처음 만났을 때',
    brief: 'Introduce yourself and your company in 30 seconds.',
  },
  {
    id: 'smalltalk',
    label: '잡담으로 분위기 풀기',
    brief: 'Make small talk and keep the conversation going.',
  },
  {
    id: 'explaining',
    label: '내 생각 설명하기',
    brief: 'Explain your idea, opinion, or plan in plain business English.',
  },
  {
    id: 'clarifying',
    label: '못 알아들어 다시 물어보기',
    brief: 'Ask the other side to repeat, slow down, or clarify.',
  },
  {
    id: 'disagreeing',
    label: '다르게 생각한다고 말하기',
    brief: 'Politely disagree and push back without offending anyone.',
  },
  {
    id: 'price',
    label: '가격이 비싸다고 말하기',
    brief: 'Say the price is too high and try to negotiate.',
  },
  {
    id: 'scheduling',
    label: '일정 조율하기',
    brief: 'Schedule, reschedule, or decline a meeting politely.',
  },
  {
    id: 'followup',
    label: '회신이 없어 독촉하기',
    brief: 'Follow up on an unanswered message without sounding pushy.',
  },
  {
    id: 'problem',
    label: '문제 신고하고 해결 요청하기',
    brief: 'Report a problem and ask for a fix.',
  },
  {
    id: 'interview',
    label: '내 면접 답변 준비하기',
    brief: 'Answer interview questions about your experience.',
  },
]

/**
 * 시스템 프롬프트.
 *
 * ── 설계 노트 ──────────────────────────────────────────────────────────────
 *  1. `json` 이 단어를 반드시 포함한다. OpenAI 호환 엔드포인트는 JSON 모드일 때
 *     프롬프트에 "json"이 없으면 400을 낸다 (lib/llm.ts의 jsonMode 참고).
 *     이 문장을 고치면서 이 단어를 잃지 마세요.
 *
 *  2. **단계(phase)를 없습니다.** 예전 프롬프트는 "한 단계씩 진행하세요"로
 *     흐름을 부탁했는데 jsonMode는 순서와 양을 강제하지 않습니다. 강제되지
 *     않는 흐름을 화면에 배지로 찍고 있었고, 그 배지가 거짓말이었습니다
 *     (docs/10-english-guide.md §8). 흐름은 시나리오와 사용자 발화가 만듭니다.
 *
 *  3. 우선순위를 명시했습니다 (docs/RULE.md §6 — 판단은 코드 주석에).
 *     충돌하면 앞의 것이 이깁니다:
 *       ① 형식(정확한 JSON)  ② 유창함과 대화 흐름  ③ 정확성
 *     ①이 이기는 건 형식을 깨면 파서가 아무것도 못 하기 때문입니다.
 *     ②가 ③을 이기는 건 교정을 말미로 미루는 이 기능의 존재 이유입니다.
 */
export const LESSON_SYSTEM_PROMPT = `당신은 개인 영어 연습 상대입니다. 한국어로 설명하고, 영어 예문은 언제나 자연스러운 영어로 씁니다.

## 학습자
${LEARNER_BASELINE}

## ★ 교정은 세션 말미로 미룹니다 ★
대화 중에는 **이해되지 않는 오류**만 즉시 짚습니다. 발화를 막거나 흐름을 끊는
교정은 하지 않습니다. 어색한 문장, 작은 시제 착오, 관사 누락은 지금은 보류하고
마무리에서 한꺼번에 봅니다.

이유: 학습자가 동시에 하는 두 가지 — 말하려던 내용을 유지하는 일과 문장 형태를
고치는 일 — 중 전자가 줄면 이 연습은 정확성 수업이 되어버립니다. 우리가 만드는
것은 유창함입니다.

즉시 교정은 한 턴에 ${MAX_LIVE_CORRECTIONS}건 이하로, 진짜 못 알아들 것 같을 때만 씁니다.
(모델의 성의에 의존하지 않습니다. 서버가 개수를 잘라냅니다.)

## 반드시 지킬 것
- 한국어 설명과 영어 예문을 섞지 마세요. 설명은 한국어, 영어 예문은 영어.
- 예문에는 한국어 번역을 붙이되, 모든 예문에 다 붙이지 마세요.
  학습자가 **직접 말해보는 순간의 예문에만** 붙입니다. 나머지는 영어만 둡니다.
- 한 응답은 150단어를 넘기지 마세요. 대화는 여러 턴에 나눕니다.
- 주제를 그만두지 마세요. 사용자가 다음 말을 이어갈 틈을 항상 남겨두세요.

## 마무리 요청이 왔을 때
이번 응답은 평소와 다릅니다. 사용자가 세션을 마무리하라고 요청했습니다.
- steps는 비워도 됩니다. 오늘 실제로 쓴 표현만 summary에 모으세요.
- "내가 틀린 것"을 summary에 쓰지 마세요. 그건 세션 내내 따로 쌓입니다.

## 응답 형식
반드시 아래 json 형식으로만 답하세요. 마크다운 코드펜스로 감싸지 마세요.
\`\`\`json
{
  "content": "한국어로 쓴 설명, 질문, 짧은 피드백",
  "steps": [
    {
      "type": "example | phrase | prompt 중 하나",
      "speaker": "A",
      "text": "영어 문장",
      "translation": "한국어 번역 — prompt일 때만, 나머지는 빈 문자열",
      "hint": "type이 prompt일 때만 — 왜 이 문장을 쓰는지 한 줄"
    }
  ],
  "corrections": [
    {
      "original": "내가 쓴 영어 문장",
      "corrected": "고쳐진 영어 문장",
      "reason": "왜 틀렸는지 한국어 한 줄",
      "category": "tense | article | preposition | word_order | agreement | connector | lexical_choice | other"
    }
  ],
  "summary": null
}
\`\`\`

마무리 요청이 왔을 때만 summary를 아래처럼 채우세요. 그 외에는 반드시 null입니다.
\`\`\`json
"summary": {
  "headline": "오늘 이 세션을 한 줄로",
  "expressions": [ { "phrase": "영어 구", "meaning": "한국어 뜻" } ],
  "next": ["다음에 연습할 것"]
}
\`\`\`

응답은 오직 이 JSON 객체만 출력해야 합니다. 앞뒤에 설명을 붙이지 마세요.`

/**
 * 마무리 요청 지시.
 *
 * 마무리 버튼을 누른 순간 라우트가 대화 끝에 붙입니다.
 *
 * ★ Gemini는 역할을 번갈아 요구합니다 ★
 * 마지막 메시지가 이미 user면(user가 보낸 직후) 이걸 또 붙여 두 개의 user가
 * 연달아 가고 400을 받습니다. 라우트가 마지막 역할 확인하고 조건부로 붙입니다
 * (app/api/english/route.ts).
 */
export const FINISH_INSTRUCTION =
  '[세션 마무리] 이제 오늘 연습을 정리해 줘요. ' +
  '아래 규칙대로 마무리 요약을 출력하고, 이번 응답 뒤로는 다음 주제를 계속 꺼내지 마세요.'

/** 파싱 실패·깨진 값에 대한 공통 반환값. 빈 턴으로 떨어뜨립니다. */
function emptyTurn(fallback: string): LessonTurn {
  return {
    content: fallback.trim() || '응답을 해석하지 못했습니다.',
    steps: [],
    corrections: [],
    summary: null,
  }
}

/**
 * 모델 응답 파서.
 *
 * 실패를 절대 던지지 않는다 — 영어 기능에서 파싱 오류가 났다는 이유로
 * 500을 띄우는 건 사용자에게 아무 도움도 안 되는 화면이다.
 * 못 파싱하면 content만 통과시키고 나머지는 비운 값을 돌려줍니다.
 *
 * ★ 한 가지 강제가 여기 있습니다: 교정 개수 ★
 * MAX_LIVE_CORRECTIONS로 자릅니다. 프롬프트에 "많이 하지 마세요"라고 적어도
 * 지킬 책임이 없는 이상으로 나가면 대화가 교정 위주로 뒤집힙니다 — 그게
 * 이 기능이 없애려고 하는 바로 그 구조이기 때문입니다.
 *
 * 잘라낼 때는 **앞에서부터** 남깁니다. 뒤를 자르면 화면의 말풍선 순서와
 * 어긋나 "이 교정이 언제 나왔나"를 잃습니다.
 */
export function parseLessonResponse(raw: string): LessonTurn {
  const jsonText = extractJson(raw)
  if (!jsonText) return emptyTurn(raw)

  let parsed: RawLessonResponse
  try {
    parsed = JSON.parse(jsonText) as RawLessonResponse
  } catch {
    return emptyTurn(raw)
  }

  const steps: LessonStep[] = []
  if (Array.isArray(parsed.steps)) {
    for (const s of parsed.steps) {
      const step = coerceStep(s)
      if (step) steps.push(step)
    }
  }

  const corrections: LessonCorrection[] = []
  if (Array.isArray(parsed.corrections)) {
    for (const c of parsed.corrections) {
      const correction = coerceCorrection(c)
      if (correction) corrections.push(correction)
    }
  }

  return {
    content: typeof parsed.content === 'string' ? parsed.content : '',
    steps,
    corrections: corrections.slice(0, MAX_LIVE_CORRECTIONS),
    summary: coerceSummary(parsed.summary),
  }
}

function coerceStep(raw: unknown): LessonStep | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const text = typeof r.text === 'string' ? r.text.trim() : ''
  // 영어 문장이 없는 step은 의미가 없다. 번역만 도는 항목을 걸러낸다.
  if (!text) return null

  const type = VALID_STEP_TYPES.includes(r.type as StepType)
    ? (r.type as StepType)
    : 'example'

  return {
    type,
    speaker: typeof r.speaker === 'string' && r.speaker ? r.speaker : 'A',
    text,
    translation: typeof r.translation === 'string' ? r.translation : '',
    ...(typeof r.hint === 'string' && r.hint ? { hint: r.hint } : {}),
  }
}

/**
 * 교정 한 건.
 *
 * category는 화이트리스트로 검증합니다. 모델이 목록에 없는 값을 주면
 * 'other'로 떨어집니다. 그래야 supabase의 check constraint를 만족하고,
 * 나중에 "지금 무엇을 연습할지"를 정할 때 비교 가능한 값만 남습니다
 * (ERROR_CATEGORIES의 주석 참고).
 *
 * 네 칸 중 하나라도 비면 버립니다 — 부분적으로 채워진 오류 기록은
 * 화면에 "원문만 있고 고쳐진 버전이 없는" 항목으로 남고, 그게 더 산만합니다.
 */
function coerceCorrection(raw: unknown): LessonCorrection | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const original = typeof r.original === 'string' ? r.original.trim() : ''
  if (!original) return null

  const corrected = typeof r.corrected === 'string' ? r.corrected.trim() : ''
  if (!corrected) return null

  const reason = typeof r.reason === 'string' ? r.reason.trim() : ''
  if (!reason) return null

  return {
    original,
    corrected,
    reason,
    category: ERROR_CATEGORIES.includes(r.category as ErrorCategory)
      ? (r.category as ErrorCategory)
      : 'other',
  }
}

/** 마무리 요약. 없으면 null입니다 — 평소 턴에 빈 객체가 붙으면 안 됩니다. */
function coerceSummary(raw: unknown): LessonSummary | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>

  const expressions: { phrase: string; meaning: string }[] = []
  if (Array.isArray(r.expressions)) {
    for (const e of r.expressions) {
      if (typeof e !== 'object' || e === null) continue
      const er = e as Record<string, unknown>
      const phrase = typeof er.phrase === 'string' ? er.phrase.trim() : ''
      if (!phrase) continue
      expressions.push({
        phrase,
        meaning: typeof er.meaning === 'string' ? er.meaning : '',
      })
    }
  }

  const next: string[] = []
  if (Array.isArray(r.next)) {
    for (const n of r.next) {
      if (typeof n === 'string' && n.trim()) next.push(n.trim())
    }
  }

  // 표현도 다음 할 일도 비면 요약이라 할 것이 없습니다. 실패로 다루지 않습니다.
  if (expressions.length === 0 && next.length === 0) return null

  return {
    headline: typeof r.headline === 'string' ? r.headline.trim() : '',
    expressions,
    next,
  }
}

/**
 * 모델이 코드펜스로 감쌀 때가 있다. JSON 모드가 실패한 경우에 해당한다.
 * 첫 { 부터 마지막 } 까지만 잘라내 재시도를 한 번 시도한다.
 */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) return trimmed

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return trimmed.slice(start, end + 1)
}

const STEP_LABEL: Record<StepType, string> = {
  example: '예문',
  phrase: '연결 표현',
  prompt: '연습',
}

/**
 * 다음 턴에 보낼 assistant 메시지 문자열.
 *
 * 이것이 OLD의 "화면 전용 메시지는 다음 API 호출에 넣지 않는다" 규칙이다.
 * steps를 통째로 직렬화하면 JSON 키가 매번 반복되어 토큰만 낭비된다.
 * 모델이 "내가 이미 무엇을 말했는지" 알 수 있을 만큼만 압축한다.
 *
 * ★ 교정을 반드시 포함합니다 ★
 * 이미 짚은 오류를 다음 턴에서 또 짚으면 교정이 반복됩니다. 대화 중 교정은
 * 예산 때문에 드물게 일어나는데, 그래도 한 번 나오면 모델이 기억해야 합니다.
 *
 * ★ phase 태그는 사라졌습니다 ★
 * 예전 형식의 턴(구버전 DB에 저장된 것)에 대해서도 이 함수가 그대로 쓸 수
 * 있어야 하므로 phase를 읽지 않습니다. meta에 예전 값이 남아 있어도 무해합니다.
 */
export function turnToHistoryText(turn: LessonTurn): string {
  const parts: string[] = []

  if (turn.content) parts.push(turn.content)

  for (const step of turn.steps) {
    parts.push(`· ${STEP_LABEL[step.type]} <${step.speaker}> ${step.text} — ${step.translation}`)
  }

  for (const c of turn.corrections) {
    parts.push(`· 이미 짚은 오류: ${c.original} → ${c.corrected} (${c.reason})`)
  }

  if (turn.summary) {
    parts.push(`· 마무리: ${turn.summary.headline}`)
    for (const e of turn.summary.expressions) {
      parts.push(`  - ${e.phrase} — ${e.meaning}`)
    }
  }

  return parts.join('\n')
}

/**
 * 세션 내내 모인 교정을 시간순으로 합칩니다.
 *
 * ★ 이것이 "내가 틀린 것"의 유일한 출처입니다 ★
 * 마무리 요약에도 교정을 넣지 않습니다 (LessonSummary의 주석 참고).
 * 같은 정보가 두 곳에 있으면 어느 쪽이 맞는지 어긋납니다 (docs/RULE.md §2).
 *
 * 그대로 이어 붙입니다. 같은 실수를 두 번 하면 두 건으로 남고, 그게 사실입니다.
 * 중복을 지우면 "반복 횟수"라는 정보가 사라집니다.
 */
export function collectCorrections(turns: LessonTurn[]): LessonCorrection[] {
  const all: LessonCorrection[] = []
  for (const turn of turns) {
    for (const c of turn.corrections) all.push(c)
  }
  return all
}

/**
 * 말미 요약에서 오늘 실제로 쓴 표현을 모읍니다.
 *
 * ★ 중복 제거가 필요합니다 ★
 * 같은 표현을 summary와 steps 양쪽에서 받으면 한 세션 안에 두 번 나옵니다.
 * 이 표시는 "오늘 몇 가지나 늘었나"를 보여주는 자리라서 중복이 곧 잘못된 수치입니다.
 * 대소문자만 다른 경우도 같은 표현으로 봅니다.
 */
export function collectExpressions(turn: LessonTurn | null): { phrase: string; meaning: string }[] {
  const seen = new Set<string>()
  const out: { phrase: string; meaning: string }[] = []

  for (const step of turn?.steps ?? []) {
    if (step.type === 'example') continue
    const key = step.text.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ phrase: step.text.trim(), meaning: step.translation })
  }

  for (const e of turn?.summary?.expressions ?? []) {
    const key = e.phrase.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }

  return out
}
