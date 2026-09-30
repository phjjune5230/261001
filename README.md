# First App — June's Personal AI Assistant

> 개인 실 사용을 위한 AI 어시스턴트. Phase 1은 멀티 provider 채팅입니다.
> 이전 스터디 프로젝트(`C:\june\old`)는 **컨셉만** 참조하며 코드는 이식하지 않습니다.

## 이 프로젝트는 무엇인가?

사용자가 직접 LLM provider(OpenRouter, Groq, Gemini)를 선택하고,
각각의 API 키를 등록하여 다양한 AI 기능을 사용할 수 있는 웹 앱입니다.

현재 기능 (v0.3.0)

| 화면 | 경로 | 하는 일 |
|------|------|---------|
| 채팅 | `/chat` | 3개 provider를 고르고 자유롭게 대화. 긴 대화는 자동으로 컨텍스트를 절약 |
| 영어 학습 | `/english` | 도입 → 예문 → 역할놀이 → 직접 말하기. 예문 발음은 🔊 버튼으로 |

## 처음 읽어야 할 파일

| 파일 | 내용 |
|------|------|
| `docs/00-overview.md` | 프로젝트 개요, 목표, 범위 |
| `docs/01-architecture.md` | 기술 스택, 아키텍처, 폴더 구조 |
| `docs/02-design-system.md` | 다크 테마, 폰트, 색상, 컴포넌트 규칙 |
| `docs/03-llm-gateway.md` | LLM provider 설정, 모델, 재시도 정책 |
| `docs/04-api-contract.md` | API 라우트, Request/Response 스키마 |
| `docs/05-data-model.md` | 어디에 무엇이 저장되는가 |
| `docs/06-feature-backlog.md` | Phase별 기능 목록 |
| `docs/07-rules.md` | 코드 컨벤션과 작업 규칙 |
| `docs/08-decisions.md` | **결정 기록 — 왜 이렇게 됐는가** |
| `docs/09-changelog.md` | **변경 이력 + 정기 점검** |
| `lib/models.ts` | **사용 가능한 모델 목록 — 모델 설정은 여기만 수정** |

## 빠른 시작

```bash
cd C:\june\first_app
cp .env.example .env.local
# .env.local에 값 등록:
#   OPENROUTER_API_KEY / GROQ_API_KEY / GEMINI_API_KEY
#   APP_PIN    — 본인이 정한 6자리 숫자
#   APP_TOKEN  — 임의의 긴 랜덤 문자열
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 접속 → 6자리 PIN으로 잠금 해제.

> ⚠️ `.env`가 아니라 **`.env.local`** 입니다. 둘 다 `.gitignore`에 들어가 있습니다.
> ⚠️ `APP_PIN` / `APP_TOKEN`이 없으면 잠금 화면이 열리지 않습니다 (fail-closed).
> ⚠️ 환경 변수에 `NEXT_PUBLIC_` 접두사를 붙이면 값이 브라우저 번들에 평문으로 실립니다. 붙이지 마세요.

## 접근 보호

6자리 PIN으로 모든 화면 라우트와 `/api/chat`을 막습니다.

- PIN은 `.env.local`에만 있고 브라우저로 전달되지 않습니다. 브라우저가 받는 것은 별도의 토큰 하나뿐입니다.
- **의도적으로 약한 보호입니다.** 토큰이 `sessionStorage`에 있어 개발자도구로 볼 수 있고, 시도 제한이 없습니다.
  "URL만 아는 사람"은 막지만 "집요한 사람"은 막지 못합니다.
- 더 강하게 하려면 서버 세션 + 쿠키, 또는 Next 16의 `proxy.ts`로 서버 게이트가 필요합니다.
  배경과 대안 검토는 `docs/08-decisions.md` D-007을 보세요.

## 기술 스택

- **프레임워크**: Next.js 16.3.8 (App Router, Turbopack)
- **언어**: TypeScript (strict)
- **CSS**: Tailwind CSS v4
- **폰트**: `next/font/google` — Syne, DM Mono
- **LLM 호출**: OpenRouter/Groq는 raw `fetch`, Gemini는 `@google/generative-ai` SDK
  (Vercel AI SDK **미사용**)
- **응답**: 비스트리밍 — 전체를 받은 뒤 렌더링 (`docs/08-decisions.md` D-004)
- **컨텍스트**: 토큰 예산 6,000으로 오래된 메시지를 자릅니다 (`lib/context.ts`, D-014).
  **예산은 컨텍스트 창이 아니라 provider의 TPM 한도를 기준으로 정했습니다.**
- **영어 기능**: `jsonMode`로 JSON을 강제해 단계 단위로 파싱합니다 (D-015).
  발음은 브라우저 Web Speech API라 키도 비용도 없습니다 (D-017)
- **미사용 의존성**: `openai`, `react-markdown`, `remark-gfm` (마크다운 렌더링 미구현)

### 알려진 불일치

`package.json`의 `next`는 `^16.3.8`인데 `eslint-config-next`는 `16.2.6`에 고정돼 있습니다.
동작에는 문제없지만 정렬이 필요합니다.