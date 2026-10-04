// ─────────────────────────────────────────────
//  값만 채우세요. 이 파일은 브라우저로 그대로 나갑니다.
//
//  ⚠️ 넣어도 되는 키: **publishable 키** (옛 이름: anon 키)
//  ⚠️ 절대 넣으면 안 되는 키: **secret 키** (옛 이름: service_role 키)
//
//  publishable 키는 원래 공개용입니다 — Supabase가 클라이언트 SDK에 처음부터
//  넣어 주는 키입니다. 넣었다고 해서 뚫리는 게 아니고, 실제로 무엇이 되는지는
//  supabase/viewer-read-only.sql 에 있는 RLS 정책이 정합니다.
//  그 스크립트에는 SELECT 정책 두 개만 있고 쓰기 정책은 하나도 없습니다.
//
//  ★ 헷갈리기 쉬운 지점 ★
//  .env.local 에는 두 가지가 있습니다.
//    SUPABASE_PUBLISHABLE_KEY  ← 이거
//    SUPABASE_SERVICE_ROLE_KEY  ← 절대 아님
//  앞 15글자로 구별합니다:
//    sb_publishable_…  → 맞음
//    sb_secret_…       ← 나쁜 것
//    eyJ… (JWT 형식)   → 옛 키입니다. 대시보드 목록에서 "anon public"
//                        행을 쓰세요. 같은 자리에 있는 "service_role" 행은 아닙니다.
//
//  secret 키(service_role)는 RLS를 완전히 우회합니다. 이 파일에 한 줄만
//  넣어도 대화 전체를 읽고 지울 수 있는 키가 정적 파일에 박힙니다.
//  ─────────────────────────────────────────────

// Supabase 대시보드 → Project Settings → API
// 예: https://abcdefghijklmnop.supabase.co
export const SUPABASE_URL = 'https://ojcjcnpszafamjsnmrvg.supabase.co'

// 같은 화면의 "anon public" 키.
// (목록에 있는 "service_role" 키가 아니라 그 위에 있는 anon/public입니다)
export const PUBLISHABLE_KEY = 'sb_publishable_adTl3tZg9s0KGoon4Lhijg_EPcyg5SN'