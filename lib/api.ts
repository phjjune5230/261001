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

export function userFacingMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : ''
  if (OWN_ERRORS.some((re) => re.test(msg))) return msg
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'
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
