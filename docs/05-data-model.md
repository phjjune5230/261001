# 05. 데이터 모델 (Data Model)

## Phase 1: DB 없음

Phase 1은 DB가 필요 없습니다. 저장되는 것은 두 군데뿐입니다.

### 1. 대화 히스토리 — 저장되지 않음

대화는 `app/chat/page.tsx`의 React `useState`에만 있습니다.
**새로고침하면 사라집니다.** 브라우저 저장소에도, 서버에도 남지 않습니다.

### 2. 잠금 상태 — `sessionStorage`

`lib/auth-client.ts`가 `first_app_token` 키로 `sessionStorage`에 토큰 하나만 보관합니다.

| 항목 | 설명 |
|------|------|
| 무엇이 저장되나 | `APP_TOKEN` (인증 통과 후 발급된 값) |
| 저장되지 않는 것 | **PIN 자체는 저장되지 않습니다** |
| 수명 | 탭을 닫으면 사라짐 |
| 용도 | 잠금 해제 상태 유지, `/api/chat`의 `x-app-token` 헤더 |

DB에 저장되는 게 아니라 **접근 게이트 상태**일 뿐입니다 (D-007).

> `localStorage`가 아니라 `sessionStorage`인 이유: 개인 앱이라 "항상 로그인 상태"가
> 필요 없고, 탭을 닫으면 다시 잠기는 편이 의도한 동작입니다.

## Phase 2+: Supabase 스키마 (예정)

```sql
-- goals (목표 관리, Phase 3)
CREATE TABLE goals (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date DATE,
  status TEXT DEFAULT '진행중',  -- 진행중, 완료, 미완료, 검토예정
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- chat_sessions (대화 히스토리, Phase 2+)
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  provider TEXT,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- chat_messages (대화 메시지, Phase 2+)
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES chat_sessions(id),
  role TEXT NOT NULL,  -- user, assistant
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 환경 변수 (.env.local)

```env
# Supabase (Phase 2+)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
```

> 이 두 값은 계획이며 아직 코드에서 쓰이지 않습니다.
> 잠금 관련 환경 변수(`APP_PIN`, `APP_TOKEN`)는 `docs/04-api-contract.md`를 보세요.
