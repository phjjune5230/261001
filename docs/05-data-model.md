# 05. 데이터 모델 (Data Model)

## 저장되는 것 총목록

| 무엇 | 어디에 | 언제부터 |
|------|--------|----------|
| 잠금 상태 | `sessionStorage` | v0.2.0 |
| 대화 + 메시지 | Supabase Postgres | v0.5.0 (진행 중) |

> **v0.4.0에 있던 로그인 세션은 v0.5.0에서 없어졌습니다** (D-022).
> 이 앱은 한 사람이 씁니다. 아래 2절도 사라집니다.

---

## 1. 잠금 상태 — `sessionStorage`

`lib/auth-client.ts`가 `first_app_token` 키로 `sessionStorage`에 토큰 하나만 보관합니다.

| 항목 | 설명 |
|------|------|
| 무엇이 저장되나 | `APP_TOKEN` (인증 통과 후 발급된 값) |
| 저장되지 않는 것 | **PIN 자체는 저장되지 않습니다** |
| 수명 | 탭을 닫으면 사라짐 |
| 용도 | 잠금 해제 상태 유지, `/api/chat`의 `x-app-token` 헤더 |

DB에 저장되는 게 아니라 **접근 게이트 상태**일 뿐입니다 (D-007).
D-019 시점에는 이게 사용자 로그인과 별개로 **둘 다 존재**했는데,
D-022에서 로그인이 없어졌으므로 이제 잠금 하나만 남습니다.

> `localStorage`가 아니라 `sessionStorage`인 이유: 개인 앱이라 "항상 로그인 상태"가
> 필요 없고, 탭을 닫으면 다시 잠기는 편이 의도한 동작입니다.

## 2. 대화 — Supabase

정식 스키마는 **`supabase/schema.sql` + `supabase/single-user.sql` 두 개**입니다.
이 문서는 요약일 뿐이고, 실제 실행 대상은 그 파일들입니다.
둘이 어긋나면 **RLS가 빠진 채로 배포되거나** 앱이 저장을 못 합니다.

**반드시 이 순서로 실행하세요.** `schema.sql`이 `user_id`와 정책 7개를 만들고,
`single-user.sql`이 그것들을 걷어냅니다. 순서가 반대면 정책이 함수를 참조한 채
열이 사라집니다.

```sql
conversations
  id          uuid   pk
  kind        text   'chat' | 'english'
  title       text   '새 대화' (첫 메시지로 자동 채움)
  provider    text
  model       text
  created_at  timestamptz
  updated_at  timestamptz                ← 목록 정렬 기준. 메시지 추가 시 트리거로 갱신

messages
  id              uuid   pk
  conversation_id uuid   → conversations(id) on delete cascade
  role            text   'user' | 'assistant'
  content         text
  meta            jsonb  -- 영어 학습의 steps/phase 보관
  created_at      timestamptz
```

### `user_id` 열이 없습니다 (D-022)

이 열은 `not null references auth.users(id)`이었습니다. 로그인이 없어진 뒤에는
`auth.users`에 넣을 행이 없어서 **`service_role` insert가 외래 키에서 실패**했습니다.
그래서 열을 지웠습니다.

RLS 정책이 전부 보던 기준이 이 열이었습니다. 계정이 없으니 `auth.uid()`는 늘 `null`
이고 **어떤 정책도 통과하지 못했습니다.** "누가 이 대화를 볼 수 있나"를 정하는
규칙이 판단 근거를 잃고 "아무도 못 본다"만 남은 상태였습니다.

**RLS는 켜져 있고 정책은 0개입니다.** anon은 아무것도 못 읽습니다.
우회하는 것은 앱 서버의 `service_role`뿐이고, 그건 `x-app-token`을 통과한
요청만 갈 수 있습니다 (`app/api/conversations/**`).

### 왜 대화를 브라우저에서 서버로 옮겼나 (D-022)

`NEXT_PUBLIC_` 접두사가 붙은 환경 변수는 Next.js가 **클라이언트 번들에 평문으로
인라인**합니다. anon 키는 anon 키입니다 — URL을 아는 사람은 이미 갖고 있습니다.
RLS 정책만으로 브라우저 접근을 막으면 그 사람이 REST API를 직접 호출해 대화를
통째로 내려받을 수 있습니다. 대화 저장이 아예 없던 v0.2.0보다 **더 약해지는** 구조였습니다.

서버를 거치게 하면 anon은 아무것도 못 읽고, 접근 문이 `x-app-token` 하나가 됩니다.
`/api/chat`이 provider 크레딧을 지킬 뿐 아니라 대화 저장도 같이 지킵니다.

### 왜 영어와 채팅을 한 테이블에 묶었는가 (D-018)

영어 턴은 `steps[]`(예문·연습)를 갖고 채팅은 그렇지 않습니다. 하지만 그 차이는
**애플리케이션이 아는 문제**이지 스키마가 알 필요는 없습니다. `meta jsonb`로 충분합니다.
분리하면 목록·삭제·권한 로직을 두 벌로 유지해야 합니다.

## 환경 변수 (.env.local)

```env
# 잠금
APP_PIN=6자리 숫자
APP_TOKEN=긴 랜덤 문자열

# LLM provider
OPENROUTER_API_KEY=...
GROQ_API_KEY=...
GEMINI_API_KEY=...

# Supabase (서버 전용)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

> ⚠️ **`SUPABASE_SERVICE_ROLE_KEY`에 `NEXT_PUBLIC_` 접두사를 절대 붙이지 마세요.**
> 이 키는 RLS를 **완전히 우회**합니다. 접두사가 붙는 순간 번들에 평문으로 실려
> URL을 아는 누구나가 전 데이터를 내려받을 수 있습니다.
>
> D-022 이전 문서는 anon 키를 노출해도 괜찮다고 적어 두었습니다.
> 지금은 anon 키조차 클라이언트에서 읽을 필요가 없습니다.
> `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 두 줄은
> `.env.local`에서 지워도 됩니다. (`lib/db-server.ts`는 예전 이름도 읽습니다)
