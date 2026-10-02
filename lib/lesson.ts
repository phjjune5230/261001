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
 *  ── 아직 하지 않는 것 ───────────────────────────────────────────────────
 *    세션 저장(DB 없음). 새로고침하면 처음부터. 2단계.
 *    STT(음성 입력). 브라우저 SpeechRecognition은 Chrome 한정이라 2단계.
 */

/**
 * 말풍선 한 개의 종류.
 *   text           — 그냥 텍스트. 설명, 질문, 피드백.
 *   example        — 학습자가 읽을 예문 + 번역. 🔊 버튼이 붙는다.
 *   output_prompt  — 학습자가 직접 말해볼 문장. 🎙 대신 🔊 버튼 + "이렇게 말해 보세요" 라벨.
 */
export type StepType = 'example' | 'output_prompt'

export type LessonStep = {
  type: StepType
  /** 화자. 롤플레이면 'A' / 'B', 예문 학습이면 'A' 하나. */
  speaker: string
  /** 영어 문장. */
  text: string
  /** 한국어 번역. */
  translation: string
  /** output_prompt일 때만 — 이 문장을 왜 쓰는지 한 줄. */
  hint?: string
}

export type Phase = 'intro' | 'examples' | 'roleplay' | 'output' | 'summary'

export const PHASE_LABEL: Record<Phase, string> = {
  intro: '도입',
  examples: '예문 학습',
  roleplay: '역할놀이',
  output: '직접 말하기',
  summary: '마무리',
}

/** 화면이 그리는 단위. */
export type LessonTurn = {
  phase: Phase
  content: string
  steps: LessonStep[]
}

/** 모델이 실제로 돌려주어야 하는 JSON 형태. */
type RawLessonResponse = {
  phase?: string
  content?: string
  steps?: unknown[]
}

const VALID_PHASES: Phase[] = ['intro', 'examples', 'roleplay', 'output', 'summary']
const VALID_STEP_TYPES: StepType[] = ['example', 'output_prompt']

/**
 * 시스템 프롬프트.
 *
 * 설계 노트:
 *   - `json` 이 단어를 반드시 포함한다. OpenAI 호환 엔드포인트는 JSON 모드일 때
 *     프롬프트에 "json"이 없으면 400을 낸다 (lib/llm.ts의 jsonMode 참고).
 *   - 단계 수는 *범위*로 준다. 정확한 개수를 강제하면 모델이 억지로 채운다.
 *   - "직접 말하기" 이전에 마무리로 넘어가지 말라고 못박는다. 이게 없으면
 *     모델이 두 번 교환하고 바로 "수고하셨습니다"를 Says한다.
 */
export const LESSON_SYSTEM_PROMPT = `당신은 개인 영어 학습 튜터입니다. 한국어로 설명합니다.

상대방의 실력과 목표에 맞춰 한 번에 한 단계씩 진행하세요.

## 세션 흐름
1. intro      — 실력/목표를 물어보고 오늘 다룰 내용을 한두 줄로 제시
2. examples   — 핵심 표현 3~5개를 "예문 + 번역"으로. 짧고 실제로 쓸 만한 문장
3. roleplay   — 상황이 주어진 4~6턴짜리 대화. 한 번에 화자 A와 B의 발언을 함께
4. output     — 학습자가 직접 말해볼 문장 2~3개. 각 문장마다 왜 쓰는지 한 줄
5. summary    — 오늘 배운 표현을 다시 보고 다음 연습을 제안

사용자가 output 단계에 자기 문장을 말하기 전에는 절대 summary로 넘어가지 마세요.
사용자가 준비되었다고 하기 전까지 예문을 더 내더라도 됩니다.

## 반드시 지킬 것
- 모든 영어 문장에는 반드시 한국어 번역을 붙이세요.
- 한국어 설명을 섞더라도 영어 예문 자체는 자연스러운 영어여야 합니다.
- 너무 길지 않게. 한 응답에 150단어를 넘기지 마세요.
- 사용자가 틀린 문장을 썼다면 한국어로 왜 틀렸는지 알려주고 올바른 버전을 제시하세요.

## 응답 형식
반드시 아래 JSON 형식으로만 답하세요. 마크다운 코드펜스로 감싸지 마세요.
\`\`\`json
{
  "phase": "intro | examples | roleplay | output | summary 중 하나",
  "content": "한국어로 쓴 설명, 질문, 피드백",
  "steps": [
    {
      "type": "example | output_prompt 중 하나",
      "speaker": "A",
      "text": "영어 문장",
      "translation": "한국어 번역",
      "hint": "type이 output_prompt일 때만 — 왜 이 문장을 쓰는지 한 줄"
    }
  ]
}
\`\`\`

응답은 오직 이 JSON 객체만 출력해야 합니다. 앞뒤에 설명을 붙이지 마세요.`

/** 사용자 신원 — 모델이 난이도를 조절하는 데 쓴다. */
export type LearnerProfile = {
  level: string
  goal: string
}

export const LEVELS = ['초급', '중급', '고급'] as const

export const GOALS = [
  '여행', '업무', '일상 회화', '면접 준비', '시험 준비',
] as const

export function profileToPrompt(profile: LearnerProfile): string {
  return `현재 학습자 수준: ${profile.level}\n목표: ${profile.goal}`
}

/**
 * 모델 응답 파서.
 *
 * 실패를 절대 던지지 않는다 — 영어 기능에서 파싱 오류가 났다는 이유로
 * 500을 띄우는 건 사용자에게 아무 도움도 안 되는 화면이다.
 * 못 파싱하면 content만 통과시키고 steps는 비운 배열을 돌려준다.
 */
export function parseLessonResponse(raw: string): LessonTurn {
  const jsonText = extractJson(raw)

  if (!jsonText) {
    return {
      phase: 'intro',
      content: raw.trim() || '응답을 해석하지 못했습니다.',
      steps: [],
    }
  }

  let parsed: RawLessonResponse
  try {
    parsed = JSON.parse(jsonText) as RawLessonResponse
  } catch {
    return {
      phase: 'intro',
      content: raw.trim() || '응답을 해석하지 못했습니다.',
      steps: [],
    }
  }

  const phase = VALID_PHASES.includes(parsed.phase as Phase)
    ? (parsed.phase as Phase)
    : 'intro'

  const steps: LessonStep[] = []
  if (Array.isArray(parsed.steps)) {
    for (const s of parsed.steps) {
      const step = coerceStep(s)
      if (step) steps.push(step)
    }
  }

  return {
    phase,
    content: typeof parsed.content === 'string' ? parsed.content : '',
    steps,
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

/**
 * 다음 턴에 보낼 assistant 메시지 문자열.
 *
 * 이것이 OLD의 "화면 전용 메시지는 다음 API 호출에 넣지 않는다" 규칙이다.
 * steps를 통째로 직렬화하면 JSON 키가 매번 반복되어 토큰만 낭비된다.
 * 모델이 "내가 이미 무엇을 말했는지" 알 수 있을 만큼만 압축한다.
 */
export function turnToHistoryText(turn: LessonTurn): string {
  const parts: string[] = []
  parts.push(`[${PHASE_LABEL[turn.phase]}]`)

  if (turn.content) parts.push(turn.content)

  for (const step of turn.steps) {
    const label = step.type === 'output_prompt' ? '연습' : '예문'
    parts.push(`· ${label} <${step.speaker}> ${step.text} — ${step.translation}`)
  }

  return parts.join('\n')
}
