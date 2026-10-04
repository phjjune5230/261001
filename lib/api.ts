/**
 * ============================================================================
 *  라우트 공통 헬퍼
 * ============================================================================
 *
 *  /api/chat 과 /api/english 이 정확히 같은 두 가지를 필요로 한다:
 *    1. 본문 파싱 *이전에* 토큰 검사
 *    2. provider 원본 오류를 브라우저로 흘리지 않는 봉쇄
 *
 *  영어 기능을 추가하면서 이 로직이 두 곳에 복제되면,
 *  한쪽만 고치고 한쪽을 잊는 사고가 난다. 그래서 여기로 뺀다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isTokenValid } from './auth'
import { ALL_PROVIDERS, type Provider } from './llm'

/**
 * 우리가 직접 만든 오류 메시지 — 브라우저에 그대로 보여줘도 되는 것들.
 * provider가 돌려준 원본 응답은 이 목록에 없으므로 노출되지 않는다.
 *
 * 정규식은 lib/llm.ts가 던지는 문자열에 맞춘다. 그 문구를 바꾸면
 * 여기도 같이 고쳐야 합니다 (여기가 조용히 틀어지면 사용자는 500만 본다).
 */
const OWN_ERRORS = [
  /알 수 없는 프로바이더입니다/,
  /API 키가 설정되지 않았습니다/,
  /지원하지 않는 provider입니다/,
  /provider가 필요합니다/,
  /messages가 필요합니다/,
]

/**
 * ★ 오류 종류 ★
 *
 * 왜 이게 필요한가: 한때 모든 provider 실패를
 * "잠시 후 다시 시도해주세요" 한 줄로 뭉개고 있었습니다. 그래서 401(키 오류)과
 * 429(할당량 초과)와 500(provider 장애)이 사용자에게 똑같이 보였습니다.
 * 원인을 고칠 사람이 그 문장을 보고 무엇을 고쳐야 하는지 알 수 없었습니다.
 *
 * 이제 분류는 두 사람을 동시에 돕습니다.
 *   • 사용자는 왜 실패했는지 바로 알고, 무엇을 고칠지 압니다.
 *   • 서버 로그는 kind를 남기므로 원인을 그대로 집계할 수 있습니다.
 *
 * ★ 원본 응답은 여전히 브라우저로 내보내지 않습니다 ★
 * provider가 준 본문에는 API 키 지문이 들어간 적이 있습니다 (v0.2.0 사고).
 * 여기서 만드는 메시지는 전부 우리가 지은 문장입니다 — provider 본문의
 * 일부를 그대로 옮기지 않습니다.
 */
export type ErrorKind =
  | 'config'    // 우리가 만든 설정 오류 — 사용자가 직접 고칠 수 있습니다
  | 'auth'      // API 키가 없거나 틀림
  | 'model'     // 그 모델을 provider가 모름 (폐기되었을 수 있음)
  | 'quota'     // 일별·기간 할당량 소진
  | 'rate'      // 분당 요청 또는 토큰 한도 초과
  | 'credit'    // 잔액·결제 문제
  | 'context'   // 입력이 컨텍스트 한도를 넘음
  | 'empty'     // provider는 200을 줬는데 본문이 비어 있음 (출력 상한 부족)
  | 'policy'    // 안전 필터에 막힘
  | 'timeout'   // 네트워크 지연·단절
  | 'transient' // provider 일시 장애 (5xx)
  | 'unknown'   // 분류 실패 — 예전처럼 한 문장으로 뭉개지 않기 위해 남겨둡니다

/**
 * 판정표. **위에서부터 처음 맞는 것이 이깁니다.**
 *
 * 순서가 의미입니다. 402는 잔액인데 본문에 "quota"가 같이 들어올 수 있고,
 * 429는 할당량("quota")과 분당 한도("rate limit")가 같은 상태 코드입니다.
 * 그래서 더 구체적인 쪽을 앞에 둡니다.
 *
 * 정규식은 lib/llm.ts가 만드는 `provider + 상태 코드 + 본문 앞부분`을 대상으로 합니다.
 * 그 형식이 바뀌면 여기서 조용히 틀어집니다 — 그래서 unknown을 남겨 둡니다.
 */
const CLASSIFY: { kind: ErrorKind; re: RegExp; message: string }[] = [
  {
    kind: 'credit',
    re: /\b402\b|billing|insufficient.{0,10}credit|payment|잔액/i,
    message: 'API 크레딧이 부족합니다. provider의 사용량과 결제 상태를 확인해주세요.',
  },
  {
    kind: 'auth',
    re: /\b401\b|unauthorized|invalid.{0,10}api.{0,3}key|authentication/i,
    message: 'API 키가 올바르지 않습니다. .env.local의 키를 확인해주세요.',
  },
  {
    kind: 'model',
    re: /\b404\b|model.{0,3}not.{0,3}found|is not found|does not exist|deprecat|폐기/i,
    message: 'provider가 그 모델을 모릅니다. 모델 ID가 폐기되었거나 오타입니다. ' +
      '모델 관리 화면에서 ID를 확인하거나 목록에서 지워주세요.',
  },
  {
    kind: 'quota',
    re: /quota|exceeded your current|per day|daily limit|requests per day/i,
    message: '사용 한도에 도달했습니다. 기간이 지나거나 할당량을 늘려야 합니다.',
  },
  {
    kind: 'rate',
    re: /\b429\b|rate.{0,3}limit|too many requests|requests per minute|tokens per min/i,
    message: '분당 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
  },
  {
    kind: 'context',
    re: /context.{0,3}length|maximum context|too many tokens|reduce the length|token count|too long/i,
    message: '입력이 모델의 컨텍스트 한도를 넘었습니다. 앞 대화를 줄여주세요.',
  },
  {
    /**
     * ★ provider는 200을 줬는데 본문이 비어 있음 ★
     *
     * 이건 실패가 아닙니다. 추론(reasoning) 모델은 본문을 쓰기 전에
     * 별도 reasoning 토큰을 쓰기 때문입니다. max_tokens이 작으면 거기가 다 먹고
     * content가 빈 문자열로 돌아옵니다.
     *
     * "다시 시도"로 해결되지 않습니다. 값을 올려야 합니다 —
     * 그래서 그 말을 정확히 합니다 (2026-10-04, gpt-oss-120b 시험에서 발견).
     */
    kind: 'empty',
    re: /\b200 empty\b|finish_reason/i,
    message:
      '모델이 빈 응답을 돌려줬습니다. 답을 쓰기 전에 출력 상한을 다 쓴 것일 수 있습니다 — ' +
      '이 모델의 maxTokens를 올려보세요. 같은 값을 다시 눌러도 달라지지 않습니다.',
  },
  {
    kind: 'policy',
    re: /safety|blocked|content.{0,3}policy|responsible.{0,3}ai|prohibited/i,
    message: '안전 정책에 막힌 응답입니다. 표현을 조금 바꿔주세요.',
  },
  {
    kind: 'timeout',
    re: /ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|aborted|socket hang up|network/i,
    message: 'provider에 연결하지 못했습니다. 네트워크를 확인해주세요.',
  },
  {
    kind: 'transient',
    re: /\b50[0234]\b|overloaded|unavailable|internal server|temporarily/i,
    message: 'provider가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.',
  },
]

/**
 * provider 이름과 HTTP 상태 코드만 원본에서 꺼냅니다.
 *
 * ★ 원본 본문은 어디에도 옮기지 않습니다 ★
 * lib/llm.ts가 메시지에 provider 본문 앞부분을 넣어 두는데, 그 안에는
 * API 키 지문이 들어간 적이 있습니다 (v0.2.0 사고). 지문은 브라우저로도,
 * 서버 로그로도 나가지 않습니다.
 *
 * 그런데 상태 코드만 봐도 원인의 반은 특정됩니다 — "groq가 429였다"와
 * "groq가 401이었다"는 완전히 다른 문제입니다. 상태 코드와 provider 이름은
 * credential이 아니므로 이 둘만 남깁니다.
 *
 * lib/llm.ts가 만드는 형태는 `provider 상태코드 error: 본문`입니다.
 * 다른 provider(Gemini)는 SDK가 던지므로 형태가 다르고, 그래도 모르는
 * 경우를 만들지 않으므로 null로 두고 꾸며내지 않습니다.
 */
function safeSource(msg: string): { provider: string | null; status: number | null } {
  const m = /^(openrouter|groq|gemini)\s+(\d{3})\b/.exec(msg)
  if (m) return { provider: m[1], status: Number(m[2]) }
  return { provider: null, status: null }
}

export type ErrorSummary = {
  kind: ErrorKind
  message: string
  /** provider 이름. 알 수 없으면 null */
  provider: string | null
  /** HTTP 상태 코드. 알 수 없으면 null */
  status: number | null
  /**
   * provider가 본문을 못 채운 이유 (kind가 'empty'일 때만 있음). 알 수 없으면 null.
   *
   * ★ 이 값이 "빈 응답"의 원인을 그대로 갈라냅니다 ★
   * lib/llm.ts가 reasoning 모델의 빈 응답을 만났을 때
   * `200 empty: finish_reason=length`처럼 던집니다. 여기서 그것을 꺼내지 않으면
   * 사용자에게는 "빈 응답"이라는 말만 남고, 무엇을 해야 하는지(출력 상한을 올려야
   * 하는지 / 다른 문제인지) 알 수 없습니다.
   *
   *   length — 출력 상한을 다 썼다. maxTokens를 올리면 됩니다. (2026-10-04, gpt-oss-120b)
   *   그 외   — 상한 문제가 아니다. 값을 올려도 그대로입니다.
   *
   * credential이 아니므로 로그와 응답에 실어도 안전합니다 (provider 본문과 다릅니다).
   */
  finishReason: string | null
}

/**
 * lib/llm.ts가 빈 응답에 붙여 남긴 finish_reason을 꺼냅니다.
 *
 * 정규식으로만 찾습니다 — 만들어낼 값이 없습니다.
 */
function safeFinishReason(msg: string): string | null {
  const m = /finish_reason=([a-z_]+)/i.exec(msg)
  return m ? m[1] : null
}

/**
 * 오류를 종류와 안전한 메시지로 바꿉니다.
 *
 * 반환되는 message는 전부 여기서 지은 문장입니다 — provider 원본을 옮기지 않습니다
 * (RULE.md 1절). kind는 그대로 응답에 실려 내려갑니다.
 */
export function describeError(err: unknown): ErrorSummary {
  const msg = err instanceof Error ? err.message : ''
  const { provider, status } = safeSource(msg)
  const finishReason = safeFinishReason(msg)

  if (OWN_ERRORS.some(re => re.test(msg))) {
    return { kind: 'config', message: msg, provider, status, finishReason }
  }

  for (const { kind, re, message } of CLASSIFY) {
    if (re.test(msg)) return { kind, message, provider, status, finishReason }
  }

  return {
    kind: 'unknown',
    message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
    provider,
    status,
    finishReason,
  }
}

/** 예전 이름 — 분류가 아니라 문장만 필요할 때. */
export function userFacingMessage(err: unknown): string {
  return describeError(err).message
}

/**
 * provider 오류를 로그에 남기고 안전하게 내려보냅니다.
 *
 * ★ 두 라우트가 한 곳을 보게 하는 이유 ★
 * /api/chat 과 /api/english 는 같은 오류를 같은 방식으로 처리해야 합니다.
 * 한쪽만 고치고 한쪽을 잊으면 어느 기능이 왜 조용히 이상한 말을 하는지
 * 찾을 수 없습니다. 로그 접두사만 넘기면 나머지는 여기서 같아집니다.
 *
 * ★ 로그에는 종류·provider·상태 코드만 씁니다 ★
 * 원본 오류(`err`)는 인자로도 받지 않습니다. 로그에 받아 적는 순간
 * provider 본문이 그대로 남고, 그 안에 키 지문이 있을 수 있습니다
 * (v0.2.0 사고). 분류 결과만 남기면 원인 집계에는 충분하고 누출은 없습니다.
 *
 * 응답에는 kind를 함께 넣습니다. 원본은 브라우저로 못 보내니 (키 지문),
 * 대신 **우리가 매긴 이름**은 보냅니다. 브라우저 개발자도구에서도 같은 정보를
 * 볼 수 있어야 서버 콘솔에 붙이지 않고도 원인을 알 수 있습니다.
 */
export function providerError(err: unknown, label: string): NextResponse {
  const { kind, message, provider, status, finishReason } = describeError(err)
  console.error(
    `[${label}] provider 호출 실패: kind=${kind}` +
    `${provider ? ` provider=${provider}` : ''}` +
    `${status ? ` status=${status}` : ''}` +
      `${finishReason ? ` finish_reason=${finishReason}` : ''}`
  )
  return NextResponse.json({ error: message, kind, finishReason }, { status: 500 })
}

/** 토큰이 없으면 즉시 401. 본문은 읽지 않는다. */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: '잠금 해제가 필요합니다.' }, { status: 401 })
}

export function hasValidToken(req: NextRequest): boolean {
  return isTokenValid(req.headers.get('x-app-token'))
}

export function isKnownProvider(value: unknown): value is Provider {
  return ALL_PROVIDERS.includes(value as Provider)
}

export function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 })
}

/**
 * 대화 저장이 설정되지 않았을 때.
 *
 * 503입니다. 500이 아니라 503인 이유는 "우리가 망했다"가 아니라
 * "이 배포에는 저장을 붙이지 않았다"를 뜻하기 때문입니다.
 * 브라우저는 이걸 보고 목록을 비우고 "저장 꺼짐" 안내를 냅니다.
 */
export function storageUnavailable(): NextResponse {
  return NextResponse.json({ error: '대화 저장이 설정되지 않았습니다.' }, { status: 503 })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * URL의 :id가 uuid인지를 확인합니다.
 *
 * 이 검사는 사소해 보이지만 service_role이 RLS를 완전히 우회하기 때문에
 * 필요합니다 (lib/db-server.ts 참고). "화면에서 안 보인다고" 필터를
 * 여기서 기대하면 안 되고, 값이 uuid가 아니면 DB에 묻지 않습니다.
 * 잘못된 값이면 Postgres가 형식 오류를 뱉는 대신 400을 돌려줍니다.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}
