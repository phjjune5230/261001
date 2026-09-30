'use client'

import { useState } from 'react'
import {
  isSupabaseConfigured,
  normalizeUsername,
  signIn,
  signOut,
  signUp,
  type AuthUser,
  validateUsername,
} from '@/lib/db'

/**
 * ============================================================================
 *  계정 로그인 (Supabase Auth)
 * ============================================================================
 *
 *  왜 PIN 잠금과 별개인가 (D-019):
 *
 *    잠금(PIN)      — 앱 문을 여는 것. URL만 아는 사람에게 화면을 보여주지 않음
 *    로그인(Auth)   — "이 대화가 누구의 것인가"를 정하는 것. 대화를 사람마다 나눠줌
 *
 *  둘은 목적이 다릅니다. 그리고 로그인이 생겨도 PIN 잠금을 없애면 안 됩니다.
 *  잠금을 내리면 /api/chat을 토큰 없이 그대로 부를 수 있어서,
 *  앱을 열지 않고 curl 한 줄로 provider 크레딧을 태울 수 있습니다.
 *
 *  왜 여기서 Supabase를 직접 부르는가:
 *  anonymous 공개 조회로는 RLS가 막아 버립니다. rows가 0으로 돌아오고,
 *  그 0이 "로그인 안 됨"인지 "권한 없음"인지 구분할 수가 없습니다.
 *  그래서 로그인 창을 만들어 줍니다.
 */

const FIELD =
  'w-full bg-[#151515] border border-[#222] rounded-lg px-4 py-3 text-sm text-white ' +
  'outline-none focus:border-[#e8ff47] transition-colors placeholder:text-[#444]'

export default function SignInForm({ user }: { user: AuthUser | null }) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  if (!isSupabaseConfigured()) {
    return (
      <div className="w-full max-w-sm">
        <h2
          style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }}
          className="text-xl tracking-tight"
        >
          Supabase 미설정
        </h2>
        <p className="text-xs text-[#ef4444] mt-3 leading-relaxed">
          <span className="text-[#888]">.env.local에</span>{' '}
          <span className="text-[#555]">NEXT_PUBLIC_SUPABASE_URL</span>과{`\n`}
          <span className="text-[#555]">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>를 등록한 뒤
          개발 서버를 다시 시작하세요.
        </p>
        <p className="text-[10px] text-[#444] mt-4 leading-relaxed">
          등록한 뒤에도 이 화면이 남으면 서버를 완전히 껐다 다시 켜야 합니다.
          <br />
          <span className="text-[#555]">.env.local</span>은 읽을 때에만 반영됩니다.
        </p>
      </div>
    )
  }

  // 로그인된 상태 — 이름과 로그아웃만 보여줍니다
  if (user) {
    return (
      <div className="w-full max-w-sm text-center">
        <p className="text-[10px] text-[#444] uppercase tracking-widest">로그인됨</p>
        <p className="text-sm text-white mt-2 break-all">{user.username}</p>
        <p className="text-[10px] text-[#444] mt-6 leading-relaxed">
          이 계정의 대화만 보입니다.
          <br />
          다른 사람은 이 화면에 자기 계정으로 로그인해야 합니다.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 text-[11px] text-[#555] hover:text-[#e8ff47] transition-colors"
        >
          로그아웃
        </button>
      </div>
    )
  }

  // 입력을 정규화한 뒤 검사합니다. 화면 검증이 서버 검증보다 먼저입니다.
  const normalized = normalizeUsername(username)
  const nameError = normalized ? validateUsername(normalized) : null
  const canSubmit = normalized !== '' && nameError === null && password.length >= 6

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !canSubmit) return

    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (mode === 'in') {
        await signIn(normalized, password)
      } else {
        const { needsEmailConfirm } = await signUp(normalized, password)
        if (needsEmailConfirm) {
          setNotice('Supabase에서 "Confirm email"이 켜져 있습니다. 끄고 다시 가입해 주세요.')
          setMode('in')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'in' ? '로그인' : '계정 만들기'

  return (
    <form onSubmit={submit} className="w-full max-w-sm">
      <h2
        style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }}
        className="text-2xl tracking-tight"
      >
        {title}
      </h2>
      <p className="text-[11px] text-[#444] mt-1 mb-6 leading-relaxed">
        대화가 사람마다 따로 보이기 위해 필요합니다.
      </p>

      <div className="space-y-2">
        <input
          type="text"
          autoComplete="username"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="아이디"
          aria-label="아이디"
          className={FIELD}
        />
        <input
          type="password"
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          aria-label="비밀번호"
          className={FIELD}
        />
      </div>

      {nameError && <p className="mt-2 text-[11px] text-[#555]">{nameError}</p>}
      {!nameError && normalized === '' && (
        <p className="mt-2 text-[11px] text-[#444]">영문·숫자 3~20자. 대소문자는 구분하지 않습니다.</p>
      )}

      {error && <p className="mt-3 text-xs text-[#ef4444]">{error}</p>}
      {notice && <p className="mt-3 text-xs text-[#e8ff47]">{notice}</p>}

      <button
        type="submit"
        disabled={busy || !canSubmit}
        className="mt-4 w-full bg-[#e8ff47] text-black font-semibold px-6 py-3 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {busy ? '처리 중...' : mode === 'in' ? '로그인' : '가입하기'}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'in' ? 'up' : 'in')
          setError('')
          setNotice('')
        }}
        className="mt-4 w-full text-[11px] text-[#555] hover:text-[#e8ff47] transition-colors"
      >
        {mode === 'in' ? '계정이 없나요? 만들기' : '이미 계정이 있나요? 로그인'}
      </button>
    </form>
  )
}
