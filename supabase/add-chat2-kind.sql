-- ============================================================================
--  App — 채팅2(kind='chat2') 허용
-- ============================================================================
--
--  채팅2(/chat2)는 기존 conversations 테이블을 그대로 씁니다.
--  단, kind check 제약이 ('chat', 'english')만 허용해서
--  'chat2'로 삽입하면 DB에서 거절됩니다. 이 스크립트로 풀어줍니다.
--
--  Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 → Run
--
--  이 스크립트를 실행하지 않은 배포에서는 채팅2 저장이 조용히 꺼져 있고,
--  채팅 자체는 그대로 동작합니다 (useConversations의 storageOk 설계).
--  기존 채팅·영어 데이터에는 영향이 없습니다.
-- ============================================================================

do $$
declare
  r record;
begin
  -- kind 열에 걸린 check 제약을 찾아서 지웁니다 (이름이 자동 생성이라 고정하지 않음).
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.conversations drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('chat', 'english', 'chat2'));
