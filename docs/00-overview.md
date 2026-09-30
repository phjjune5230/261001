# 00. 개요 (Overview)

## 프로젝트 이름
**First App** — June's Personal AI Assistant

## 목표
개인 실 사용을 위한 AI 어시스턴트. Phase 1은 멀티 provider 채팅으로 시작해
기능을 하나씩 넓혀 간다.

> 이전 스터디 프로젝트(`C:\june\old`, study-assistant)는 **컨셉만** 참조한다.
> 코드는 이식하지 않는다 — `08-decisions.md` D-008.

## 핵심 원칙
1. **사용자가 직접 provider 선택** — OpenRouter, Groq, Gemini 3개에 키를 등록하고 모델을 직접 고른다
2. **설정은 한 곳에서** — 모델 목록은 `lib/models.ts` 하나에만 있다 (D-003)
3. **판단 근거를 남긴다** — 결정은 `08-decisions.md`, 이력은 `09-changelog.md` (D-009)
4. **점진적 확장** — Phase 1(채팅) → Phase 2(영어) → Phase 3(목표 관리) → ...

## 범위 (In / Out)

### In Scope
- 기본 채팅 UI (다크 테마, provider·모델 직접 선택)
- LLM provider 선택 및 API 키 관리
- 접근 잠금 (6자리 PIN, 화면 + API) — `08-decisions.md` D-007
- 영어 공부 기능 (Phase 2)
- 목표 관리 (Phase 3)

### Out of Scope
- 멀티유저 · 회원가입 · 실제 보안 수준의 인증 (의도적으로 하지 않음, D-007)
- 주식 크롤러 (Phase 4에서 재검토)
- 스트리밍 응답 — Phase 1은 전체 응답을 받은 뒤 렌더링 (D-004)

## 주요 사용자 플로우
1. `.env.local`에 API 키와 `APP_PIN` / `APP_TOKEN` 등록
2. 앱 실행 (`npm run dev`)
3. 6자리 PIN으로 잠금 해제
4. provider 선택 (OpenRouter / Groq / Gemini)
5. 채팅 시작
