import { NextRequest } from 'next/server'
import { convertToModelMessages, streamText, type UIMessage } from 'ai'
import { resolveChatModel } from '@/lib/ai-model'
import {
  badRequest,
  hasValidToken,
  isKnownProvider,
  providerError,
  unauthorized,
} from '@/lib/api'
import { limitsForModel } from '@/lib/model-registry'

// 기존 /api/chat과 같은 상한. 시스템 프롬프트는 화면에서 자유 입력이라
// 길면 메시지 예산 밖에서 불어난다 — 여기서 자른다.
const MAX_SYSTEM_PROMPT_CHARS = 1500

export async function POST(req: NextRequest) {
  // 기존 채팅과 동일하게 본문 파싱보다 먼저. 토큰 없으면 키를 쓸 이유가 없다.
  if (!hasValidToken(req)) {
    return unauthorized()
  }

  try {
    const { provider, model, messages, systemPrompt } = await req.json()

    if (!provider) {
      return badRequest('provider가 필요합니다.')
    }
    if (!isKnownProvider(provider)) {
      return badRequest(`지원하지 않는 provider입니다: ${provider}`)
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return badRequest('messages가 필요합니다.')
    }

    const rawSystem = typeof systemPrompt === 'string' ? systemPrompt : ''
    const system =
      rawSystem.length > MAX_SYSTEM_PROMPT_CHARS
        ? rawSystem.slice(0, MAX_SYSTEM_PROMPT_CHARS)
        : rawSystem

    // 출력 상한은 기존 채팅과 같은 출처(모델 등록값)를 쓴다.
    const limits = await limitsForModel(provider, typeof model === 'string' ? model : undefined)

    // 스트리밍으로 받은 AI 메시지는 reasoning/step-start 같은 파트가 섞여 있다.
    // 그대로 convertToModelMessages에 넣으면 두 번째 턴부터 변환이 실패한다
    // (첫 턴엔 이전 AI 메시지가 없어서 안 보인다). 화면에 쓰는 건 text뿐이므로
    // text 파트만 남겨서 보낸다.
    const textOnly = (messages as UIMessage[]).map((m) => ({
      ...m,
      parts: (m.parts ?? []).filter((p) => p.type === 'text'),
    }))

    const result = streamText({
      model: resolveChatModel(provider, typeof model === 'string' ? model : undefined),
      system: system || undefined,
      messages: await convertToModelMessages(textOnly),
      maxOutputTokens: limits.maxTokens,
    })

    return result.toUIMessageStreamResponse()
  } catch (err: unknown) {
    return providerError(err, 'chat2')
  }
}
