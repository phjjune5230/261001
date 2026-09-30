# 05. 데이터 모델 (Data Model)

## 저장되는 것 총목록

| 무엇 | 어디에 | 언제부터 |
|------|--------|----------|
| 잠금 상태 | `sessionStorage` | v0.2.0 |
| 로그인 세션 | Supabase Auth (localStorage) | v0.4.0 (진행 중) |
| 대화 + 메시지 | Supabase Postgres | v0.4.0 (진행 중) |

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
이건 사용자 로그인과 **다른 것**입니다 (D-019) — 둘 다 존재합니다.

> `localStorage`가 아니라 `sessionStorage`인 이유: 개인 앱이라 "항상 로그인 상태"가
> 필요 없고, 탭을 닫으면 다시 잠기는 편이 의도한 동작입니다.

## 2. 로그인 세션 — Supabase Auth

브라우저가 직접 처리합니다 (`localStorage`). 앱 코드가 토큰을 만들지 않고
`supabase.auth`가 저장·갱신합니다. 유효하면 RLS에서 `auth.uid()`로 쓰입니다.

## 3. 대화 — Supabase

정식 스키마는 **`supabase/schema.sql` 하나**입니다. 이 문서는 요약일 뿐이고,
실제 실행 대상은 그 파일입니다. 둘이 어긋나면 **RLS가 빠진 채로 배포될 위험**이 있습니다.

```sql
conversations
  id          uuid   pk
  user_id     uuid   → auth.users(id)     ← 이 컬럼이 없으면 사람 구분 자체가 안 됨
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

### 왜 `messages`에 `user_id`가 없는가

각 행에 넣어두면(denormalize) 대화가 지워졌을 때 메시지만 남는 상황이 생깁니다.
그래서 상위 대화의 소유권을 조회하는 헬퍼(`owns_conversation()`)로 판정합니다.
성능 차이는 이 규모에서 무시할 만하고, 정합성 이득이 큽니다.

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

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

> Supabase 두 값만 `NEXT_PUBLIC_`이 붙습니다 — 브라우저가 직접 로그인해야 하므로
> 접두사가 없으면 클라이언트가 서버를 거치지 못합니다. anon key는 RLS에 막히므로
> **노출되어도 괜찮고, RLS가 전부입니다.**
> `service_role` 키는 절대 넣지 마세요 — RLS를 전부 우회합니다.
