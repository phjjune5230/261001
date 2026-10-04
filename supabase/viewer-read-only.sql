-- ============================================================================
--  읽기 전용 뷰어 — anon에 SELECT만 연다 (v0.19.0)
--
--  실행 대상: Supabase 대시보드 → SQL Editor → New query → 이 붙여넣기 → Run
--
--  ─────────────────────────────────────────────────────────────────────────
--  무엇을 하나
--  conversations / messages 에 anon 공개 읽기 정책 두 개만 만듭니다.
--  쓰기 정책은 하나도 만들지 않습니다.
--
--  지금은 정책이 0개 상태입니다 (supabase/single-user.sql 의 마지막 단계).
--  RLS가 켜진 채 정책이 없으면 anon은 아무것도 못 합니다. 여기에
--  SELECT 정책 하나씩만 더하는 것입니다.
--
--  ★ 본체 앱(Vercel)에 아무 영향이 없습니다 ★
--  first_app은 service_role로 접속합니다. service_role은 RLS를 우회하므로
--  정책이 늘어난 것을 통째로 통과합니다. 채팅·저장·삭제가 그대로 동작합니다.
--  되돌릴 때도 본체가 멈추지 않습니다.
--
--  ─────────────────────────────────────────────────────────────────────────
--  ★ 보안 현실 — 이 스크립트를 실행하기 전에 반드시 읽으세요 ★
--
--  이 정책은 **세상이 읽을 수 있게** 하는 겁니다. 사내망에서만 읽히게
--  만드는 장치가 아닙니다.
--
--    · anon 키는 원래 공개용입니다. 뷰어 번들에 그대로 들어갑니다.
--    · Supabase 프로젝트 URL도 공개됩니다 (뷰어가 접속해야 하므로).
--    · 따라서 두 가지를 알면 누구나 anon 키로 대화 전체를 읽을 수 있습니다.
--    · 사내망 차단은 그걸 막아주지 않습니다. 막는 것은 이 RLS 정책입니다.
--
--  그럼에도 하는 이유
--    · 쓰기·삭제는 애초에 불가능합니다 (정책이 없으므로).
--    · anon 키로 노출되는 다른 표는 없습니다 (여기 두 표만 엽니다).
--    · conversations 삭제 → messages 는 on delete cascade 지만
--      delete 정책이 없으므로 지울 수 없습니다.
--
--  정말 문이 필요하면
--    Supabase Auth 로 이메일 사용자 하나를 만들고 정책을
--      using (auth.uid() = '<그 사용자 uuid>')
--    로 바꾸면 anon 키만으로는 아무것도 못 읽습니다. 뷰어에 로그인 화면이
--    하나 붙는 대가입니다. 지금은 하지 않습니다 — 개인 대화 한 벌을 보고
--    읽기만 하는 용도라 지금은 필요하지 않습니다.
--    필요해지면 이 스크립트의 policy 본문 두 줄만 바꾸면 됩니다.
--
--  여러 번 실행해도 안전합니다 (drop if exists 후 create).
-- ============================================================================


-- 1. conversations — 목록 읽기
drop policy if exists "viewer_read_conversations" on public.conversations;
create policy "viewer_read_conversations"
  on public.conversations for select
  to anon
  using (true);

-- 2. messages — 본문 읽기
drop policy if exists "viewer_read_messages" on public.messages;
create policy "viewer_read_messages"
  on public.messages for select
  to anon
  using (true);

--  ★ 쓰기 정책은 의도적으로 없습니다. ★
--  INSERT / UPDATE / DELETE 를 허용하려면 정책 하나씩이 더 필요합니다.
--  필요한 판단이 생기면 그때 추가하세요. 지금은 읽기만 필요합니다.


-- ============================================================================
--  확인 — 셋 다 만족해야 합니다.
--
--  (1) 정책 개수 → 2 (테이블당 1개씩), 그리고 둘 다 'select'
--  select tablename, policyname, cmd, roles::text from pg_policies
--   where schemaname = 'public'
--     and tablename in ('conversations', 'messages')
--   order by tablename, policyname;
--
--  (2) RLS 켜짐 여부 → 둘 다 t
--  select relname, relrowsecurity from pg_class
--   where relname in ('conversations', 'messages');
--
--  (3) anon 으로 읽기 → 둘 다 0보다 크다 (읽기가 되야 합니다)
--  (4) anon 으로 쓰기 → 실패해야 합니다 (이게 중요합니다)
--  begin;
--    set local role anon;
--    select count(*) as 읽기가능 from public.conversations;   -- (3)
--    select count(*) as 읽기가능 from public.messages;        -- (3)
--    insert into public.conversations (kind, title) values ('chat', '쓰기시도');  -- (4) 실패해야 정상
--    delete from public.messages;                                             -- (4) 실패해야 정상
--  rollback;
--
--  (4)에서 insert/delete 가 성공하면 즉시 cancel 하고 (1)을 다시 보세요.
--  조회 정책이 쓸 수 있는 정책으로 잘못 떨어졌다는 뜻입니다.
-- ============================================================================

-- 되돌리기 (뷰어를 닫으려면 아래 두 줄)
-- drop policy if exists "viewer_read_conversations" on public.conversations;
-- drop policy if exists "viewer_read_messages" on public.messages;