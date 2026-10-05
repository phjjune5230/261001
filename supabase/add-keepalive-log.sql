-- ============================================================================
--  keepalive 이력 — 하루 한 번의 결과를 남긴다 (v0.20.0)
--
--  실행 대상: Supabase 대시보드 → SQL Editor → New query → 이 붙여넣기 → Run
--
--  ─────────────────────────────────────────────────────────────────────────
--  왜 필요한가
--
--  Vercel Hobby 요금제의 런타임 로그 보관 기간은 **1시간**입니다
--  (Pro는 1일, Observability Plus 30일은 Pro 전용). 하루에 한 번 도는
--  작업의 기록이 한 시간 뒤 사라진다면 기록할 이유가 없습니다.
--
--  또한 Hobby에서는 Log Drains(로그를 외부로 보내는 기능)를 쓸 수 없습니다.
--  Vercel 안에는 오래 둘 자리가 없습니다.
--
--  그래서 **자기 DB에 직접 남깁니다.** keepalive 는 service_role 로 접속하므로
--  RLS 를 우회합니다. 그래서 정책은 하나도 필요 없고, 쓰기가 됩니다.
--
--  ─────────────────────────────────────────────────────────────────────────
--  보안
--
--  anon 공개 정책은 **의도적으로 만들지 않습니다.** RLS 만 켜면 닫혀 있어서
--  브라우저(읽기 전용 뷰어)에서는 이 표가 보이지 않습니다.
--  keepalive_runs 에는 provider 이름과 모델명이 들어가므로 굳이 열 필요가 없습니다.
--  보고 싶게 되면 그때 정책 한 줄을 추가하세요.
--
-- Cleanup: 라우트가 90일 지난 행을 지웁니다. 하루 한 줄이라 90일이면 90행뿐이고
--  아무도 지우지 않아도 크지는 않지만, "적히는 것만 있고 안 지워지는" 표는
--  어느새 무거워집니다.
--
--  여러 번 실행해도 안전합니다 (if not exists / or replace).
-- ============================================================================


create table if not exists public.keepalive_runs (
  id         uuid primary key default gen_random_uuid(),

  -- 이 실행이 시작된 시각 (서버 시각 기준).
  ran_at     timestamptz not null default now(),

  -- provider 가 하나라도 실패했으면 false.
  ok         boolean not null,

  -- 실패한 provider 이름. 없으면 빈 배열.
  failed     text[] not null default '{}',

  -- 전체 소요 시간.
  total_ms   integer not null default 0,

  -- provider별 결과 전문.
  --   { provider, model, ok, kind, status, finishReason, ms, saved, readBack, note }
  -- 열을 쪼개지 않고 통째로 넣습니다. 라우트의 응답 형태가 앞으로 바뀔 수
  -- 있고, 이 표는 그 "그날의 사실"을 그대로 보존할 자리가 아니라 요약일
  -- 뿐이기 때문입니다. 필요한 값은 조회할 때 JSON 에서 뽑습니다.
  results    jsonb not null default '[]'::jsonb
);

-- 목록 조회는 항상 "최근 것부터"입니다. 정렬 없이는 이 인덱스를 못 탑니다.
create index if not exists keepalive_runs_ran_at_idx
  on public.keepalive_runs (ran_at desc);

-- RLS 는 켜되 정책은 0개 — anon 은 닫혀 있고 service_role 만 통과합니다.
alter table public.keepalive_runs enable row level security;

-- 캐스팅은 create table 안에서 타입을 이미 박아뒀으므로 필요 없습니다.
-- (Supabase SQL 에디터가 권한별로 막는 경우가 있어 공개 스키마 권한은 손대지 않습니다)


-- ============================================================================
--  확인
--
--  (1) 표가 있고 RLS 가 켜져 있는지
--  select relname, relrowsecurity from pg_class where relname = 'keepalive_runs';
--
--  (2) 정책이 0개인지 (0 이어야 정상입니다 — 열면 브라우저에 보입니다)
--  select count(*) from pg_policies
--   where schemaname = 'public' and tablename = 'keepalive_runs';
--
--  (3) 첫 실행이 끝난 뒤 다시 확인하면 행이 보여야 합니다
--  select ran_at, ok, failed, total_ms, results from public.keepalive_runs
--   order by ran_at desc limit 5;
-- ============================================================================