'use client'

import { useState, useSyncExternalStore } from 'react'
import { getToken, saveToken, subscribeToken } from '@/lib/auth-client'

/**
 * ============================================================================
 *  잠금 화면 (6자리 PIN)
 * ============================================================================
 *
 *  왜 layout.tsx 안이 아니라 컴포넌트로 분리했는가:
 *    layout.tsx는 서버 컴포넌트로 유지하고 싶습니다. 여기에 'use client'를 붙이면
 *    하위 트리 전체가 클라이언트 렌더링으로 바뀌기 때문입니다.
 *    서버 컴포넌트가 클라이언트 컴포넌트에 children을 넘기는 정식 패턴을 씁니다.
 *
 *  왜 자식은 항상 렌더하고 잠금 화면만 덮는가:
 *    토큰 확인 전까지 렌더를 미루면 첫 페인트에 빈 화면이 보이거나,
 *    effect에서 setState를 불러 연속 렌더가 발생합니다.
 *    sessionStorage 방식에서는 페이지 HTML이 어차피 이미 전송되므로
 *    "보호된 내용을 그리지 않는다"는 이득이 없고, 깜빡임만 남습니다.
 *    잠금 화면을 fixed 오버레이로 덮어 flickering을 없앴습니다.
 *
 *  보안 수준 (사용자 결정 — docs/RULE.md):
 *    의도적으로 약하게 만들었습니다. "URL만 알면 끝"인 상태를 막는 것이 목적이며,
 *    토큰이 sessionStorage에 있으므로 개발자도구로 볼 수 있습니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  v0.5.0에서 이 컴포넌트의 책임이 줄어들었습니다
 *  ─────────────────────────────────────────────────────────────────────────
 *  v0.4.0까지는 두 겹이었습니다. 6자리 PIN 다음에 Supabase 로그인 오버레이를
 *  한 겹 더 올렸습니다. 대화가 사람마다 섞이면 안 된다는 이유로 넣은 것입니다.
 *
 *  이 앱은 혼자 씁니다. 로그인이 없어져서 그 겹을 지웠습니다.
 *  남은 것은 잠금 하나이고, 이것은 그대로 두어야 합니다 —
 *  잠금이 내려가면 /api/chat을 토큰 없이 그대로 부를 수 있어서,
 *  앱을 열지 않고 curl 한 줄로 provider 크레딧을 태울 수 있습니다.
 *
 *  로그인이 사라진 뒤에도 잠금이 필요한 이유는 달라지지 않았습니다.
 *  대화 저장이 서버로 옮겨졌지만 (app/api/conversations) 그 라우트들 역시
 *  x-app-token을 검사합니다. 접근 문은 여전히 여기 하나입니다.
 */
function LockScreen() {
  const [pin, setPin] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [busy, setBusy] = useState<boolean>(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || pin.length !== 6) return

    setError('')
    setBusy(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '인증에 실패했습니다.')
        setPin('')
        return
      }

      // saveToken이 저장소를 갱신하면 구독자가 알아서 오버레이를 내린다
      saveToken(data.token)
    } catch {
      setError('서버에 연결할 수 없습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-page text-ink flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-display tracking-tight">First App</h1>
        <p className="text-meta text-ink-muted mt-2 mb-8">잠금 해제</p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(e) => {
              setError('')
              setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
            }}
            placeholder="6자리"
            autoFocus
            aria-label="6자리 PIN"
            className={`w-full bg-surface-2 border rounded-md px-4 py-4 text-center text-display tracking-[0.5em] pl-[0.9em] text-ink shadow-edge outline-none transition-colors ${
              error ? 'border-danger' : 'border-line focus:border-line-strong'
            }`}
          />

          {error && <p className="mt-3 text-meta text-danger text-center">{error}</p>}

          <button
            type="submit"
            disabled={pin.length !== 6 || busy}
            className="mt-4 w-full bg-accent text-page font-semibold px-6 py-3 rounded-md text-body disabled:opacity-30 transition-opacity"
          >
            {busy ? '확인 중...' : '잠금 해제'}
          </button>
        </form>

        <p className="mt-8 text-meta text-ink-faint text-center leading-relaxed">
          계속할 수 없다면 서버의 <span className="text-ink-muted">.env.local</span>에서
          <br />
          <span className="text-ink-muted">APP_PIN</span> 값을 확인하세요.
        </p>
      </div>
    </div>
  )
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const token = useSyncExternalStore(subscribeToken, getToken, () => null)
  const pinned = token !== null

  return (
    <>
      {children}
      {!pinned && <LockScreen />}
    </>
  )
}
