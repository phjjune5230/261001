/**
 * ============================================================================
 *  서버 전용 인증 헬퍼
 * ============================================================================
 *
 *  APP_PIN / APP_TOKEN은 `.env.local`에만 존재하며 `NEXT_PUBLIC_` 접두사가
 *  없습니다. Next.js는 접두사가 붙은 변수만 클라이언트 번들에 인라인하므로,
 *  이 파일에서 읽는 두 값은 브라우저로 전달되지 않습니다.
 *  (클라이언트에는 PIN이 아니라 별도로 발급한 APP_TOKEN만 나갑니다)
 *
 *  ⚠️ 이 파일을 클라이언트 컴포넌트에서 import하지 마세요.
 *     `server-only` 패키지를 붙이고 싶지만 아직 미설치 상태라, 규칙으로 막습니다.
 *     허용되는 호출부는 `app/api/**` 뿐입니다. (docs/RULE.md — 서버 전용 모듈)
 *
 *  두 값이 모두 설정돼 있지 않으면 **fail-closed**로 동작합니다.
 *  "설정 안 했으니 일단 열어두자"는 공개 배포 사고의 출발점이라 일부러 막습니다.
 */

const APP_PIN = process.env.APP_PIN || ''
const APP_TOKEN = process.env.APP_TOKEN || ''

/** APP_PIN / APP_TOKEN이 모두 설정돼 있는지 */
export function isAuthConfigured(): boolean {
  return Boolean(APP_PIN && APP_TOKEN)
}

/** PIN 비교. 일치하면 참. 설정되지 않았으면 항상 거짓. */
export function isPinValid(pin: unknown): boolean {
  if (!APP_PIN || typeof pin !== 'string') return false
  return pin === APP_PIN
}

/** 발급한 토큰 비교. 일치하면 참. 설정되지 않았으면 항상 거짓. */
export function isTokenValid(token: unknown): boolean {
  if (!APP_TOKEN || typeof token !== 'string') return false
  return token === APP_TOKEN
}

/** PIN이 통과했을 때 클라이언트에 내려줄 토큰 */
export function getAppToken(): string {
  return APP_TOKEN
}
