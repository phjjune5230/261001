/**
 * ============================================================================
 *  모델 시험 — "한 번 쏴보기"
 * ============================================================================
 *
 *  모델을 앱에서 직접 등록하므로, **ID 오타를 먼저 알려주는 자리**가 필요합니다.
 *  model ID는 provider가 자주 폐기합니다. 지워진 ID를 넣어두면 채팅을 보낼
 *  때마다 404가 납니다 — 어느 모델 때문인지 찾는 데 시간이 걸립니다.
 *
 *  여기서 한 번 쏴보면 그 자리에서 kind가 'model'로 나옵니다.
 *
 *  ★ 이 라우트는 provider를 실제로 호출합니다 ★
 *  호출만큼 비용이 듭니다. 그래서 최소로만 — 16토큰, 짧은 한마디.
 *
 *  규칙은 다른 라우트와 같습니다: 토큰 먼저 검사, 원본 오류는 브라우저로 안 보냅니다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { badRequest, hasValidToken, isKnownProvider, unauthorized } from '@/lib/api'
import { describeError } from '@/lib/api'
import { limitsForModel } from '@/lib/model-registry'
import { callLLM } from '@/lib/llm'
import type { Provider } from '@/lib/llm'

/**
 * 시험에 쓸 출력 상한의 **상한선**입니다.
 *
 * ★ 실제 값은 그 모델에 등록된 maxTokens를 씁니다 ★
 * 시험이 답해야 하는 질문은 "이 모델이 채팅에서 되나"입니다.
 * 그런데 시험이 다른 값을 쓰면 답이 달라집니다 — 실제로 16토큰에서는
 * 추론 모델(gpt-oss-120b)이 실패하고 비추론 모델(qwen3.8-27b)은 통과했습니다.
 * 시험이 실제보다 불리한 조건이면 결과가 거짓말을 합니다.
 *
 * 그래서 등록값을 쓰되, 무모하게 큰 값으로 비용이 새지 않게 여기서 자릅니다.
 */
const PROBE_TOKEN_CEILING = 512

const PROBE_PROMPT = 'Hi'

/** POST /api/models/test — { provider, model } */
export async function POST(req: NextRequest) {
  if (!hasValidToken(req)) return unauthorized()

  let provider: Provider
  let model: string
  try {
    const body = (await req.json()) as Record<string, unknown>
    if (!isKnownProvider(body?.provider)) {
      return badRequest('provider가 필요합니다.')
    }
    provider = body.provider
    model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return badRequest('model이 필요합니다.')
  } catch {
    return badRequest('본문을 읽을 수 없습니다.')
  }

  try {
    // 채팅에서 이 모델이 실제로 받는 값을 그대로 씁니다.
    const limits = await limitsForModel(provider, model)
    const maxTokens = Math.min(limits.maxTokens, PROBE_TOKEN_CEILING)

    const result = await callLLM(provider, [{ role: 'user', content: PROBE_PROMPT }], {
      model,
      maxTokens,
    })

    // provider가 돌려준 model 이름이 우리가 보낸 것과 다르면 — 대표 모델로
    // 되돌아간 것입니다. 이럴 때 조용히 넘어가면 "왜 내 설정이 안 먹지"가 됩니다.
    const redirected = result.model && result.model !== model

    return NextResponse.json({
      ok: true,
      kind: null,
      message: '연결됐습니다.',
      repliedModel: result.model ?? model,
      redirected,
      usedTokens: maxTokens,
      sample: result.content?.slice(0, 80) ?? '',
    })
  } catch (err: unknown) {
    // ★ providerError()를 재 쓰지 않습니다 ★
    // 그 함수는 500을 돌려주고 로그를 남기는데, 시험은 **실패가 정상 결과**입니다.
    // 200으로 kind를 담아 돌려야 화면이 "실패 사유"를 정상적인 흐름으로 보여줍니다.
    const { kind, message, provider: p, status } = describeError(err)

    // 원본은 브라우저로 안 갑니다 (키 지문). 종류·provider·상태 코드만 남깁니다.
    console.error(
      `[models/test] 시험 실패: kind=${kind}` +
      `${p ? ` provider=${p}` : ''}${status ? ` status=${status}` : ''}`
    )

    return NextResponse.json({
      ok: false,
      kind,
      message,
      repliedModel: null,
      redirected: false,
      usedTokens: 0,
      sample: '',
    })
  }
}