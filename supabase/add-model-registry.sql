-- ============================================================================
--  모델 레지스트리 (models)
--
--  실행 대상: Supabase 대시보드 → SQL Editor → New query → 이 붙여넣기 → Run
--
--  ★ schema.sql → single-user.sql → (add-compaction.sql) 순으로 이미 실행한 뒤. ★
--
--  ─────────────────────────────────────────────────────────────────────────
--  무엇을 하나
--  "어떤 모델을 쓰고 그 모델의 한도가 얼마인가"를 앱 안에서 고르게 합니다.
--  이 표가 그 단일 출처입니다.
--
--  ─────────────────────────────────────────────────────────────────────────
--  왜 lib/models.ts만으로 안 되는가
--  v0.12.0까지 모델 목록은 코드에 박혀 있었습니다. 고치려면 파일을 열고
--  고쳐서 배포해야 했습니다. 강한 무료 모델이 나왔을 때 쓸 수 있게 하려면
--  배포 한 번이 필요했고, 그래서 아무것도 못 넣고 있었습니다.
--
--  그래서 **실제로 쓰는 값을 이 표로 옮깁니다.**
--  lib/models.ts는 이제 이 표의 시드이자 안전망입니다 —
--  이 표가 비어 있거나 못 읽히면 그 값으로 돌아갑니다 (lib/model-registry.ts).
--  그러므로 이 스크립트를 실행하지 않아도 앱은 예전 그대로 돌아갑니다.
--
--  ─────────────────────────────────────────────────────────────────────────
--  ⚠️ 실행 후에도 지우지 마세요
--  이 표가 사라지면 사용자가 등록한 모델이 조용히 사라집니다.
--  그런데 앱은 "오류"가 아니라 "기본 목록"으로 돌아가므로 아무도 모릅니다.
--  (압축이 조용히 꺼지는 것과 같은 종류의 사고입니다 — 그래서 여기 적습니다)
--
--  여러 번 실행해도 안전합니다 (if not exists + on conflict do nothing).
-- ============================================================================


-- ============================================================================
--  1. 표
--
--  provider는 lib/llm.ts의 ALL_PROVIDERS와 같은 셋입니다.
--  provider를 더 추가하려면 코드와 이 조건을 **둘 다** 고쳐야 합니다.
--  한쪽만 고치면 그 provider의 모델이 자꾸 조용히 사라집니다.

create table if not exists public.models (
  provider    text not null
              check (provider in ('openrouter', 'groq', 'gemini')),

  -- provider API에 그대로 넘기는 model ID. 이게 실제 키입니다.
  model_id    text not null,

  -- 화면 표시용 이름. 겉보기용이므로 중복되어도 됩니다.
  name        text not null,

  -- ★ 우리가 정하는 출력 상한 ★ provider 규약이 아니라 선택입니다.
  -- 여기서 1을 줄이면 입력 예산이 그만큼 늘어납니다 (lib/context.ts).
  max_tokens  integer not null check (max_tokens > 0),

  -- provider가 정한 분당 토큰 한도. 모르면 null — 숫자를 지어내면
  -- 예산 계산에 그대로 쓰이므로 조용히 틀어집니다 (lib/models.ts와 같은 원칙).
  tpm         integer check (tpm is null or tpm > 0),

  -- provider가 정한 분당 요청 수 한도. 지금은 표시만 됩니다.
  rpm         integer check (rpm is null or rpm > 0),

  -- ★ 순서 = 우선순위 ★
  -- lib/models.ts의 defaultModelFor()는 "목록의 첫 번째"를 기본 모델로 삼습니다.
  -- 순서 열이 없으면 이게 매번 달라집니다 — 버그입니다.
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (provider, model_id)
);

create index if not exists models_provider_order_idx
  on public.models (provider, sort_order);


-- ============================================================================
--  2. RLS — 다른 표와 똑같이 켜고, 정책은 두지 않습니다.
--
--  service_role만 이 표를 읽습니다 (lib/db-server.ts).
--  anon·authenticated에게는 열려 있으면 안 되므로 정책이 0개여야 합니다.
--  다른 표와 상태가 달라지면 데이터가 새는 길이 생깁니다.

alter table public.models enable row level security;


-- ============================================================================
--  3. 시드 — v0.12.0 시점의 lib/models.ts 값을 그대로 옮깁니다.
--
--  on conflict do nothing이라 이미 넣은 값을 덮어쓰지 않습니다.
--  이 표를 어느 정도 쓰고 난 뒤에 이 스크립트를 다시 돌려도 지워진 모델이
--  되살아나지는 않습니다. 되살리려면 직접 넣으세요.

insert into public.models (provider, model_id, name, max_tokens, tpm, rpm, sort_order)
values
  -- openrouter: TPM 제한 없음. 무료 모델에 분당 20회 한도가 따로 있습니다.
  ('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free',
   'nemotron-3-ultra-550b-a55b', 2000, null, null, 0),
  ('openrouter', 'nvidia/nemotron-3.5-lightning:free',
   'nemotron-3.5-lightning', 2000, null, null, 1),

  -- groq: 2026-10-03 실측 console.groq.com/docs/rate-limits, Developer Plan
  ('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B', 2000, 8000, 30, 0),
  -- qwen의 한도는 확인하지 않았습니다. 지어내지 않고 tpm을 지웠다가
  -- 실측 값(8000)을 되돌려 넣었습니다 — 주석은 lib/models.ts에 있습니다.
  ('groq', 'qwen/qwen3.8-27b', 'QWEN3.8-27b', 2000, 8000, 30, 1),

  -- gemini: free tier는 분당 토큰이 아니라 일별 호출 수(모델당 20~500회)가 걸립니다.
  -- tpm/rpm에 담지 않는 제약이라 여기 숫자로 옮길 수 없습니다.
  ('gemini', 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', 2000, 250000, 15, 0)
on conflict (provider, model_id) do nothing;


-- ============================================================================
--  확인 — 실행 후 아래가 나와야 합니다.
--
--  (1) 5행이 보여야 합니다.
--  select provider, model_id, max_tokens, tpm, rpm, sort_order
--    from public.models order by provider, sort_order;
--
--  (2) ★ 핵심 ★ 이 값이 false면 다른 표에서 데이터가 새는 길이 생깁니다.
--      다른 표도 같이 보고 셋 모두 true여야 합니다.
--  select relname, relrowsecurity, relforcerowsecurity from pg_class
--   where relname in ('conversations', 'messages', 'models');
--
--  (3) 로그인하지 않은 상태로 0이어야 합니다.
--  set role anon;
--  select count(*) from public.models;
--  reset role;
--
--  (2)에서 f가 하나라도 나오면 cancel 하고 single-user.sql을 다시 실행하세요.
--  (3)에서 0이 아니면 즉시 cancel 하세요.