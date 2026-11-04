import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { defaultModelFor } from './models'
import type { Provider } from './llm'

/**
 * 채팅2 전용 — Vercel AI SDK용 모델 해석.
 *
 * 기존 채팅(lib/llm.ts)은 건드리지 않는다. 키 환경변수 이름만 기존과
 * 동일하게(.env.local의 *_API_KEY) 맞춘다.
 */
const ENV_KEY: Record<Provider, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

export function resolveChatModel(provider: Provider, model?: string) {
  const apiKey = process.env[ENV_KEY[provider]] || ''
  if (!apiKey) {
    throw new Error(
      `${provider} API 키가 설정되지 않았습니다. .env.local의 ${ENV_KEY[provider]}를 확인하세요.`
    )
  }
  const modelId = (model && model.trim()) || defaultModelFor(provider)
  if (!modelId) {
    throw new Error('모델 ID가 필요합니다.')
  }

  if (provider === 'gemini') {
    const google = createGoogleGenerativeAI({ apiKey })
    return google(modelId)
  }

  const baseURL =
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.groq.com/openai/v1'
  const openaiCompatible = createOpenAICompatible({
    name: provider,
    baseURL,
    apiKey,
  })
  return openaiCompatible(modelId)
}
