/**
 * ============================================================================
 *  서버 전용 Supabase 클라이언트 (D-022)
 * ============================================================================
 *
 *  ⚠️ 이 파일을 클라이언트 컴포넌트에서 import하지 마세요.
 *     `server-only` 패키지를 붙이고 싶지만 아직 미설치 상태라, 규칙으로 막습니다.
 *     `lib/auth.ts`와 같은 규칙이고, 허용되는 호출부는 `app/api/**` 뿐입니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  왜 대화가 이제 우리 서버를 거치나 (D-022)
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *  v0.4.0까지는 브라우저가 anon 키로 Supabase에 직접 붙었습니다 (D-019).
 *  RLS를 DB에 두는 게 보안상 좋다는 판단이었습니다.
 *
 *  그런데 이 앱은 **한 사람이 씁니다.** 로그인이 필요해졌을 때
 *  "RLS가 auth.uid()를 보기 때문에"라는 그 논리가 통하지 않게 됐습니다.
 *  계정이 없으니 auth.uid()는 늘 null이고, 정책은 하나도 통과하지 못합니다.
 *  결국 RLS는 "누가 이 대화를 볼 수 있나"를 정하는 장치에서
 *  "아무도 볼 수 없다"를 정하는 장치로 바뀔 뿐이었습니다.
 *
 *  policies를 다 걷어내서 아무도 못 보게 하면, 그 다음 문제는
 *  "누가 저장을 하나?"입니다. 답은 서버입니다.
 *
 *  ┌─ 브라우저 ────┐   x-app-token    ┌─ 우리 서버 ──┐   service_role   ┌─ Supabase ─┐
 *  │ 대화 읽기/쓰기 │ ───────────────▶ │ /api/…      │ ───────────────▶ │  DB        │
 *  └──────────────┘                   └─────────────┘                  └────────────┘
 *
 *  이렇게 옮기면 얻는 것:
 *
 *   1. **anon은 아무것도 못 읽습니다.** RLS는 켜져 있고 정책이 0개입니다.
 *      anon 키는 URL을 아는 사람이 이미 갖고 있으므로, 이건 그대로 유지됩니다.
 *   2. **접근 문이 하나입니다.** LLM 호출(`/api/chat`)과 대화 저장이
 *      같은 `x-app-token` 검사를 통과해야 합니다. 이전에는
 *      "PIN은 통과 + RLS는 계정" 두 문이 따로 있었습니다.
 *   3. **service_role이 번들에 들어가지 않습니다.** `NEXT_PUBLIC_` 접두사가
 *      없으므로 Next.js가 클라이언트 번들에 인라인하지 않습니다.
 *
 *  ★ 대가는 분명합니다 ★ — service_role은 RLS를 **완전히 우회**합니다.
 *  이 라우트에서 실수 하나로 "WHERE id = ?"를 빠뜨리면 전체 대화가 나갑니다.
 *  D-019가 그 이유로 anon을 택했고, 지금은 그 논리가 더 이상 성립하지 않아
 *  기꺼이 돌아가는 상황입니다. 그러므로 아래 함수는 **id·kind를 절대 받지 않고**
 *  라우트가 넘겨준 값만 그대로 사용합니다. "화면에서 안 보인다고" 필터를
 *  여기서 기대하지 마세요.
 *
 *  env가 없으면 fail-closed입니다 — 조회하더라도 아무것도 못 고르게 합니다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * 프로젝트 URL은 예전부터 `NEXT_PUBLIC_` 접두사로 두었습니다 (D-019).
 * 이제 브라우저는 Supabase에 직접 붙지 않으므로 접두사가 불필요하지만,
 * 이미 등록된 값을 그대로 쓰게 하려고 두 이름 모두 읽습니다.
 * `SUPABASE_URL`만 두려면 아래 주석대로 .env.local에서 이름을 바꾸면 됩니다.
 */
const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL

/**
 * ★ 이 값에 `NEXT_PUBLIC_` 접두사를 절대 붙이지 마세요. ★
 * 붙는 순간 service_role 키가 JS 번들에 평문으로 실리고,
 * RLS를 완전히 우회하는 권한이 URL을 아는 누구나의 것이 됩니다.
 * 접두사가 없는 변수만 Next.js가 서버 전용으로 취급합니다.
 */
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function isDbConfigured(): boolean {
  return Boolean(URL && SERVICE_ROLE_KEY)
}

let client: SupabaseClient | null = null

export function getServerSupabase(): SupabaseClient {
  if (!isDbConfigured()) {
    throw new Error(
      'Supabase 서버 연결이 설정되지 않았습니다. SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 .env.local에 등록하세요.'
    )
  }
  // 서버에는 세션이 없습니다. 브라우저용 세션 옵션을 켜면 불필요한 부하가 됩니다.
  if (!client) {
    client = createClient(URL as string, SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}
