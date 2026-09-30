# 07. 코드 컨벤션 및 규칙 (Rules)

## 1. 코딩 규칙 (Coding Conventions)

- **TypeScript 필수**: 모든 파일은 TSX/TS로 작성, `any` 지양하고 명시적 타입 지정
- **App Router**: Next.js App Router(`app/`) 사용, 페이지 파일은 `'use client'` 명시적 선언
- **Tailwind CSS v4**: CSS 클래스명은 가능한 Tailwind utility 사용, 인라인 스타일은 최소화
- **`lib/models.ts`가 모델 목록의 유일한 출처**입니다 (D-003). 모델 ID를 다른 곳에 하드코딩하지 않습니다.
- **서버 전용 모듈 규칙**: `lib/auth.ts`는 `app/api/**`에서만 import합니다. 클라이언트에서 가져오면 안 됩니다.
  (`server-only` 패키지를 붙이고 싶지만 미설치 상태라 규칙으로 막습니다)
- **환경 변수에 `NEXT_PUBLIC_`을 함부로 붙이지 않습니다.** 붙이면 값이 클라이언트 번들에 평문으로 실립니다.

## 2. 디자인 규칙

- 배경색: `#0f0f0f`
- 강조색: `#e8ff47`
- 에러: `#ef4444`
- 타이틀: Syne 폰트 (`var(--font-syne)`)
- 본문/코드: DM Mono 폰트 (`var(--font-dm-mono)`)

전체는 `docs/02-design-system.md`를 보세요.

## 3. 에러 처리 규칙

- API 라우트는 `try-catch`로 감싸고, 에러 발생 시 명확한 JSON 에러 메시지 반환
- **provider가 준 원본 응답은 브라우저로 보내지 않습니다.** 키 지문 등이 포함될 수 있습니다.
  원본은 서버 콘솔에만 기록하고, 클라이언트에는 짧은 한국어 메시지만 보냅니다.
  직접 만든 진단 메시지만 예외로 통과시킵니다 (허용 목록은 `app/api/chat/route.ts`에 있음)
- **에러를 AI 응답처럼 렌더링하지 않습니다.** 오류는 말풍선이 아닌 별도의 `#ef4444` 영역에 표시합니다
- 클라이언트에서는 에러 발생 시 사용자에게 친절한 메시지 표시 (토스트 또는 텍스트)

## 4. 작업 및 기록 규칙 (Process)

**아직 git 저장소가 아닙니다.** git이 설치돼 있지 않아 커밋 단위 규칙은 아직 지킬 수 없습니다.
지금은 Markdown으로 과정을 남기고, git을 설치한 뒤 태그를 함께 붙입니다.

### 바뀌는 코드를 고칠 때

1. **결정이 필요하면 코드를 고치기 전에** `docs/08-decisions.md`에 항목 추가
   (상황 / 결정 / 근거 / 대안 기각)
2. **버전 올리기** — `package.json`의 `version`
   - patch: 버그 수정, 문서 정정
   - minor: 기능 추가, Phase 진행
   - major: `/api/chat` 계약 등 호환성이 깨지는 변경
3. **`docs/09-changelog.md`에 항목 추가** — 무엇을 / 왜 / 결정 ID
4. **코드 수정**
5. **영향받는 설계 문서 갱신** — 어느 문서가 썩는지는 `docs/09-changelog.md`의 "문서가 썩는 지점" 표 참고
6. **검증** — `npm run lint` (경고 0), `npm run build` 통과

### 주기적으로 다시 볼 것

provider 응답 상태, free tier 한도, 크레딧, model ID 유효성.
목록은 `docs/09-changelog.md`의 "정기 점검" 절에 있습니다. 확인 결과를 거기에 날짜와 함께 남깁니다.

### git이 생기면

- 커밋 메시지: `v{버전} {요약}` 형식
- 태그: `git tag -a v0.3.0 -m "..."` — **이력 항목과 태그는 같은 커밋에서 만듭니다**
- `.gitignore`에 `.env`, `.env.local`, `.env.*.local`이 들어 있는지 확인할 것
  (키가 커밋되면 되돌리기 어렵습니다)
