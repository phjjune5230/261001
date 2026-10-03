import type { Provider } from './llm'

export type ModelInfo = {
  /** provider API에 그대로 넘기는 model ID */
  id: string
  /** 화면 표시용 이름 */
  name: string

  /**
   * ★ 이 모델에 주는 출력 상한 (max_tokens) ★
   *
   * provider의 규약이 아니라 **우리가 정하는 값**입니다. 길이·속도·비용의
   * 트레이드오프를 여기서 고르는 자리입니다.
   *
   * 입력 예산은 이 값에서 파생됩니다 (lib/context.ts의 contextBudgetFor).
   * 여기를 올리면 그만큼 입력 예산이 줄어듭니다 — TPM의 합은 고정이라.
   */
  maxTokens: number

  /**
   * provider가 정한 분당 토큰 한도 (TPM). **provider의 사실**입니다.
   *
   * `null`은 두 가지를 뜻합니다 — "한도가 없다" 또는 "아직 확인하지 않았다".
   * 어느 쪽이든 입력 예산은 lib/context.ts의 기본값을 씁니다.
   *
   * ★ 모르는 수를 지어내지 마세요 ★
   * 숫자를 넣으면 그게 예산 계산에 그대로 쓰입니다. 근거 없이 채운 값은
   * 조용히 틀리고, provider가 거절한 뒤에야 알 수 있습니다.
   * 채우려면 console.groq.com/docs/rate-limits 같은 원문에서 확인한 뒤 주석에
   * 확인 날짜와 출처를 적으세요.
   */
  tpm: number | null

  /**
   * provider가 정한 분당 요청 수 한도 (RPM). **provider의 사실**입니다.
   *
   * 지금은 표시에만 쓰입니다 — 요청을 미루는 로컬 대기열은
   * lib/rate-limit.ts에 계획되어 있으나 아직 없습니다 (docs/BACKLOG.md).
   */
  rpm: number | null
}

/**
 * ============================================================================
 *  모델 설정 — 여기만 고치면 됩니다
 * ============================================================================
 *
 *  • 목록에 원하는 모델을 추가/삭제하고 `id`만 맞게 넣으면 끝입니다.
 *  • 목록에 없는 모델은 채팅 화면의 "직접 입력" 칸에 ID를 타이핑해서 쓸 수 있습니다.
 *    그런 모델은 한도를 모르므로 기본값으로 계산합니다 (limitsFor 참고).
 *  • 각 provider의 목록 첫 번째 항목이 그 provider의 기본 모델이 됩니다.
 *    (lib/llm.ts의 defaultModel이 여기서 자동으로 가져옵니다)
 *
 *  ── model ID는 자주 폐기됩니다 ──────────────────────────────────────────
 *  화면에 넣은 ID가 사라지면 404/400이 납니다. 아래 API로 현재 목록을 확인하세요:
 *
 *    openrouter : https://openrouter.ai/api/v1/models     (인증 불필요)
 *    gemini     : https://ai.google.dev/gemini-api/docs/models
 *    groq       : https://console.groq.com/docs/models
 *
 *  ── 한도 표기 ────────────────────────────────────────────────────────────
 *  • `maxTokens`는 우리가 정하는 값이므로 전부 채워 둡니다.
 *  • `tpm` / `rpm`은 provider의 사실이라 **확인한 것만** 씁니다.
 *    2026-10-03 기준 groq `openai/gpt-oss-120b`만 실측했습니다
 *    (console.groq.com/docs/rate-limits, Developer Plan).
 *    OpenRouter는 TPM 제한이 없고 무료 모델에 분당 20회 한도가 있습니다.
 *  • 나머지는 `null`입니다. 채워 넣으려면 출처를 주석에 남기세요.
 *
 *  ── 주의 ─────────────────────────────────────────────────────────────────
 *  • Anthropic(Claude) 계열은 의도적으로 제외되어 있습니다. 필요하면 추가하세요.
 *  • gemini는 Flash Lite(일 500회)를 기본으로 씁니다. 다른 모델로 바꾸면
 *    free tier 한도가 모델당 일 20~50회로 크게 떨어집니다.
 *  • key가 없거나 잔액이 모자란 provider는 화면에 나타나도 호출이 실패합니다.
 *    (.env.local의 *_API_KEY 확인)
 */
export const MODELS: Record<Provider, ModelInfo[]> = {
  openrouter: [
    // OpenRouter는 TPM 제한이 없습니다 (2026-10-03 확인).
    // 무료 모델에 분당 20회, 유료는 일 50~1,000회 한도가 따로 있습니다.
    // 유료 모델에 rpm을 적으면 그건 요금제 한도라 자주 바뀝니다 — null로 둡니다.
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'nemotron-3-ultra-550b-a55b', maxTokens: 2_000, tpm: null, rpm: null },
    { id: 'nvidia/nemotron-3.5-lightning:free', name: 'nemotron-3.5-lightning', maxTokens: 2_000, tpm: null, rpm: null },
  
  ],
  groq: [
    // 2026-10-03 실측: console.groq.com/docs/rate-limits, Developer Plan
    {
      id: 'openai/gpt-oss-120b',
      name: 'GPT-OSS 120B',
      maxTokens: 2_000,
      tpm: 8_000,
      rpm: 30,
    },
    // 20B의 한도는 확인하지 않았습니다. null로 두면 기본 예산을 씁니다.
    { id: 'qwen/qwen3.8-27b', name: 'QWEN3.8-27b', maxTokens: 2_000, tpm: 8000, rpm: 30 },
  ],
  gemini: [
    // Gemini free tier는 분당 토큰이 아니라 일별 호출 수가 걸립니다
    // (모델당 일 20~500회). 그래서 tpm/rpm 대신 rpm에도 이름이 맞지 않는
    // 제약이 따로 있습니다 — 여기 담지 않고 주석만 남깁니다.
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', maxTokens: 2_000, tpm: 250000, rpm: 15 },
  ],
}

/**
 * 목록에 없는 모델을 직접 입력했을 때 쓰는 값.
 *
 * "모른다"를 표현하는 값이라 tpm/rpm은 null이고 maxTokens만 있습니다.
 * 여기 숫자를 지어내면 사용자가 입력한 모델에 그 숫자가 적용됩니다.
 */
const UNKNOWN_MODEL: ModelInfo = {
  id: '',
  name: '알 수 없는 모델',
  maxTokens: 2_000,
  tpm: null,
  rpm: null,
}

/** 화면에서 처음 선택되어 있는 provider. 실제로 key가 있는 것으로 지정하세요. */
export const DEFAULT_PROVIDER: Provider = 'groq'

/** provider별 기본 모델 (해당 provider 목록의 첫 항목) */
export function defaultModelFor(provider: Provider): string {
  return MODELS[provider]?.[0]?.id ?? ''
}

/**
 * 고른 모델의 한도를 돌려줍니다. **절대 null을 주지 않습니다** —
 * 호출부가 매번 빈 경우를 처리하지 않아도 되게 하려는 것이 목적입니다.
 *
 * 목록에 없는 ID를 직접 입력한 경우 provider의 첫 번째 모델이 아니라
 * UNKNOWN_MODEL을 줍니다. 없는 모델에 20B의 한도를 물려주는 것은 오답입니다.
 */
export function limitsFor(provider: Provider, model?: string): ModelInfo {
  const list = MODELS[provider] ?? []
  if (model) {
    const found = list.find(m => m.id === model)
    if (found) return found
  }
  return UNKNOWN_MODEL
}
