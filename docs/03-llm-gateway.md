# 03. LLM 게이트웨이 (LLM Gateway)

## 개요
사용자가 직접 provider를 선택하고, 각 provider의 API 키를 `.env.local`에 등록하여 사용합니다.

> 모델 목록은 이 문서가 아니라 **`lib/models.ts`** 에 있습니다. 여기 적힌 예시 ID는 설명용일 뿐입니다.

## 지원 Provider

| Provider | API 방식 | 환경 변수 | 기본 모델 |
|----------|----------|-----------|-----------|
| **OpenRouter** | OpenAI 호환 API (raw `fetch`) | `OPENROUTER_API_KEY` | `openai/gpt-5.5` |
| **Groq** | OpenAI 호환 API (raw `fetch`) | `GROQ_API_KEY` | `openai/gpt-oss-120b` |
| **Gemini** | Google Generative AI SDK (동적 import) | `GEMINI_API_KEY` | `gemini-3.5-flash-lite` |

Anthropic(Claude)은 **의도적으로 제외**되어 있습니다 — `08-decisions.md` D-001.

## 모델 설정 (`lib/models.ts`)

모델 목록은 `lib/models.ts` 한 곳에서만 관리합니다.

```ts
export const MODELS: Record<Provider, ModelInfo[]> = {
  openrouter: [
    { id: 'openai/gpt-5.5', name: 'GPT-5.5' },
    // ...
  ],
  groq: [ /* ... */ ],
  gemini: [ /* ... */ ],
}

export const DEFAULT_PROVIDER: Provider = 'groq'

export function defaultModelFor(provider: Provider): string {
  return MODELS[provider]?.[0]?.id ?? ''
}
```

- **목록에 있는 항목만** provider가 가질 수 있습니다. `Record<Provider, ...>` 타입이라 provider를 추가하면 TS가 컴파일 에러로 잡습니다.
- **각 목록의 첫 항목이 그 provider의 기본 모델**입니다. `lib/llm.ts`의 `PROVIDER_CONFIG`가 여기서 자동으로 가져옵니다.
- **목록에 없는 모델**은 채팅 화면의 "직접 입력…" 항목에 ID를 타이핑해 쓸 수 있습니다 (D-012). model ID가 빠르게 폐기되므로 이 우회로를 두었습니다.
- **UI 기본 provider는 `groq`** 입니다 — 실제 응답을 확인한 provider만 기본값으로 (D-011).

### model ID는 자주 폐기됩니다

목록에 넣은 ID가 사라지면 404/400이 납니다. 아래에서 현재 목록을 확인하세요.

| provider | 확인 방법 |
|----------|----------|
| OpenRouter | `https://openrouter.ai/api/v1/models` (인증 불필요) |
| Gemini | `https://ai.google.dev/gemini-api/docs/models` |
| Groq | `https://console.groq.com/docs/models` |

## LLM 클라이언트 구조 (`lib/llm.ts`)

```ts
export const ALL_PROVIDERS = ['openrouter', 'groq', 'gemini'] as const
export type Provider = (typeof ALL_PROVIDERS)[number]

export async function callLLM(
  provider: Provider,
  messages: LLMMessage[],
  options?: { model?: string; systemPrompt?: string; maxTokens?: number }
): Promise<LLMResponse>
```

- `LLMMessage` = `{ role: 'user' | 'assistant' | 'system'; content: string }`
- `LLMResponse` = `{ content: string; provider: string; model: string }`
- 기본값: `model`은 `defaultModelFor(provider)`, `maxTokens`는 1024
- provider별 키가 없으면 환경 변수명을 알려주는 한국어 오류를 던집니다

## 라우팅 전략

### 기본 동작
1. 사용자가 선택한 provider로 직접 API 호출
2. 실패하면 예외 발생 — 자동 폴백은 **하지 않습니다** (D-002)
3. Gemini만 아래 재시도 로직을 거칩니다

사용자가 "어떤 provider로 어느 모델을 썼는지" 직접 아는 것이 목표이므로,
provider가 죽었을 때 자동으로 다른 걸로 넘어가지 않습니다.

### 재시도 정책 (Gemini 한정)

```ts
const TRANSIENT =
  /\b(500|502|503|504)\b|overloaded|unavailable|ECONNRESET|ETIMEDOUT|fetch failed/i
const NON_RETRYABLE = /quota|exceeded your current|billing|api key|unauthorized|invalid/i
```

두 조건을 **모두** 만족할 때만 재시도합니다 (최대 3회, 지수 백오프 800ms).

- **재시도 대상**: 5xx, 네트워크 오류 — Gemini가 트래픽 스파이크 때 503이 잦습니다
- **재시도 제외**: 할당량 초과(429), 인증 실패 — 재시도해도 소용없고 한도만 빨리 소진됩니다 (D-005)

> OpenRouter와 Groq에는 재시도가 없습니다. 두 provider의 5xx는 그대로 사용자에게 보고됩니다.

### 향후 확장 (Phase 3+)
- 에러 카운트 기반 자동 폴백 (과거 `study-assistant`의 `llm_state` 컨셉 참고, D-008)

## Function Calling 지원 현황

**미구현.** Phase 1에서 사용하지 않습니다. Phase 3(목표 관리)에서 필요해질 수 있습니다.

| Provider | Function Calling | 비고 |
|----------|-----------------|------|
| OpenRouter | 미구현 (provider 측 지원) | 도입 시 확인 필요 |
| Groq | 미구현 (provider 측 지원) | 도입 시 확인 필요 |
| Gemini | 미구현 (SDK 네이티브 지원) | 도입 시 확인 필요 |

## 환경 변수 (.env.local)

```env
# OpenRouter
OPENROUTER_API_KEY=sk-or-...

# Groq
GROQ_API_KEY=gsk_...

# Google Gemini
GEMINI_API_KEY=AIza...
```

키가 없는 provider는 화면에 나타나도 호출이 실패합니다.
