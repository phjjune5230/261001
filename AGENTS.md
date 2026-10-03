<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 이 저장소에서 지킬 것

### 1. 토큰 상수는 `npm test`를 먼저 돌리고 바꾸세요

아래 값들은 실제 provider가 거절한 사고에서 역산해 둔 숫자입니다.

- `lib/context.ts` — `DEFAULT_CONTEXT_BUDGET` · `SYSTEM_TOKEN_RESERVE` · `TPM_SAFETY_MARGIN`
- `lib/models.ts` — `ModelInfo`의 `maxTokens` · `tpm` · `rpm`
- `lib/compaction.ts` — `MAX_SUMMARY_CHARS` · `MAX_TRANSCRIPT_TOKENS`

이유: **`tsc`와 `lint`는 "의도가 읽히는 코드"만 검사합니다.** `estimateTokens`의
나누는 수를 4에서 3으로 바꾸면 셋 다 통과하고, provider가 400을 내기까지 아무도
모릅니다. 실제로 그랬습니다 (2026-10-01, groq `Requested 46197`).

`MAX_TRANSCRIPT_TOKENS`를 "불필요한 상수 정리"로 지우면 압축이 **조용히** 꺼집니다.
`summarizeDropped`의 `catch`가 삼키고 `null`을 돌려주므로 앱은 "그냥 버리기"로
정상 동작해 보이고, 서버 콘솔을 보지 않으면 아무도 모릅니다.

### 2. 숫자를 지어내지 말고 출처를 적으세요

모르는 값은 `null`로 두고 "모른다"고 씁니다 — `lib/models.ts`의 `ModelInfo`가
그 방식입니다. 채워 넣을 때는 확인 날짜와 페이지를 주석에 남깁니다.
근거 없는 숫자가 들어가면 그게 그대로 예산 계산에 쓰입니다.

### 3. 검증

`npm run lint`(경고 0) · `npx tsc --noEmit` · `npm test` · `npm run build`
네 개를 모두 통과한 뒤에 커밋합니다 (`docs/RULE.md` §6).
