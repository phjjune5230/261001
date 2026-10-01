# 01. 아키텍처 및 기술 스택 (Architecture)

## 기술 스택

| 분류 | 기술 | 버전 / 비고 |
|------|------|-------------|
| **프레임워크** | Next.js | 16.3.8 (App Router, Turbopack) |
| **언어** | TypeScript | 5.x, strict |
| **CSS** | Tailwind CSS | v4 (`@import "tailwindcss"`) |
| **UI** | React | 19.2.4 |
| **폰트** | next/font/google | Syne, DM Mono — 빌드 시 self-host |
| **LLM 호출** | raw `fetch` (OpenAI 호환) + `@google/generative-ai` | Vercel AI SDK **미사용** |

**LLM provider**: OpenRouter, Groq, Gemini 3개 (`08-decisions.md` D-002).
Anthropic은 제외 (D-001).

**미사용 의존성** — `package.json`에 있으나 어디서도 import하지 않습니다.

| 패키지 | 상태 |
|--------|------|
| `openai` | 미사용 — OpenRouter/Groq는 raw `fetch`로 호출 |
| `react-markdown`, `remark-gfm` | 미사용 — 마크다운 렌더링 미구현 (Phase 1 백로그) |

---

## 폴더 구조 (Directory Structure)

```
C:\june\first_app\
├── README.md                      # 프로젝트 소개 + 실행 방법
├── docs/                          # 설계 문서
│   ├── 00-overview.md             # 개요, 목표, 범위
│   ├── 01-architecture.md         # ← 이 파일
│   ├── 02-design-system.md        # 색상, 폰트, 컴포넌트 규칙
│   ├── 03-llm-gateway.md          # provider, 모델 설정, 재시도 정책
│   ├── 04-api-contract.md         # API 요청/응답 계약
│   ├── 05-data-model.md           # Phase별 데이터 저장 형태
│   ├── 06-feature-backlog.md      # Phase별 기능 목록
│   ├── 07-rules.md                # 코딩·설계·작업 규칙
│   ├── 08-decisions.md            # ★ 결정 기록 (왜 이렇게 됐는가)
│   └── 09-changelog.md            # ★ 변경 이력 + 정기 점검
├── app/                           # Next.js App Router
│   ├── layout.tsx                 # 서버 컴포넌트. 폰트 + AuthGate로 children 감쌈
│   ├── globals.css                # Tailwind v4 + 폰트 규칙
│   ├── page.tsx                   # 홈 / 메인 메뉴 + 잠금 버튼
│   ├── chat/
│   │   └── page.tsx               # 채팅 페이지
│   ├── english/
│   │   └── page.tsx               # 영어 학습 세션 (v0.3.0)
│   └── api/                       # API 라우트
│       ├── auth/
│       │   └── route.ts           # POST — PIN 검증 후 토큰 발급
│       ├── chat/
│       │   └── route.ts           # POST — LLM 채팅 (토큰 필수)
│       ├── conversations/         # v0.5.0 신규 (D-022) — 대화 저장 (토큰 필수)
│       │   ├── route.ts               # GET 목록 · POST 생성
│       │   └── [id]/
│       │       ├── route.ts           # PATCH 설정 · DELETE 삭제
│       │       └── messages/route.ts  # GET 메시지 · POST 저장
│       └── english/
│           └── route.ts           # POST — 영어 학습 (토큰 필수, jsonMode)
├── components/
│   ├── AuthGate.tsx               # 'use client' — PIN 잠금 화면
│   ├── ModelPicker.tsx            # 'use client' — 채팅·영어가 공유하는 모델 선택
│   ├── ConversationList.tsx       # 'use client' — 대화 목록 (두 화면 공유)
│   └── SpeakButton.tsx            # 'use client' — Web Speech 발음 (D-017)
├── hooks/
│   └── useConversations.ts        # 'use client' — 대화 목록·저장 (두 화면 공유)
├── lib/
│   ├── llm.ts                     # 멀티 provider LLM 콜러 (callLLM)
│   ├── models.ts                  # ★ 모델 설정 단일 출처
│   ├── auth.ts                    # 서버 전용 — PIN/토큰 검증
│   ├── auth-client.ts             # 클라이언트 전용 — sessionStorage 토큰
│   ├── api.ts                     # 라우트 공통 — 인증 검사 + 에러 봉쇄
│   ├── context.ts                 # ★ 컨텍스트 예산 관리 (keepRecentMessages)
│   ├── db-server.ts               # ★ 서버 전용 — service_role Supabase 클라이언트 (D-022)
│   ├── db.ts                      # ★ 클라이언트 — /api/conversations 호출 (D-022)
│   └── lesson.ts                  # 영어 세션 계약 — 타입·프롬프트·파서
├── supabase/
│   ├── schema.sql                 # 테이블 + RLS 정책 (1단계, 직접 실행 대상)
│   └── single-user.sql            # ★ 로그인 제거 — 정책·user_id 삭제 (2단계, D-022)
├── .env.example                   # 환경 변수 템플릿
├── .gitignore
├── next.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── package.json
└── tsconfig.json
```

## 렌더링 구조

| 라우트 | 종류 | 비고 |
|--------|------|------|
| `/`, `/chat`, `/english` | 정적 프리렌더 | `AuthGate`가 항상 렌더됨 (D-013) |
| `/api/auth`, `/api/chat`, `/api/english` | 동적 | 요청마다 실행 |
| `/api/conversations/**` | 동적 | v0.5.0 신규. `x-app-token` 필수 (D-022) |

## 두 화면이 공유하는 것

`/chat`과 `/english`는 겉보기엔 다른 기능이지만 입력받는 것이 같다 — provider와 모델.
그래서 `components/ModelPicker.tsx` 하나로 묶었다. 목록에 모델을 추가할 때 두 곳을
고치는 사고는 반드시 생긴다 (D-003이 화면에서도 지켜지도록).

### 컨텍스트 예산은 두 라우트에 동일하게 적용된다

`lib/context.ts`의 `keepRecentMessages()`는 `/api/chat`과 `/api/english` 양쪽에서
호출합니다. 영어 대화는 예문과 번역이 반복되어 예산을 특히 빨리 채웁니다.

기본 예산 6,000 토큰. **근거는 컨텍스트 창이 아니라 TPM 한도**라는 점을
`lib/context.ts`의 주석과 D-014에 남겨 두었습니다. 여기만 읽으면 언젠가
"128k니까 예산을 크게 올리자"라고 판단할 수 있습니다. 하지 마세요.

### 레이아웃이 서버 컴포넌트인 이유

`app/layout.tsx`는 `'use client'`를 붙이지 않습니다. 붙이면 하위 트리 전체가
클라이언트 렌더링으로 바뀌고 `metadata` export도 쓸 수 없게 됩니다.
대신 클라이언트 컴포넌트 `AuthGate`가 `children`을 감싸는 정식 패턴을 씁니다.

### 잠금의 위치

`AuthGate`는 `layout.tsx` 안에서 모든 화면 라우트를 감쌉니다.
그래서 `/chat` 주소를 직접 입력해도 잠깁니다 — 홈 화면에만 잠그는 방식으로는
막히지 않습니다.

`AuthGate`는 자식을 **항상 렌더하고** 잠을 때만 `fixed` 오버레이를 덮습니다.
토큰 확인 전까지 렌더를 미루면 첫 페인트에 빈 화면이 보이거나
effect에서 `setState`를 불러 연속 렌더가 발생하기 때문입니다 (D-013).

단, 이 방식은 보호된 페이지 HTML을 인증 없이도 전송합니다.
**API(`/api/chat`)는 서버에서 검사하므로 실제로 보호해야 하는 대상은 막혀 있습니다.**
더 강한 게이트가 필요해지면 Next 16의 `proxy.ts`로 옮깁니다 — D-007의 대안 기각 참고.

### 잠금이 두 겹이었던 이유, 그리고 이제 하나인 이유 (D-019 → D-022)

`AuthGate`는 v0.4.0까지 두 가지를 순서대로 요구했습니다. **둘의 목적이 다릅니다.**

| 단계 | 막는 것 | 우회하면 |
|------|---------|----------|
| 6자리 PIN | 화면 접근 | HTML은 전송됨, 크레딧 소모 가능 |
| Supabase 로그인 | 대화가 섞이는 것 | RLS가 DB 레벨에서 막음 |

사용자가 "나만 쓰는거고" 라고 말해 두 번째 층이 없어졌습니다. 이제 잠금 하나입니다.

**첫 번째 층은 그대로 둡니다.** 잠금이 내려가면 `/api/chat`을 토큰 없이 그대로
부를 수 있어서, 앱을 열지 않고 `curl` 한 줄로 provider 크레딧을 태울 수 있습니다.
D-019가 로그인을 만들면서도 이 경고는 지우지 말라고 명시했는데, 그게 맞았습니다.

### 대화가 왜 서버를 거치나 (D-022)

`NEXT_PUBLIC_` 접두사가 붙은 환경 변수는 Next.js가 **클라이언트 번들에 평문으로
인라인**합니다. 즉 anon 키는 URL을 아는 사람에게 이미 공개된 값입니다.

D-019는 그래서 브라우저가 anon 키로 직접 붙게 했고 RLS를 경계로 삼았습니다.
이게 통했던 건 **RLS 정책이 `auth.uid()`를 보았기 때문**입니다. 계정이 없으니
그 정책은 아무것도 통과시키지 못했고, 말하자면 경계가 아니라 벽이 되어 버렸습니다.

대신 이렇게 바꿨습니다.

```
브라우저 ──x-app-token──▶ 우리 서버 /api/conversations ──service_role──▶ Supabase
```

- anon은 여전히 아무것도 못 읽습니다. RLS가 **켜져 있고 정책이 0개**입니다.
- 접근 문이 하나입니다. LLM 호출과 대화 저장이 같은 검사를 통과합니다.
- `service_role`은 `NEXT_PUBLIC_`이 없어서 번들에 들어가지 않습니다.

**대가는 분명합니다.** `service_role`은 RLS를 완전히 우회합니다. 라우트에서
`WHERE` 하나를 빠뜨리면 전체 대화가 나갑니다. 그래서 `app/api/conversations/**`는
화면에서 골라 준 값을 신뢰하지 않고 라우트가 조건을 직접 적습니다.
이 규칙은 `lib/db-server.ts` 머리말에 적어 뒀습니다.

### 저장이 꺼졌을 때 어떻게 아는가 (D-022)

`useConversations`의 `enabled`는 더 이상 환경 변수로 판정하지 않습니다.
클라이언트가 Supabase 설정 여부를 알 수 없게 되었기 때문입니다.

대신 **`enabled`는 첫 목록 조회가 성공했는가**입니다. 503(키 없음),
404(라우트 없음), 403(RLS 정책이 남음) — 전부 "이 배포에서는 저장이 안 된다"로
수렴합니다. 처음부터 `false`로 시작하지 않는 이유는 훅 머리말에 있습니다: 깜빡입니다.
