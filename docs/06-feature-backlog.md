# 06. 기능 백로그 (Feature Backlog)

## Phase 1: 기본 채팅 (완료 — v0.2.0)

- [x] 프로젝트 구조 및 설계 문서 작성 (`docs/`)
- [x] 홈 화면 (`/`) — 메뉴 카드 UI (다크모드, 폰트)
- [x] 채팅 페이지 (`/chat`) — provider·모델 선택, 채팅 인터페이스
- [x] LLM API 라우트 (`/api/chat`) — OpenRouter, Groq, Gemini 직접 키 연동
- [x] 모델 설정 단일화 (`lib/models.ts`)
- [x] 모델 "직접 입력…" 우회로
- [x] 일시적 오류 재시도 (할당량 초과 제외)
- [x] 접근 잠금 — 6자리 PIN, 화면 + API 헤더 (v0.2.0, D-007)
- [x] 에러 UX 정리 — provider 원본 JSON이 AI 응답으로 보이지 않도록
- [x] 문서 관리 체계 (`08-decisions.md`, `09-changelog.md`, v0.2.0, D-009)
- [x] 컨텍스트 예산 관리 — 토큰 예산으로 오래된 메시지 제거 (v0.3.0, D-014)
- [x] 자동 스크롤 — 새 메시지·로딩 시 하단으로 (v0.3.0)
- [ ] 마크다운 렌더링 — `react-markdown` / `remark-gfm`은 설치돼 있으나 아직 아무 데서도 import되지 않음
- [ ] 스트리밍 응답 (D-004 — 응답이 체감될 만큼 길어지면 revisit)

## Phase 2: 영어 공부 (v0.3.0, 0.4.0 보강)

- [x] 영어 학습 세션 (`/english`, `/api/english`) — 도입 → 예문 → 역할놀이 → 직접 말하기 → 마무리
- [x] JSON 모드 강제 + 파싱 (`lib/llm.ts`의 `jsonMode`, `lib/lesson.ts`의 `parseLessonResponse`)
- [x] 학습자 수준·목표 선택 (서버가 프롬프트를 조립)
- [x] 예문·연습 말풍선 분리 (typed bubbles)
- [x] 발음 듣기 — Web Speech API (D-017). 키·비용 없음
- [x] 화면 전용 메시지를 다음 호출에서 제외 (D-016)
- [ ] **음성 입력 (STT)** — `SpeechRecognition`은 Chrome 한정이고 오인식이 잦아서 보류 (D-017)
- [x] **세션 저장** — 턴을 `meta`에 통째로 저장하고 새로고침해도 복원됨 (v0.4.0, D-016). 예문·연습처럼 `content`만으로는 복원 안 되는 `steps`가 있어서 통째로 넣습니다
- [ ] **요약 압축(compaction)** — 영어 대화는 예문이 반복되어 예산을 빨리 채운다 (D-014 미해결)
- [ ] 발음 속도 조절 (0.8x / 1.25x)
- [ ] 틀린 문장 누적 — 세션이 끝났을 때 "평소 착각하는 표현"을 보여줄 것

## Phase 3: 배포 + 대화 영속화 (완료 — v0.5.0)

URL로 어디서나 접속하게 만들고, 대화를 잃지 않게 한다.

> **이 Phase의 초기 설계는 0.5.0에서 뒤집혔습니다.**
> 처음에는 "**일부 사람에게 공유**, 각자 대화는 따로"를 전제로 했고
> 그래서 Supabase Auth 로그인을 넣었습니다 (D-019).
> 0.5.0에서 사용자 결정을 **"나만 쓴다"**로 바꾸고 로그인을 전부 걷어냈습니다 (D-022).
> **D-019는 무효입니다.** 아래 목록에서 Auth 항목을 찾지 않는 것이 정상입니다 —
> 빠진 게 아니라 없어진 겁니다.

- [x] 스키마 설계 — `supabase/schema.sql` (conversations + messages + RLS)
- [x] 설계 문서 — D-018 (저장), D-020 (배포), **D-022 (단일 사용자 전환)**
- [x] ~~D-019 (Supabase 인증)~~ — **무효.** 로그인 제거로 대체됨 (D-022)
- [x] **사용자 조치** — Supabase SQL 2개 실행 (`schema.sql` → `single-user.sql`)
- [x] **사용자 조치** — GitHub 저장소 생성 후 push (원격 `origin` 설정 완료)
- [x] **사용자 조치** — Vercel 연동 + 환경 변수 등록
- [x] 로그인 화면 (Supabase Auth) — **D-022로 삭제.** `SignInForm.tsx`는 파일째로 없음
- [x] 대화 목록 + 이어하기/삭제 — 채팅·영어 양쪽
- [x] `lib/db.ts` — `/api/conversations` 호출로 교체 (Supabase SDK는 클라이언트에서 제거)
- [x] `lib/db-server.ts` — 서버 전용 `service_role` 클라이언트 (D-022)
- [x] 배포 — `https://261001-zeta.vercel.app` (2026-10-01, D-020)

### 이 Phase가 지금 어떻게 동작하는가 (D-022)

```
브라우저 ──x-app-token──▶ 우리 서버 /api/conversations ──service_role──▶ Supabase
```

0.4.0 때와 달라진 지점 — 브라우저가 Supabase에 직접 붙지 않습니다.

- anon은 여전히 아무것도 못 읽습니다. RLS는 켜져 있고 **정책이 0개**입니다.
- 접근 검사는 `x-app-token` 하나뿐이며, LLM 호출과 대화 저장이 같은 경로를 지납니다.
- `service_role`은 `NEXT_PUBLIC_`이 없으므로 JS 번들에 들어가지 않습니다.

주의: `service_role`은 RLS를 **완전히 우회**합니다. 라우트에서 `WHERE` 하나를
빼먹으면 전체 대화가 나갑니다. 조건은 화면에서 받은 값을 믿지 않고
라우트가 직접 적습니다 (`lib/db-server.ts` 머리말 참고).

## Phase 4: 개인 비서 (목표 관리)

- [ ] 목표 추가/수정/조회 (`/assistant`)
- [ ] Function Calling 연동 (목표 자동 추가)
- [ ] 사용자 관리 화면 — **단일 사용자라 현재는 필요 없습니다.** 여러 사람에게 주려면 그때 다시 설계 (D-022이 D-019를 대체)

## Phase 5: 확장 기능

- [ ] 웹 검색 (Tavily 등)
- [ ] 주식 정보 및 티커 크롤러

## 미해결이었던 것 (모두 정리됨 — 2026-10-01 기준)

여기 남은 항목은 없습니다. 어떤 항목이 있었고 왜 이렇게 끝났는지를 남깁니다.

- [x] `.env` vs `.env.local` 혼용 — README와 `.env.example`은 이미 `.env.local`을 쓰고 있었습니다. 틀린 건 `.gitignore` 주석 하나였고 고쳤습니다 (0.5.1)
- [x] `next: ^16.3.8`인데 `eslint-config-next`는 `16.2.6`에 고정 — 16.3.8로 올렸습니다 (0.5.1)
- [x] 미사용 의존성 — `openai`를 제거했습니다. `lib/llm.ts`가 raw `fetch`로 OpenRouter·Groq를 부르는 것이 D-002의 결정이므로 SDK는 쓰지 않습니다. `react-markdown` / `remark-gfm`은 위 Phase 1 항목("마크다운 렌더링")에서 쓸 예정이라 남겨뒀습니다 — 지우면 나중에 다시 설치해야 합니다 (0.5.1)
