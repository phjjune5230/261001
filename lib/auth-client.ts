/**
 * 클라이언트에서 쓰는 인증 토큰 보관소.
 *
 * 왜 sessionStorage인가:
 *  - 탭을 닫으면 풀린다. 개인 앱이므로 "항상 로그인 상태"가 필요 없다.
 *  - PIN 자체는 여기 담기지 않는다. /api/auth가 통과시킨 APP_TOKEN만 담긴다.
 *
 * 왜 Context가 아니라 헬퍼인가:
 *  - 현재 토큰이 필요한 곳은 AuthGate와 채팅 페이지 두 군데뿐이다.
 *    (docs/08-decisions.md D-007)
 *
 * 왜 useSyncExternalStore인지:
 *  - sessionStorage는 React 밖의 저장소라 useEffect로 읽으면 setState-in-effect가 된다.
 *    useSyncExternalStore가 그 경로의 정식 해법이다.
 *
 * storage는 개인정보보호 모드에서 접근이 예외를 던질 수 있어 전부 감싼다.
 */

const TOKEN_KEY = 'first_app_token'

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** useSyncExternalStore 구독 — 같은 탭 안의 saveToken/clearToken에도 반응해야 하므로 직접 알린다 */
export function subscribeToken(onStoreChange: () => void) {
  listeners.add(onStoreChange)
  window.addEventListener('storage', onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveToken(token: string): void {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    // 저장에 실패해도 서버 인증은 이미 통과했으므로 조용히 넘어간다
  }
  emit()
}

export function clearToken(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // 지우지 못해도 다음 인증에서 덮어써지므로 무시해도 된다
  }
  emit()
}
