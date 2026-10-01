-- ============================================================================
--  단일 사용자 전환 (D-022)
-- ============================================================================
--
--  실행 대상: Supabase 대시보드 → SQL Editor → New query → 이 붙여넣기 → Run
--
--  ★ schema.sql을 실행한 뒤에 이걸 실행합니다. 순서가 반대면 실패합니다. ★
--
--  ─────────────────────────────────────────────────────────────────────────
--  무엇을 바꾸나
--  ─────────────────────────────────────────────────────────────────────────
--  로그인(Supabase Auth)을 없앱니다. 이제 혼자 씁니다.
--  그러면 user_id가 남을 이유가 없습니다 — 남겨두면 이 대화가 누구 것인가의
--  답 없는 열이 되고, auth.users에 행이 없으니 넣을 값도 없습니다.
--  이 열이 남아 있으면 service_role로 insert할 때 외래 키에서 실패합니다.
--
--  ─────────────────────────────────────────────────────────────────────────
--  보안은 어떻게 유지되나
--  ─────────────────────────────────────────────────────────────────────────
--  RLS를 **켜 둔 채 정책만 전부 걷어냅니다.**
--  정책이 하나도 없으면 anon role은 아무것도 못 합니다 (RLS가 켜져 있으므로).
--  우리가 쓰는 service_role은 RLS를 우회하므로 영향이 없습니다.
--
--  즉 브라우저 anon 키로는 아무도 대화를 읽을 수 없습니다. 이건 그대로입니다.
--  접근은 앱의 x-app-token 검사를 통해서만 이뤄집니다.
--  안전함은 v0.4.0보다 오히려 올라갑니다 — 그때는 로그인 화면을 못 통과하면
--  RLS가 아무것도 안 보여줬고, 지금은 통과하면 저장까지 되고 막으면 401입니다.
--
--  지금 저장된 대화는 없습니다. 로그인을 완성하기 전이라 한 건도 못 썼습니다.
--  지워지는 열에 잃을 것이 없습니다.
--
--  여러 번 실행해도 안전합니다 (전부 if exists / or replace).
-- ============================================================================


-- 1. 정책을 먼저 모두 걷어냅니다.
--
--    messages 정책이 owns_conversation을 참조하므로, 함수를 지우기 전에
--    정책이 먼저야 합니다. Postgres는 정책 안의 함수 호출을 의존성으로 기록하지
--    않기 때문에 순서가 틀리면 함수는 지워졌는데 정책은 남아 함수를 못 찾습니다.
drop policy if exists "messages_select_own"      on public.messages;
drop policy if exists "messages_insert_own"      on public.messages;
drop policy if exists "messages_delete_own"      on public.messages;
drop policy if exists "conversations_select_own" on public.conversations;
drop policy if exists "conversations_insert_own" on public.conversations;
drop policy if exists "conversations_update_own" on public.conversations;
drop policy if exists "conversations_delete_own" on public.conversations;

drop function if exists public.owns_conversation(uuid);

-- 2. 트리거가 c.user_id를 참조하므로, 열을 지우기 전에 트리거를 내립니다
drop trigger if exists messages_after_insert on public.messages;

-- 3. 이제 열을 지울 수 있습니다
alter table public.conversations drop column if exists user_id;

-- 4. 목록 정렬이 user_id에 묶인 인덱스도 함께 지웁니다.
--    conversations_owner_idx가 (user_id, updated_at desc)입니다.
--    열이 없으면 이 인덱스는 의미가 없고, 남겨두면 나중에
--    updated_at 정렬을 못 타게 만듭니다.
drop index if exists public.conversations_owner_idx;

--    목록은 이제 kind 하나 + updated_at 내림차순으로 조회하므로 그에 맞는
--    인덱스를 다시 만듭니다. (supabase-js는 항상 kind를 필터로 넣습니다)
create index if not exists conversations_kind_updated_idx
  on public.conversations (kind, updated_at desc);

-- 5. 제목 자동 생성 트리거를 단일 사용자 기준으로 다시 만듭니다.
--    내 소유 대화가 아니면 건드리지 않는다, 라는 조건이 사라졌으므로
--    conversation_id만 보면 됩니다.
create or replace function public.after_message_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.conversations c
     set updated_at = now(),
         -- 첫 메시지가 들어온 순간에만 제목을 정합니다.
         -- 공백뿐인 메시지는 제목을 빈 문자열로 만들지 않고 그대로 둡니다.
         title = case
                   when c.title = '새 대화'
                    and new.role = 'user'
                    and btrim(new.content) <> ''
                   then left(btrim(new.content), 30) || case
                          when length(btrim(new.content)) > 30 then '…' else '' end
                   else c.title
                 end
   where c.id = new.conversation_id;

  return new;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row
  execute function public.after_message_insert();

-- 6. RLS는 켜진 채 정책 0개 — anon은 닫혀 있고 service_role만 통과합니다.
--    방금 열을 지우면서 policies가 전부 사라졌으므로 켜져 있음을 다시 확인합니다.
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;


-- ============================================================================
--  확인 — 이 셋이 전부 정상이어야 합니다.
--  하나라도 다르면 브라우저 anon 키로 대화가 노출되므로 배포 전에 꼭 확인하세요.
-- ============================================================================
--
--  (1) 정책 개수 → 0이어야 합니다
--  select count(*) as policies from pg_policies
--   where schemaname = 'public'
--     and tablename in ('conversations', 'messages');
--
--  (2) RLS 켜짐 여부 → 둘 다 t
--  select relname, relrowsecurity from pg_class
--   where relname in ('conversations', 'messages');
--
--  (3) anon으로 아무것도 안 되는지 → 둘 다 0
--  begin;
--    set local role anon;
--    select count(*) as conversations from public.conversations;
--    select count(*) as messages from public.messages;
--  rollback;
--
--  (3)에서 0이 아니면 즉시 cancel 하고 (1)을 다시 확인하세요.
--  그 상태로는 어떤 데이터든 조회할 수 있습니다.
