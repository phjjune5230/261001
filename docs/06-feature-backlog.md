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

## Phase 2: 영어 공부 (v0.3.0)

- [x] 영어 학습 세션 (`/english`, `/api/english`) — 도입 → 예문 → 역할놀이 → 직접 말하기 → 마무리
- [x] JSON 모드 강제 + 파싱 (`lib/llm.ts`의 `jsonMode`, `lib/lesson.ts`의 `parseLessonResponse`)
- [x] 학습자 수준·목표 선택 (서버가 프롬프트를 조립)
- [x] 예문·연습 말풍선 분리 (typed bubbles)
- [x] 발음 듣기 — Web Speech API (D-017). 키·비용 없음
- [x] 화면 전용 메시지를 다음 호출에서 제외 (D-016)
- [ ] **음성 입력 (STT)** — `SpeechRecognition`은 Chrome 한정이고 오인식이 잦아서 보류 (D-017)
- [ ] **세션 저장** — 새로고침하면 사라짐. "루틴"이 만들어지려면 필수
- [ ] **요약 압축(compaction)** — 영어 대화는 예문이 반복되어 예산을 빨리 채운다 (D-014 미해결)
- [ ] 발음 속도 조절 (0.8x / 1.25x)
- [ ] 틀린 문장 누적 — 세션이 끝났을 때 "평소 착각하는 표현"을 보여줄 것

## Phase 3: 개인 비서 (목표 관리)

- [ ] 목표 추가/수정/조회 (`/assistant`)
- [ ] Function Calling 연동 (목표 자동 추가)
- [ ] Supabase 연동
- [ ] 대화 기록 영속화 — 현재는 새로고침하면 사라짐

## Phase 4: 확장 기능

- [ ] 웹 검색 (Tavily 등)
- [ ] 주식 정보 및 티커 크롤러

## 미해결

- [ ] `.env` vs `.env.local` 혼용 — `README.md`는 `.env`, Next.js는 `.env.local`을 쓴다
- [ ] **git 미설치** — Chocolatey는 관리자 권한 필요, PortableGit 다운로드는 출처 승인이 필요해 대기 중 (D-009). 이러면 커밋 이력이 없어 전부 Markdown에 의존한다
- [ ] `package-lock.json`에 `@anthropic-ai/sdk`가 남아 있음 — `npm install`로 정리
- [ ] `next: ^16.3.8`인데 `eslint-config-next`는 `16.2.6`에 고정 — 불일치
- [ ] 미사용 의존성 — `openai`는 import되지 않음. `react-markdown` / `remark-gfm`은 마크다운 렌더링 구현 시 사용
- [ ] Vercel 배포 시 환경 변수 5개(`APP_PIN`, `APP_TOKEN`, 3개 provider 키)를 수동 등록해야 함 — 빠지면 fail-closed로 앱이 잠겨 보인다
