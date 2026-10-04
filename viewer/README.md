# 과거 대화 뷰어 — 읽기 전용

`first_app`의 대화 기록을 **보는 것만** 하는 정적 페이지입니다.
빌드가 없고 의존성이 없습니다. `app.js` 하나가 PostgREST를 fetch로 부릅니다.

메인 앱은 그대로 Vercel에서 돌아갑니다. 이 폴더는 같은 저장소에 있으되
Netlify를 붙이는 대상입니다. **서로 간섭하지 않습니다.**

---

## 1. DB에 읽기 권한 열기

Supabase 대시보드 → **SQL Editor** → New query →
[`supabase/viewer-read-only.sql`](../supabase/viewer-read-only.sql) 붙여넣기 → **Run**

`SELECT` 정책 두 개만 만들어집니다. 쓰기·수정·삭제 정책은 만들지 않습니다.

> **실행 전에** 그 파일 30~45행의 "보안 현실"을 읽으세요.
> 요약하면: 이 정책은 대화 내용을 **공개된 상태**로 만듭니다.
> anon 키와 프로젝트 URL이 뷰어에 그대로 실리므로, 둘을 아는 사람은 누구나
> 읽을 수 있습니다. 사내망이 아니라 이 정책이 문입니다.

메인 앱은 `service_role`로 접속하므로 RLS를 우회합니다.
**이 스크립트는 Vercel 쪽 동작에 아무 영향이 없습니다.**

## 2. 설정값 채우기

[`config.js`](./config.js)를 열어 두 줄을 채웁니다.

| | 값 | 어디서 |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Project Settings → API |
| `ANON_KEY` | anon "public" 키 | 같은 화면의 API Keys 목록 |

> **anon 키만 넣으세요.** 목록의 `service_role` 키가 아닙니다.
> service_role은 RLS를 우회하므로, 이 파일에 한 줄만 실려도
> 대화 전체를 읽고 지울 수 있는 키가 정적 파일에 박힙니다.

## 3. 올리기

Netlify → **Add new site → Import an existing project** → 이 저장소 선택

| 항목 | 값 |
|---|---|
| Base directory | `viewer` |
| Build command | 비워두기 |
| Publish directory | 비워두기 |

`viewer/netlify.toml`이 `publish = "."`를 정합니다. 빌드는 없습니다 —
`package.json`이 없는 정적 폴더라 Netlify가 실행할 것이 없습니다.

같은 저장소를 Vercel에도 붙여 두면 둘 다 정상입니다 (`vercel.json` 과
`netlify.toml` 은 서로 다른 파일이라 충돌하지 않습니다).

## 4. 로컬에서 보기

ES 모듈이라 `file://` 로 열면 안 됩니다. 서버를 하나 띄우세요.

```powershell
cd C:\june\first_app\viewer
npx serve .
```

`npx serve` 가 없다면 아무 정적 서버로나 `viewer` 폴더를 서빙하면 됩니다.
단, `index.html` 을 더블클릭으로 여는(`file://`) 방법은 안 됩니다 —
`app.js` 가 ES 모듈이라 브라우저가 로컬 파일을 모듈로 로드하지 못합니다.

---

## 설계 메모

### 왜 supabase-js를 안 쓰나

불필요해서가 아니라 **빌드 자체가 없어야 하기** 때문입니다.
정적 페이지에 `package.json`을 넣으면 Netlify가 의존성을 설치하고
빌드해야 하고, 그 빌드가 깨지면 화면이 죽습니다. 화면 하나를 보려고
`npm ci`가 실패할 수는 없습니다. PostgREST는 REST라 fetch 두 줄로 충분합니다.

### 읽기가 막힌 곳은 코드가 아니다

`app.js`에 쓰기 요청이 아예 없습니다. 그런데 이 파일을 통째로 지워도
안전합니다 — `pg_policies` 가 0개가 되는 순간 RLS가 전부 거부하기 때문입니다.

### 말풍선에 HTML을 넣지 않는다

`textContent`로 넣습니다. 마크다운을 렌더링하지 않습니다.
앱에서 provider 원본 JSON이 AI 대답처럼 보이던 일이 있었고,
읽기 전용 화면에서 그 경로를 다시 만들 이유가 없습니다.

### 목록 순서

`updated_at` 내림차순, 500개까지. 더 필요하면 `app.js` 의
`CONVERSATION_LIMIT` 을 올리세요.

### 메시지 순서의 알려진 한계

같은 트랜잭션에서 넣은 메시지들은 `created_at` 이 같습니다
(Postgres의 `now()` 는 트랜잭션 시각). 일반 채팅은 따로 저장되니
거의 발생하지 않지만, keepalive 프로브처럼 한 번에 넣으면
순서가 섞일 수 있습니다. 확실히 하려면 증가하는 순서 열이 필요합니다.
메인 앱도 같은 제약을 안고 있습니다 — 뷰어만의 문제가 아닙니다.

---

## 되돌리기

```sql
drop policy if exists "viewer_read_conversations" on public.conversations;
drop policy if exists "viewer_read_messages" on public.messages;
```

되돌려도 메인 앱은 멈추지 않습니다 (`service_role`은 RLS를 우회).