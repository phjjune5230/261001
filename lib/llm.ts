import { defaultModelFor } from './models'

export const ALL_PROVIDERS = ['openrouter', 'groq', 'gemini'] as const
export type Provider = (typeof ALL_PROVIDERS)[number]

export type LLMMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type LLMResponse = {
  content: string
  provider: string
  model: string
}

const PROVIDER_CONFIG: Record<Provider, { apiKey: string; defaultModel: string }> = {
  openrouter: { apiKey: process.env.OPENROUTER_API_KEY || '', defaultModel: defaultModelFor('openrouter') },
  groq:        { apiKey: process.env.GROQ_API_KEY || '', defaultModel: defaultModelFor('groq') },
  gemini:      { apiKey: process.env.GEMINI_API_KEY || '', defaultModel: defaultModelFor('gemini') },
}

const PROVIDER_ENV_KEY: Record<Provider, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  groq:        'GROQ_API_KEY',
  gemini:      'GEMINI_API_KEY',
}

/**
 * 일시적 오류만 재시도. 인증 실패·할당량 초과(quota)는 재시도해도 소용없으므로 즉시 실패.
 * 특히 Gemini free tier는 모델당 일 20회 한도라 429 재시도는 의미가 없다.
 *
 * ★ 판정은 err.message의 문자열로만 합니다 ★
 * 그래서 HTTP 상태 코드를 반드시 메시지에 포함시켜야 합니다. 본문에만 의존하면
 * "503 Service Unavailable"이 아니라 `{"error":{"message":"..."}}` 처럼 본문에
 * 상태가 없는 응답을 일시적 오류로 못 알아봅니다 — 재시도 없이 곧바로 실패합니다.
 * 아래 두 provider 분기가 `provider + 상태 코드 + 본문` 순서로 붙이는 이유입니다.
 */
const TRANSIENT =
  /\b(500|502|503|504)\b|overloaded|unavailable|ECONNRESET|ETIMEDOUT|fetch failed/i
const NON_RETRYABLE = /quota|exceeded your current|billing|api key|unauthorized|invalid/i

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 800): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const retryable = TRANSIENT.test(msg) && !NON_RETRYABLE.test(msg)
      if (!retryable || i === attempts - 1) throw err
      await new Promise(r => setTimeout(r, delayMs * 2 ** i))
    }
  }
  throw lastErr
}

export async function callLLM(
  provider: Provider,
  messages: LLMMessage[],
  options?: {
    model?: string
    systemPrompt?: string
    maxTokens?: number
    /**
     * provider의 JSON 모드를 강제한다. 프롬프트에 "JSON으로 답해"라고만 적는 것과
     * 실제로 파서가 붙는 건 Reliability가 다르다. 영어 기능처럼 구조화된 응답이
     * 필요한 경로에서만 켠다.
     *
     * 주의: 일부 provider는 JSON 모드일 때 시스템 프롬프트에 "json"이라는
     * 단어를 요구한다. 영어 기능 프롬프트에 이미 포함돼 있다.
     */
    jsonMode?: boolean
  }
): Promise<LLMResponse> {
  const config = PROVIDER_CONFIG[provider]
  if (!config) {
    throw new Error(`알 수 없는 프로바이더입니다: ${provider}`)
  }
  if (!config.apiKey) {
    throw new Error(
      `${provider} API 키가 설정되지 않았습니다. .env.local의 ${PROVIDER_ENV_KEY[provider]}를 확인하세요.`
    )
  }

  const model = options?.model || config.defaultModel
  const systemPrompt = options?.systemPrompt || ''
  const maxTokens = options?.maxTokens || 1024
  const jsonMode = options?.jsonMode ?? false

  const systemMsg: LLMMessage = { role: 'system', content: systemPrompt }
  const allMessages = systemPrompt ? [systemMsg, ...messages] : messages

  // OpenAI 호환 엔드포인트(openrouter, groq)는 response_format으로 받는다.
  const openAICompatibleBody = {
    model,
    messages: allMessages,
    max_tokens: maxTokens,
    ...(jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
  }

  if (provider === 'openrouter' || provider === 'groq') {
    const url =
      provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.groq.com/openai/v1/chat/completions'

    // ★ 두 provider를 함께 처리합니다 — 요청 형식이 같고, 고쳐야 할 것도 같았습니다 ★
    // retry가 gemini에만 걸려 있어서, groq·openrouter는 503 한 번에 곧바로 실패했습니다.
    // groq는 트래픽 스파이크 때 503이 잦은 provider라, 재시도 없는 실패가 반복됐습니다.
    return withRetry(async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(openAICompatibleBody),
      })

      // ★ 상태 코드를 반드시 메시지에 넣습니다 ★
      // withRetry는 err.message의 문자열로만 일시적 오류를 판정합니다.
      // 예전에는 본문만 던졌는데, 본문에 "503"이 없으면 일시적 오류로 못 알아봅니다.
      // 상태를 넣으면 5xx 판정이 믿을 만해집니다 (아래 TRANSIENT 참고).
      const raw = await res.text()
      let data: { choices?: { message?: { content?: string } }[] } | null = null
      try {
        data = JSON.parse(raw)
      } catch {
        data = null
      }

      const content = data?.choices?.[0]?.message?.content
      if (!res.ok || !content) {
        // 본문은 잘라서 넣습니다 — 서버 콘솔용이고, provider가 긴 진단을 붙여 보냅니다.
        throw new Error(
          `${provider} ${res.status} error: ${raw.slice(0, 500)}`
        )
      }

      return { content: String(content), provider, model }
    })
  }

  if (provider === 'gemini') {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(config.apiKey)
    const modelObj = genAI.getGenerativeModel({
      model,
      systemInstruction: systemPrompt || undefined,
      generationConfig: jsonMode ? { responseMimeType: 'application/json' } : undefined,
    })
    const history = allMessages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }))
    const chat = modelObj.startChat({ history: history.slice(0, -1) })
    const lastMsg = history[history.length - 1]

    // Gemini는 트래픽 스파이크 때 503이 잦음 — 일시적 오류만 재시도
    const result = await withRetry(() => chat.sendMessage(lastMsg.parts[0].text))
    return { content: result.response.text(), provider, model }
  }

  throw new Error(`Unknown provider: ${provider}`)
}