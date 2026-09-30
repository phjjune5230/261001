-- ============================================================================
--  first_app — Supabase 스키마
-- ============================================================================
--
--  실행 방법: supabase.com 대시보드 → SQL 에디터 → 이 파일 전체 붙여넣기 → Run
--
--  ─────────────────────────────────────────────────────────────────────────
--  이 파일을 먼저 읽고 실행하세요
--  ─────────────────────────────────────────────────────────────────────────
--  RLS(Row Level Security) 정책이 이 앱의 유일한 접근 통제입니다.
--  **테이블을 만들면서 RLS를 켜는 것과, 나중에 켜는 것은 다릅니다.**
--  RLS가 꺼진 상태로 몇 시간이라도 떠 있으면 URL을 아는 사람이 표를 읽고 씁니다.
--  아래 CREATE TABLE마다 RLS를 즉시 켜도록 함께 적어두었습니다.
--
--  ★ 데이터가 새는 거의 유일한 경로가 여기입니다. 함부로 policy를 지우지 마세요.
--
-- ============================================================================


-- ============================================================================
--  1. 대화 (conversations)
-- ============================================================================
--  대화 = 한 줄의 스레드. 채팅과 영어 학습이 같은 구조를 쓰므로
--  kind로만 구분합니다 (D-018 — 별도 테이블을 만들지 않은 이유).

create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'chat'
              check (kind in ('chat', 'english')),

  -- 화면에 표시할 제목. 첫 메시지에서 자동으로 채웁니다.
  title       text not null default '새 대화',

  -- 마지막 대화 때 쓰던 설정. 이어서 열었을 때 복원합니다.
  provider    text,
  model       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- 대화 목록은 "이 사람의 것만, 최신순"으로 조회합니다.
  -- 인덱스가 없으면 대화가 쌓일 때 목록 조회가 느려집니다.
  index conversations_owner_idx on public.conversations (user_id, updated_at desc)
);

-- ─────────────────────────────────────────────────────────────────────────
--  RLS — 이것이 접근 통제 전부입니다
-- ─────────────────────────────────────────────────────────────────────────
--  auth.uid()는 현재 로그인한 사용자 ID를 Postgres가 넣어주는 함수입니다.
--  클라이언트가 이걸 조작할 수는 없습니다 (JWT 서명 검증이 DB에서 이뤄짐).
alter table public.conversations enable row level security;

create policy "conversations_select_own"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "conversations_insert_own"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "conversations_update_own"
  on public.conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "conversations_delete_own"
  on public.conversations for delete
  using (auth.uid() = user_id);


-- ============================================================================
--  2. 소유권 확인 함수 (메시지 RLS 공통 헬퍼)
-- ============================================================================
--  정의가 **메시지 정책보다 먼저**여야 합니다. Postgres는 정책 생성 시점에
--  존재하는 함수만 쓸 수 있으므로 순서가 뒤집히면 "does not exist"로 실패합니다.
--
--  왜 이런 함수가 필요한가:
--  messages에는 user_id를 따로 두지 않습니다. 대신 "상위 대화가 내 것인가"를
--  봅니다. 그러면 대화가 지워질 때 메시지도 함께 지워지는데도
--  user_id가 어긋난 행이 생길 수 없습니다 (denormalize하지 않은 이유).
--
--  이 함수는 conversations만 봅니다. **security definer가 아니므로**
--  호출자의 RLS가 그대로 적용되어 다른 사람 대화를 볼 수 없습니다.

create or replace function public.owns_conversation(conv_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.conversations c
     where c.id = conv_id
       and c.user_id = auth.uid()
  );
$$;


-- ============================================================================
--  3. 메시지 (messages)
-- ============================================================================

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,

  role            text not null check (role in ('user', 'assistant')),
  content         text not null,

  -- assistant만 채워집니다 (영어 학습의 예문/연습 단계, phase 등).
  -- 펼치지 않고 원형으로 넣습니다 (D-016의 turn을 그대로 보존).
  meta            jsonb,

  created_at      timestamptz not null default now(),

  index messages_conversation_idx on public.messages (conversation_id, created_at)
);

alter table public.messages enable row level security;

create policy "messages_select_own"
  on public.messages for select
  using (public.owns_conversation(conversation_id));

create policy "messages_insert_own"
  on public.messages for insert
  with check (public.owns_conversation(conversation_id));

create policy "messages_delete_own"
  on public.messages for delete
  using (public.owns_conversation(conversation_id));


-- ============================================================================
--  4. 메시지 추가 시 대화 메타 갱신
-- ============================================================================
--  목록 정렬이 updated_at에, 목록 표시가 title에 의존합니다. 애플리케이션이
--  하나라도 빠뜨려도 목록이 깨지지 않게 트리거로 처리합니다.
--
--  security definer를 **쓰지 않습니다**. 호출자 권한으로 실행되므로
--  RLS가 적용되고, 소유자가 본인 대화에만 쓸 수 있습니다.

create or replace function public.after_message_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.conversations c
     set updated_at = now(),
         -- 첫 메시지가 들어온 순간에만 제목을 정합니다.
         title = case
                   when c.title = '새 대화' and new.role = 'user'
                   then left(btrim(new.content), 30) || case
                          when length(btrim(new.content)) > 30 then '…' else '' end
                   else c.title
                 end
   where c.id = new.conversation_id
     and c.user_id = auth.uid();

  return new;
end;
$$;

drop trigger if exists messages_after_insert on public.messages;

create trigger messages_after_insert
  after insert on public.messages
  for each row
  execute function public.after_message_insert();


-- ============================================================================
--  5. 확인용 쿼리
-- ============================================================================
--  아래는 읽기 전용입니다. 실행해 보고 주세요.

--  (1) 정책이 붙었는지 — conversations 4개 + messages 3개 = 7개여야 합니다.
--  select tablename, policyname, cmd
--    from pg_policies
--   where schemaname = 'public'
--   order by tablename, policyname;

--  (2) 표가 RLS 모드인지 — 둘 다 true여야 합니다.
--  select relname, relrowsecurity
--    from pg_class
--   where relname in ('conversations', 'messages');

--  (3) 로그인하지 않은 상태(anon)로 아무것도 안 보이는지 — 0이어야 합니다.
--  set role anon;
--  select count(*) from public.conversations;
--  select count(*) from public.messages;
--  reset role;
--
--  (3)에서 0이 아니면 즉시 cancel 하고 policies를 다시 확인하세요.
--  그 상태로는 어떤 데이터든 조회할 수 있습니다.
