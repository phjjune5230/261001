-- ============================================================================
--  영어 학습 기록 (v0.8.0)
--
--  실행 대상: Supabase 대시보드 → SQL 에디터 → New query → 이 붙여넣기 → Run
--
--  ★ 실행 순서: schema.sql → single-user.sql → 이 파일 ★
--
--  ─────────────────────────────────────────────────────────────────────────
--  무엇을 하나
--  영어 대화가 "채팅"이 아니라 "연습"이 되려면 남는 것이 있어야 합니다.
--  세 개의 표를 둡니다.
--
--    english_sessions      세션 하나. 무슨 상황이었는지, 마무리 요약이 뭔지
--    english_error_records 내가 실제로 틀린 것 (원문 / 수정 / 사유 / 분류)
--    english_chunks        말할 수 있는 구슬 (단어가 아니라 구 단위)
--
--  ─────────────────────────────────────────────────────────────────────────
--  왜 conversations·messages를 고치지 않았나
--  ─────────────────────────────────────────────────────────────────────────
--  messages.meta는 영어 턴 복원 전용입니다 (예문·번역).
--  여기에 누적 학습 기록을 섞으면 원본과 파생이 한 덩어리가 되고,
--  나중에 하나를 고칠 때 다른 하나가 깨집니다.
--  그래서 새 표를 만듭니다. 기존 표는 **건드리지 않습니다.**
--
--  app/api/conversations/[id]/messages/route.ts의 meta 주석과 같은 판단입니다.
--
--  ─────────────────────────────────────────────────────────────────────────
--  왜 conversation_id를 every 테이블에 두나
--  ─────────────────────────────────────────────────────────────────────────
--  오류가 "어느 대화에서" 났는지 알 수 없으면 다음 세션 복원이 근거 없이 됩니다.
--  세션 표의 conversation_id가 정본이고, 나머지 두 표도 conversation_id를
--  들고 있어서 대화 하나만 지우면 그 대화의 학습 기록이 함께 정리됩니다.
--
--  ─────────────────────────────────────────────────────────────────────────
--  왜 foreign key를 걸었나
--  ─────────────────────────────────────────────────────────────────────────
--  대화를 지우면 messages는 on delete cascade로 사라집니다
--  (supabase/schema.sql). 학습 기록도 같은 규칙을 따릅니다 — 사용자가
--  대화를 지웠는데 그 대화의 오류 목록이 남으면 "내가 언제도 안 한 실수"가 됩니다.
--
--  ─────────────────────────────────────────────────────────────────────────
--  실행 안 했어도 앱은 돌아갑니다
--  ─────────────────────────────────────────────────────────────────────────
--  lib/db.ts의 영어 학습 기록 함수는 읽기·쓰기가 실패를 삼키고 빈 값/False를
--  돌려줍니다. lib/compaction.ts와 같은 방식입니다 —
--  "기록이 꺼진 상태"는 정상 상태로 취급해야 합니다.
--  500을 내면서 "SQL 하나 실행하세요"라고 하는 것보다 조용히 비어 있는 편이 낫습니다.
--
--  여러 번 실행해도 안전합니다 (전부 if not exists).
-- ============================================================================


-- ============================================================================
--  1. 세션 (english_sessions)
-- ============================================================================
--
--  대화 하나 = 세션 하나입니다. conversation_id가 unique인 이유가 여기 있습니다.
--  대화가 만들어지기 전에 세션을 만들 수 없어야 하므로 같은 줄이 두 번 생기지 않습니다.
--
--  scenario는 고른 상황입니다 (예: '가격 협상'). 자유 입력일 수 있어서 check를 걸지 않습니다.

create table if not exists public.english_sessions (
  id              uuid primary key default gen_random_uuid(),

  -- 대화를 지우면 세션도 함께 사라집니다.
  conversation_id uuid not null unique
                  references public.conversations(id) on delete cascade,

  -- 무슨 상황이었나. 화면에서 고르거나 직접 입력합니다.
  scenario        text not null default '',

  -- 마무리 요약 원문. 나중에 복습 화면에서 다시 보여줍니다.
  summary         text not null default '',

  created_at      timestamptz not null default now(),
  ended_at        timestamptz
);

-- RLS는 CREATE와 함께 켭니다. 나중에 켜는 것과 다릅니다
-- (supabase/schema.sql 헤더 참고 — 이 저장소에서 데이터가 새는 거의 유일한 경로).
--
-- 정책은 0개입니다 (supabase/single-user.sql의 단일 사용자 전환과 동일).
-- anon은 아무것도 못 하고, service_role만 RLS를 우회합니다.
alter table public.english_sessions enable row level security;


-- ============================================================================
--  2. 자기 오류 (english_error_records)
-- ============================================================================
--
--  ★ 교정을 대화 중에 하지 않는 것 ★
--  이 표가 쌓이는 것이 이 기능의 존재 이유입니다. 대화 중 교정을 넣으면
--  학습자는communicative intent를 유지하는 일과 형태를 고치는 일을 동시에 하게
--  되고, 발화가 줄어듭니다 (lib/lesson.ts 헤더 참고).
--
--  category는 **자유 텍스트가 아니라 고정 목록**입니다.
--  이 분류가 "지금 무엇을 연습할지"를 결정하는 근거가 됩니다.
--  자유 텍스트로 두면 나중에 무엇을 고를지 결정할 수 없으므로,
--  8개로 고정하고 lib/lesson.ts의 ERROR_CATEGORIES가 이 목록의 유일한 출처입니다.
--  새 분류를 추가할 때는 그 상수와 이 check constraint를 같이 고칩니다.
--
--  원본·수정·사유를 다 남깁니다. 나중에 "이 오류를 왜 그때 안 고쳤나"를 볼 수 있어야
--  기록이 기록이 됩니다. 사유(reason)는 한국어 한 줄입니다.

create table if not exists public.english_error_records (
  id              uuid primary key default gen_random_uuid(),

  conversation_id uuid not null
                  references public.conversations(id) on delete cascade,

  -- 어느 세션에서 났나. 대화를 지우면 함께 지워집니다.
  session_id      uuid references public.english_sessions(id) on delete cascade,

  -- 이 대화의 몇 번째 사용자 발화였나.
  -- 영어 대화는 턴이 추가되고 복원되므로 messages의 순번과 어긋납니다.
  -- 그래서 DB의 순번이 아니라 대화 안에서의 위치를 기록합니다.
  turn_index      int  not null default 0,

  -- 학습자가 실제로 쓴 문장
  original        text not null,

  -- 고쳐진 버전
  corrected       text not null default '',

  -- 왜 틀렸나 (한국어 한 줄)
  reason          text not null default '',

  -- 고정 8분류. 값은 lib/lesson.ts의 ERROR_CATEGORIES와 같습니다.
  category        text not null default 'other'
                  check (category in (
                    'tense',          -- 시제
                    'article',        -- 관사
                    'preposition',    -- 전치사
                    'word_order',     -- 어순
                    'agreement',      -- 주어-동사 일치
                    'connector',      -- 접속·연결
                    'lexical_choice', -- 어휘 선택
                    'other'           -- 위 저로 분류하지 않는 것
                  )),

  created_at      timestamptz not null default now()
);

-- 복습 화면과 "이 대화가 다루던 오류" 조회가 이 인덱스를 탑니다.
-- 최근 것부터 보여줄 일이 대부분이므로 updated가 아니라 created_at 내림차순입니다.
create index if not exists english_error_records_conv_created_idx
  on public.english_error_records (conversation_id, created_at desc);

alter table public.english_error_records enable row level security;


-- ============================================================================
--  3. 배운 표현 (english_chunks)
-- ============================================================================
--
--  ★ 단어가 아니라 구 단위로 남깁니다 ★
--  "I was wondering if …", "let me get back to you on that" 같은 것.
--  네이티브도 사전적 어휘보다 이런 구슬을 씁니다. 단어를 외워도 조합을 못 하면
--  대화되지 않습니다. 유창성을 가장 빨리 올리는 지름길은 말할 수 있는 구슬의 개수입니다.
--
--  phrase_key = lower(trim(phrase)).
--  같은 구를 또 배우면 **행을 늘리지 않고** seen_count를 올립니다.
--  같은 실수가 세 행으로 쌓이면 "반복 횟수"를 읽는 사람이 헷갈립니다.
--
--  ★ 반복 간격 정책은 아직 정하지 않습니다 ★
--  오류 빈도인지 경과 시간인지 마지막 실패 시점인지는 계측이 쌓인 뒤에 정합니다.
--  지금 정하려 들면 추측을 코드에 박는 것이 됩니다 (docs/10-english-guide.md §5).
--  그래서 이 표는 last_seen_at과 seen_count만 쌓아 두고, 꺼내는 시점은
--  lib/lesson.ts의 주석에 있는 규칙을 나중에 정합니다.

create table if not exists public.english_chunks (
  id              uuid primary key default gen_random_uuid(),

  conversation_id uuid not null
                  references public.conversations(id) on delete cascade,

  -- 이 표현을 처음 만난 세션. 세션을 지워도 표현은 남습니다 (재사용 가능한 자산).
  session_id      uuid references public.english_sessions(id) on delete set null,

  -- 구 자체. 원형 그대로 저장합니다 (표시용).
  phrase          text not null,

  -- 중복 판정용 정규화 값
  phrase_key      text not null unique,

  -- 한국어 뜻. 한 줄.
  meaning         text not null default '',

  -- 이 표현이 나온 상황
  scenario        text not null default '',

  -- 몇 번 만났나
  seen_count      int  not null default 1,

  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

-- 다음 세션 첫 턴에 "지난 표현을 먼저 꺼낸다"가 이 인덱스를 탑니다.
-- 오래 본 것부터가 아니라 최근 것부터가 아니라, 지금 정책이 없습니다.
-- 인덱스만 준비해 두고 정렬 기준은 그때 정합니다.
create index if not exists english_chunks_last_seen_idx
  on public.english_chunks (last_seen_at desc);

alter table public.english_chunks enable row level security;


-- ============================================================================
--  확인 — 이것들이 전부 정상이어야 합니다.
-- ============================================================================
--
--  (1) 세 테이블이 생겼는지
--  select table_name from information_schema.tables
--   where schemaname = 'public' and table_name like 'english_%';
--      → english_sessions / english_error_records / english_chunks
--
--  (2) 정책 개수 → 0이어야 합니다
--  select count(*) as policies from pg_policies
--   where schemaname = 'public' and tablename like 'english_%';
--      → 0
--
--  (3) RLS 켜짐 여부 → 셋 다 t
--  select relname, relrowsecurity from pg_class
--   where relname like 'english_%';
--
--  (4) anon으로 아무것도 안 되는지 → 셋 다 0
--  begin;
--    set local role anon;
--    select count(*) from public.english_sessions;
--    select count(*) from public.english_error_records;
--    select count(*) from public.english_chunks;
--  rollback;
--
--  (2)~(4)에서 하나라도 다르면 cancel 하고 처음부터 다시 확인하세요.
--  특히 (4)가 0이 아니면 즉시 cancel 입니다.
