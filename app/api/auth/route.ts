import { NextRequest, NextResponse } from 'next/server'
import { getAppToken, isAuthConfigured, isPinValid } from '@/lib/auth'

/**
 * POST /api/auth — PIN 검증 후 세션 토큰 발급
 *
 * 요청  { pin: string }
 * 성공  200 { token: string }
 * 실패  401 { error: string }
 *
 * PIN은 여기서 소비되고 클라이언트로 돌아가지 않는다.
 * 클라이언트가 받는 것은 APP_TOKEN 하나뿐이며, 이 값으로 /api/chat을 호출한다.
 *
 * 비교가 timing-safe하지 않은 것은 의도된 것이다 — 6자리 숫자를
 * 정밀 타이밍으로 때리는 게 아니라 실수로 접근하지 못하게 하는 것이 목적이고,
 * 어차피 이 라우트에 직접 요청이 들어와야 한다.
 */
export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    console.error('[auth] APP_PIN / APP_TOKEN이 설정되지 않았습니다. .env.local을 확인하세요.')
    return NextResponse.json(
      { error: '인증이 설정되지 않았습니다. 서버의 .env.local에 APP_PIN과 APP_TOKEN을 추가하세요.' },
      { status: 500 }
    )
  }

  let pin: unknown
  try {
    pin = (await req.json())?.pin
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽을 수 없습니다.' }, { status: 400 })
  }

  if (!isPinValid(pin)) {
    return NextResponse.json({ error: 'PIN이 올바르지 않습니다.' }, { status: 401 })
  }

  return NextResponse.json({ token: getAppToken() })
}
