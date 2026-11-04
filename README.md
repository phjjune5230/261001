# App

개인 실 사용 AI 어시스턴트. provider를 직접 골라 쓰고, 대화는 어디서든 이어갑니다.

- **채팅** — `/chat`
- **영어 학습** — `/english`
- **운영 중** — https://261001-zeta.vercel.app (push 하면 자동 배포)

> push 는 이 폴더에서만 합니다. **2026-11-04에 원격 복구 완료** (`origin` upstream 설정됨).
> 현재 reflog 일부가 손상되어 `git push --tags` 는 금지입니다. 첫 push 전에 `../GIT_PUSH.md` §0 를 읽으십시오.

> 이 폴더는 June_APP의 사용자 앱입니다. DB 프로젝트의 시장 데이터와 독립적으로 동작합니다.

---

## 읽는 순서

먼저 이 README로 앱과 실행 방법을 파악하고, 필요한 주제의 문서를 이어서 읽습니다.

| | 파일 | 답해 주는 것 |
|---|---|---|
| 1 | `README.md` (이 파일) | 이게 뭔가, 어떻게 도는지 |
| 2 | [`docs/RULE.md`](docs/RULE.md) | 구현 시 지킬 규칙 — 코딩 전에 읽음 |
| 3 | [`docs/BACKLOG.md`](docs/BACKLOG.md) | 아직 안 된 것 |
| 4 | [`docs/10-english-guide.md`](docs/10-english-guide.md) | 영어 학습 기능 안내 |
| — | `AGENTS.md` | 저장소 작업 지침 |

모델 목록은 문서가 아니라 **`lib/models.ts`** 한 곳에서만 봅니다. 모델을 추가·삭제할 때 손댈 곳은 저 파일 하나입니다.

## 빠른 시작

```powershell
cd C:\june\June_APP\App
Copy-Item .env.example .env.local
npm install
npm run dev
```

`.env.local`에 채울 값 (없으면 앱이 열리지 않습니다 — fail-closed):

```env
OPENROUTER_API_KEY=...
GROQ_API_KEY=...
GEMINI_API_KEY=...
APP_PIN=본인이 정한 6자리 숫자
APP_TOKEN=임의의 긴 랜덤 문자열
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

- **`.env`가 아니라 `.env.local`입니다.** 둘 다 커밋에서 제외됩니다.
- `SUPABASE_SERVICE_ROLE_KEY`에 **`NEXT_PUBLIC_` 접두사를 절대 붙이지 마세요.**
  이 키는 DB 권한을 완전히 우회하고, 접두사가 붙는 순간 브라우저 번들에 평문으로 실립니다.
  자세한 건 [`docs/RULE.md`](docs/RULE.md).

## 대화 저장이 안 될 때

가장 흔한 함정입니다. **`SUPABASE_SERVICE_ROLE_KEY`가 없으면 저장이 조용히 꺼집니다.**
화면은 정상 작동하고 대화도 되기 때문에 눈에 띄는 실패가 없습니다.

- 대화 목록이 안 보이면 이 키부터 확인하세요 (503을 "저장 안 됨"으로 바꿔 보여 줍니다).
- `SUPABASE_URL`은 예전 이름(`NEXT_PUBLIC_SUPABASE_URL`)도 읽지만 `SUPABASE_SERVICE_ROLE_KEY`에는 대체 이름이 없습니다.

스키마는 **`supabase/schema.sql` → `supabase/single-user.sql` 이 순서로** 실행해야 합니다.
순서가 반대면 정책이 참조하던 열이 사라져 실패합니다.

그다음 **`supabase/add-compaction.sql`** 을 실행하면 긴 대화의 압축이 켜집니다.
이것만 빠져 있으면 앱은 그대로 돌아가며 긴 대화를 예전처럼 잘라 버립니다.

## 기술 스택

Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · React 19
LLM 호출은 OpenRouter·Groq가 raw `fetch`, Gemini만 `@google/generative-ai` SDK를 씁니다 (Vercel AI SDK 미사용).
대화 저장은 Supabase Postgres. 응답은 비스트리밍입니다 — 전체를 받고 나서 렌더링합니다.

## 기능별 위치

Next.js가 요구하는 라우팅 디렉터리 `app/`은 유지합니다. 화면은 기능별 경로로 나뉘어 있습니다.

| 기능 | 화면·API | 공통 로직 |
|---|---|---|
| 채팅 | `app/chat/`, `app/api/chat/`, `app/api/conversations/` | `lib/llm.ts`, `lib/context.ts`, `lib/compaction.ts`, `components/ConversationList.tsx` |
| 영어 학습 | `app/english/`, `app/api/english/` | `lib/lesson.ts`, `components/SpeakButton.tsx` |
| 모델 설정 | `app/api/models/` | `components/ModelPicker.tsx`, `hooks/useModelRegistry.ts`, `lib/models.ts`, `lib/model-registry.ts` |
| 로그인·접근 보호 | `app/api/auth/` | `components/AuthGate.tsx`, `lib/auth.ts`, `lib/auth-client.ts` |
| App 데이터 저장 | `app/api/conversations/`, `app/api/english/records/` | `lib/db.ts`, `lib/db-server.ts`, `supabase/` |

저장은 이 앱의 채팅·학습 기록을 위한 Supabase 저장소입니다. `June_APP/DB`의 시장 데이터 저장소와는 별도입니다.

## 배포

- URL: https://261001-zeta.vercel.app
- push 하면 자동 배포됩니다. 원격 등록/손상 상태는 `../GIT_PUSH.md` 를 참조하십시오.

## 알려진 한계

읽어두면 좋은 것만 적었습니다. 자세한 건 [`docs/BACKLOG.md`](docs/BACKLOG.md).

- **접근 보호가 약합니다.** 토큰이 `sessionStorage`에 있어 개발자도구로 볼 수 있고 시도 제한이 없습니다.
  "URL만 아는 사람"은 막지만 "집요한 사람"은 막지 못합니다. 의도적으로 이 수준입니다.
- **긴 대화는 앞부분이 요약으로 바뀝니다.** 토큰 예산을 넘으면 오래된 메시지를
  버리는 대신 요약문을 남깁니다 — 설계와 판단 근거는 `lib/compaction.ts`에 있습니다.
  화면과 DB에는 **전부 그대로 남습니다.** 줄어드는 것은 모델에게 보이는 것뿐입니다.
  요약은 provider를 새로 고르지 않고 이번 턴에 쓰신 provider로 만듭니다.
  `supabase/add-compaction.sql`을 실행하지 않은 배포에서는 조용히 꺼져 있어
  예전처럼 그냥 버립니다 — 이때만 "아까 그 얘기"가 풀리지 않습니다.
