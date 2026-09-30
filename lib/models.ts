import type { Provider } from './llm'

export type ModelInfo = {
  /** provider API에 그대로 넘기는 model ID */
  id: string
  /** 화면 표시용 이름 */
  name: string
}

/**
 * ============================================================================
 *  모델 설정 — 여기만 고치면 됩니다
 * ============================================================================
 *
 *  • 목록에 원하는 모델을 추가/삭제하고 `id`만 맞게 넣으면 끝입니다.
 *  • 목록에 없는 모델은 채팅 화면의 "직접 입력" 칸에 ID를 타이핑해서 쓸 수 있습니다.
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
 *  ── 주의 ─────────────────────────────────────────────────────────────────
 *  • Anthropic(Claude) 계열은 의도적으로 제외되어 있습니다. 필요하면 추가하세요.
 *  • gemini는 Flash Lite(일 500회)를 기본으로 씁니다. 다른 모델로 바꾸면
 *    free tier 한도가 모델당 일 20~50회로 크게 떨어집니다.
 *  • key가 없거나 잔액이 모자란 provider는 화면에 나타나도 호출이 실패합니다.
 *    (.env.local의 *_API_KEY 확인)
 */
export const MODELS: Record<Provider, ModelInfo[]> = {
  openrouter: [
    { id: 'openai/gpt-5.5', name: 'GPT-5.5' },
    { id: 'openai/gpt-5.4', name: 'GPT-5.4' },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'x-ai/grok-4.20', name: 'Grok 4.20' },
  ],
  groq: [
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
    { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B' },
  ],
  gemini: [
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite' },
  ],
}

/** 화면에서 처음 선택되어 있는 provider. 실제로 key가 있는 것으로 지정하세요. */
export const DEFAULT_PROVIDER: Provider = 'groq'

/** provider별 기본 모델 (해당 provider 목록의 첫 항목) */
export function defaultModelFor(provider: Provider): string {
  return MODELS[provider]?.[0]?.id ?? ''
}
