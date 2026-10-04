'use client'

import Icon from './Icon'

/**
 * ============================================================================
 *  밝게 / 어둡게
 * ============================================================================
 *
 *  ★ 왜 이 컴포넌트에 useState가 없는가 ★
 *
 *  흔한 구현은 "지금 무슨 테마인지"를 React 상태로 들고 있다가
 *  localStorage에 저장하는 것입니다. 그러면 화면이 두 번 그려집니다 —
 *  서버가 한 번, 브라우저가 다시 맞추면서 한 번. 브라우저는 localStorage를
 *  읽고 서버는 못 읽으므로, 그 둘의 값이 어긋나서 경고가 뜨거나 아이콘이
 *  잠깐 반대로 보입니다.
 *
 *  그래서 상태를 들지 않습니다. 진실은 <html>의 속성 하나이고,
 *  "지금 어떤 테마냐"를 화면에 그리는 일은 CSS가 합니다
 *  (app/globals.css의 .theme-icon-* 규칙).
 *
 *  결과적으로:
 *    - hydration 불일치가 생길 여지가 없습니다
 *    - 토글이 서버 상태와 어긋날 수 없습니다
 *    - 새로고침해도 값이 남습니다 (localStorage)
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  ★ 깜빡임(FOUC)을 막는 짝이 있습니다 — app/layout.tsx ★
 *
 *  이 컴포넌트는 **클릭한 뒤에만** 동작합니다. 첫 방문에서 사용자가 고른
 *  테마를 적용하는 것은 <head> 안의 인라인 스크립트가 합니다 — 첫 페인트
 *  전에 <html>의 속성을 심어야 화면이 처음부터 흰색(또는 검은색)으로 그려집니다.
 *  여기서만 적용하면 흰 화면이 한 번 그려졌다가 검은 화면으로 바뀝니다.
 */

/** app/layout.tsx의 인라인 스크립트와 반드시 같은 문자열을 써야 합니다. */
export const THEME_STORAGE_KEY = 'theme'

export default function ThemeToggle({ className }: { className?: string }) {
  /**
   * 서버에서도 실행될 수 있는 컴포넌트이므로 document를 무조건 가정하면 안 됩니다.
   * 이 함수는 클릭 이벤트에서만 불리므로 서버에서는 절대 실행되지 않지만,
   * 그래도 typeof 검사 하나를 두는 편이 나중에 옮겨 쓰기 편합니다.
   */
  const toggle = () => {
    if (typeof document === 'undefined') return

    const root = document.documentElement
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'

    root.dataset.theme = next

    // 저장 실패(사생활 모드, 저장소 차단)는 테마 전환 자체를 막지 않습니다.
    // 화면은 이미 바뀌었으므로, 여기서 조용히 넘어갑니다.
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // 저장 안 해도 이번 화면에서는 동작합니다. 다음 새로고침에서만 원래대로.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="밝게 / 어둡게"
      aria-label="화면 밝기 전환"
      className={
        className ??
        'shrink-0 border border-line rounded-md bg-surface-1 shadow-edge px-2 py-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink transition-colors'
      }
    >
      {/*
        두 아이콘이 **둘 다** DOM에 있습니다. 어느 것이 보이는지는 CSS가 정합니다.
        (globals.css의 .theme-icon-* 규칙 — 그쪽 주석을 같이 읽으세요)

        지금 어두운 화면이면 해를 보여 "누르면 밝아진다"를 알립니다.
        밝은 화면(기본)이면 달을 보여 "누르면 어두워진다"를 알립니다.
      */}
      <span className="theme-icon-light">
        <Icon name="sun" size={14} strokeWidth={1.8} />
      </span>
      <span className="theme-icon-dark">
        <Icon name="moon" size={14} strokeWidth={1.8} />
      </span>
    </button>
  )
}