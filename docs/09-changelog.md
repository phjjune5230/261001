# 09. 변경 이력 (Changelog)

## 이 문서의 목적

버전별 **무엇이** 바뀌었는지와 **왜** 바뀌었는지, 그리고 **어떻게 확인했는지**를 남깁니다.
판단 근거는 `docs/08-decisions.md`에 있습니다. 이 문서는 "언제 무엇이 바뀌었는가"만 다룹니다.

`package.json`의 `version`이 기준이며, git을 설치한 뒤에는 같은 문자열로 태그를 붙입니다.
버전 구분 규칙은 `docs/08-decisions.md` D-009를 보세요.

최신 버전이 맨 위입니다.

---

## 0.3.0 — 2026-10-01

영어 학습 기능(Phase 2) 출하 + 컨텍스트 예산 관리. 채팅은 자동 스크롤과 컨텍스트 절약을 더했다.

| 변경 | 이유 | 결정 |
|------|------|------|
| `lib/context.ts` 추가 — 토큰 예산으로 오래된 메시지 제거 | 대화가 길어지면 매 턴 전체를 보내 결국 provider에 거절당함 | D-014 |
| `lib/context.ts` — 한글/한자/일본어를 따로 세는 추정기 | "문자 수 ÷ 4"는 한글에서 3.8배 과소평가 — 예산 가드가 무력화됨 | D-014 |
| 기본 예산을 6,000으로 낮춤 | 실측된 groq TPM 한도(8,000)가 실제 제약. 컨텍스트 창(128k)이 아님 | D-014 |
| `app/api/chat/route.ts` — `keepRecentMessages` 적용, `droppedMessages`·`approxTokens` 반환 | 무엇이 잘렸는지 숨기지 않기 위함 | D-014 |
| `app/chat/page.tsx` — 잘린 개수를 화면에 고지 | 사용자가 모르는 상태로 컨텍스트가 줄어드는 것을 막음 | D-014 |
| `app/chat/page.tsx` — 새 메시지/로딩 시 자동 스크롤 | 긴 대화에서 답이 화면 밖에 생기던 문제 | — |
| `lib/llm.ts` — `jsonMode` 옵션 추가 | 구조화된 응답은 프롬프트 부탁이 아니라 파서가 붙어야 안정적 | D-015 |
| `lib/lesson.ts` 추가 — 타입·시스템 프롬프트·응답 파서 | 계약과 화면을 분리. OLD처럼 한 파일에 박지 않는다 | D-015, D-016 |
| `app/api/english/route.ts` 추가 | 영어 학습 세션. 시스템 프롬프트는 서버가 조립 | D-015 |
| `app/english/page.tsx` — 실제 화면으로 교체 (Placeholder → 동작) | Phase 2 | D-015 |
| `components/ModelPicker.tsx` 추가 — 채팅·영어가 공유 | 목록 추가 시 두 곳을 고치는 사고 방지 | D-003 |
| `components/SpeakButton.tsx` 추가 — Web Speech로 예문 발음 | 키·비용 없이 발음 들을 수 있게 | D-017 |
| `lib/api.ts` 추가 — 인증·에러 봉쇄 공통화 | 영어 라우트가 같은 로직을 또 쓰게 됨 | — |
| `app/page.tsx` — 영어 카드 활성화 | 화면이 준비됐음 | — |
| `docs/08-decisions.md` — D-014 ~ D-017 추가 | 판단 근거 기록 | D-009 |
| `package.json` 버전 0.2.0 → 0.3.0 | 기능 추가 | D-009 |

### 확인 방법

- `npm run lint` — 통과 (경고 0)
- `npx tsc --noEmit` — 통과
- `npm run build` — 통과. `/api/english`가 라우트에 등록됨을 확인
- 개발 서버를 띄워 아래 항목 모두 확인 — **2026-10-01 검증 완료**

| # | 항목 | 결과 |
|---|------|------|
| 1 | `/`, `/chat`, `/english` 페이지 렌더 | ✅ 모두 200 |
| 2 | `POST /api/english` 토큰 없음 / 잘못된 토큰 | ✅ 401 / 401 |
| 3 | `POST /api/english` 잘못된 provider | ✅ 400 |
| 4 | `POST /api/english` 실제 호출 — groq, jsonMode | ✅ `phase: "examples"`, 예문 3개 파싱 성공 |
| 5 | 영어 3턴 이어가기 — 압축된 history를 넣고 2번째 호출 | ✅ `phase: "roleplay"`로 자동 전환, A/B 화자 교대, history 112토큰 |
| 6 | `POST /api/chat` 41턴 × 한글 3,000자 | ✅ 39개 버림, 약 3,020토큰, 정상 응답 |
| 7 | 추정 정확도 | ✅ 한글 3,003자 → 3,020토큰 (provider 실측과 일치) |

### 이번에 실제로 드러난 결함 하나

6번 검증에서 **처음에 500이 났다.** 원인은 예산 크기가 아니라 추정기였다.

`문자 수 ÷ 4`로 12,000토큰이라 판단해 자른 요청에 groq가
`Requested 46197` 이라고 거절했다 — 실제값이 근사의 **3.8배**였다.
한글은 4글자가 아니라 1글자에 1토큰이다.

이건 테스트로 미리 안 잡혔다. 41턴짜리 한글 대화를 **실제로 넣고 보내봐야**
드러나는 종류의 오차다. 예산 가드가 조용히 무력화된 채 통과하고 있었고,
그 결과가 하필 provider 거절(500)이었다. D-014에 이 사례를 남긴 이유다.

---

## 0.2.0 — 2026-10-01

접근 게이트와 문서 관리 체계 도입.

| 변경 | 이유 | 결정 |
|------|------|------|
| `components/AuthGate.tsx` 추가 — 6자리 PIN 잠금 화면 | 공개 URL로 올릴 때 URL만 아는 사람이 API를 쓸 수 없도록 | D-007, D-013 |
| `app/api/auth/route.ts` 추가 — PIN 검증 후 토큰 발급 | PIN을 브라우저로 내보내지 않으면서 인증을 수행 | D-007 |
| `lib/auth.ts` 추가 — 서버 전용 인증 헬퍼 | PIN/토큰을 `NEXT_PUBLIC_` 없이 서버에서만 읽음 | D-007 |
| `lib/auth-client.ts` 추가 — sessionStorage 래퍼 | `AuthGate`와 채팅 페이지가 토큰을 공유 | D-007 |
| `app/layout.tsx` — `{children}`을 `AuthGate`로 감쌈 | 주소로 `/chat`을 직접 열어도 잠기도록 | D-007 |
| `app/api/chat/route.ts` — `x-app-token` 검사 추가 | 인증 없이 provider를 호출할 수 없도록, 본문 파싱 **이전**에 검사 | D-007 |
| `app/api/chat/route.ts` — 5xx에서 원본 에러를 브라우저로 보내지 않음 | provider 응답에 키 지문이 포함될 수 있었음 | D-007 |
| `app/chat/page.tsx` — 에러를 가짜 AI 말풍선 대신 별도 영역에 표시 | 오류와 모델 응답이 구분되지 않던 문제 | D-007 |
| `app/chat/page.tsx` — 401 수신 시 세션 초기화 후 잠금 화면 복귀 | 토큰 만료·변경에 대한 복구 경로 | D-007 |
| `app/page.tsx` — 잠금 버튼 추가, provider 개수 표기 정정 | 잠금을 원할 수 있게 함 / "4개"는 틀림 | D-002 |
| `docs/08-decisions.md`, `docs/09-changelog.md` 추가 | 판단 근거와 이력이 남지 않던 문제 | D-009 |
| 기존 설계 문서 8종 정정 | 코드가 바뀌었는데 문서가 따라가지 않음 | — |
| `package.json` 버전 0.1.0 → 0.2.0 | 기능 추가 | D-009 |

### 확인 방법

- `npm run lint` — 통과 (경고 0)
- `npm run build` — 통과. `/api/auth`가 라우트에 등록됨을 확인
- 개발 서버를 띄워 아래 항목 모두 확인 — **2026-10-01 검증 완료**

| # | 항목 | 결과 |
|---|------|------|
| 1 | `GET /` → 잠금 화면 노출, 채팅 UI 미노출 | ✅ 200 |
| 2 | `GET /chat` **주소 직행** → 잠금 화면 | ✅ 200 |
| 3 | `POST /api/auth` 잘못된 PIN | ✅ 401 `PIN이 올바르지 않습니다.` |
| 4 | `POST /api/auth` 올바른 PIN | ✅ 200, 토큰 발급 |
| 5 | `POST /api/chat` 토큰 없음 | ✅ 401 (provider 호출 안 함) |
| 6 | `POST /api/chat` 잘못된 토큰 | ✅ 401 |
| 7 | `POST /api/chat` 정상 호출 (groq / gpt-oss-120b) | ✅ 200 실제 응답 수신 |
| 8 | 무효한 model ID | ✅ 500 + 짧은 한국어 메시지. 응답 JSON의 필드는 `error` 하나뿐이며 `req_id`, `model_not_found`, `gsk_` 같은 provider 마커가 **하나도 없음**. 원본은 서버 콘솔에만 기록됨 |

> 검증은 프로세스 환경변수에 임시 `APP_PIN` / `APP_TOKEN`을 넣어 수행했습니다.
> `.env.local`은 읽지도 쓰지도 않았고 내용도 바뀌지 않았습니다.

> ⚠️ **브라우저에서 아직 직접 확인하지 않은 것**: PIN 입력 UI의 실제 조작감,
> 잠금 해제 후 오버레이가 즉시 내려가는지, 잠금 버튼 동작.
> 위 검증은 전부 HTTP 응답 기준입니다.

### 사용자가 직접 해야 하는 것

`.env.local`에 아래 두 줄이 **없으면 앱이 열리지 않습니다** (설정 안 된 상태는 의도적으로 fail-closed).
`.env.local`은 에이전트가 읽거나 쓰지 않으므로 직접 추가해 주세요.

```env
APP_PIN=본인이 정한 6자리 숫자
APP_TOKEN=임의의 긴 랜덤 문자열
```

---

## 0.1.0 — 2026-10-01 (소급 기록)

Phase 1 기본 채팅 동작 확인.

| 변경 | 이유 |
|------|------|
| 멀티 provider LLM 게이트웨이 (`lib/llm.ts`) | provider를 골라 쓰려면 OpenAI 호환 API와 Gemini SDK를 함께 다뤄야 함 |
| 채팅 UI (`app/chat/page.tsx`) | provider·모델 직접 선택 |
| 모델 설정을 `lib/models.ts`로 통합 | 수정 지점을 한 곳으로 |
| 일시적 오류만 재시도 | 할당량 초과는 재시도해도 소용없음 |
| 설계 문서 8종 작성 | 코드 작성 전 규칙과 구조를 정의 |

### 이 시점에서 바로잡은 것

- `/chat` 진입 시 즉시 에러 — 페이지 파일이 문법 손상 상태(따옴표가 백슬래시로 대체됨, form-feed 문자 포함)
- 하드코딩된 model ID가 전부 폐기 상태 — `anthropic/claude-3.5-sonnet`, `llama-3.3-70b-versatile`, `gemini-2.0-flash-001` 등
- `npm run lint`가 명령 자체로 실패하고 있었음 — `eslint-config-next` v16은 배열을 export 하는데 함수로 호출하고 있었음
- Tailwind v4 문법 오류 — `@tailwind utilities` → `@import "tailwindcss"`
- `.env` / `.env.local`이 `.gitignore`에 빠져 있었음 — README가 안내하는 방식대로 따라 하면 키가 커밋됨
- Anthropic 제거 (D-001)

---

## 정기 점검 (Evaluation Checklist)

문서가 시간이 지나면 썩는 부분이 정해져 있습니다. 아래 항목은 주기적으로 다시 확인하고,
결과를 이 문서에 날짜와 함께 남깁니다.

| 항목 | 확인 방법 | 주기 | 마지막 확인 |
|------|----------|------|-----------|
| provider별 실제 응답 | 각 provider로 실제 호출 | 수시 | 2026-10-01 — groq 정상, gemini 정상(한도 있음), openrouter 크레딧 부족 |
| gemini free tier 한도 | 실제 호출 후 상태 확인 | 월 1회 | 2026-10-01 — Flash Lite 일 500회 |
| openrouter 크레딧 | 크레딧 페이지 확인 | 월 1회 | 2026-10-01 — 부족 |
| model ID 유효성 | 각 provider의 `/models` 카탈로그 대조 | 월 1회 | 2026-10-01 — 목록 반영 |
| **TPM 한도** | `lib/context.ts`의 예산이 실제 provider 한도를 넘지 않는지 | provider·모델 변경 시 | 2026-10-01 — groq `openai/gpt-oss-120b` = 8,000. 예산 6,000을 여기서 정했다 (D-014) |
| 설계 문서와 코드의 일치 | 아래 "문서가 썩는 지점" 표 확인 | 기능 추가 시 | 2026-10-01 — 전수 정정 |

### 문서가 썩는 지점

기능을 바꾸면 문서가 뒤처지는 지점이 정해져 있습니다. 코드를 고칠 때 같이 확인하세요.

| 바뀌는 것 | 같이 갱신할 문서 |
|-----------|-----------------|
| provider 추가/삭제 | `00-overview.md`, `01-architecture.md`, `03-llm-gateway.md`, `04-api-contract.md`, `app/page.tsx` |
| model 목록 | `lib/models.ts`의 주석, `03-llm-gateway.md` |
| API 요청/응답 형식 | `04-api-contract.md` |
| 컨텍스트 예산·추정기 | `lib/context.ts`의 주석, `08-decisions.md` D-014, 위 TPM 점검 항목 |
| 학습 단계(phase)나 세션 흐름 | `lib/lesson.ts`의 시스템 프롬프트, `08-decisions.md` D-015~D-016 |
| 색상·폰트·컴포넌트 | `02-design-system.md` |
| 환경 변수 | `.env.example`, 해당 문서의 환경 변수 절 |
| 기능 추가/완료 | `06-feature-backlog.md` |
| 낭떠러진 결정 | `08-decisions.md`에 항목 추가 |
