# 04. API 계약 (API Contract)

## API 목록

| 메서드 | 경로 | 인증 | 설명 |
|--------|------|------|------|
| POST | `/api/auth` | 없음 (PIN을 검증하는 엔드포인트) | 잠금 해제 |
| POST | `/api/chat` | `x-app-token` 헤더 필수 | LLM 채팅 |
| POST | `/api/english` | `x-app-token` 헤더 필수 | 영어 학습 세션 (구조화 응답) |

> **스트리밍은 없습니다.** 응답 전체를 받은 뒤 JSON으로 돌려줍니다 — `08-decisions.md` D-004.

---

### 1. POST /api/auth — 잠금 해제

**요청 (Request)**
```json
{ "pin": "123456" }
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| pin | string | ✅ | 6자리 숫자 |

**응답 (Response) — 성공**
```json
{ "token": "발급된 세션 토큰" }
```

**응답 (Response) — 실패**
```json
{ "error": "PIN이 올바르지 않습니다." }
```
상태 코드 401.

**서버 설정 오류**: `APP_PIN` / `APP_TOKEN`이 설정되지 않았으면 500.
설정되지 않은 상태로는 통과시키지 않습니다 (fail-closed).

> PIN은 이 엔드포인트에서 소비되고 클라이언트로 돌아가지 않습니다.
> 클라이언트가 받는 것은 `APP_TOKEN` 하나뿐입니다.

---

### 2. POST /api/chat — LLM 채팅

**요청 (Request)**
```json
{
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "messages": [
    { "role": "user", "content": "안녕?" },
    { "role": "assistant", "content": "안녕하세요!" }
  ],
  "systemPrompt": "너는 친절한 AI 어시스턴트야."
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| provider | string | ✅ | `openrouter`, `groq`, `gemini` |
| model | string | ❌ | 없으면 해당 provider의 기본 모델 사용 |
| messages | array | ✅ | 대화 히스토리. 비어 있으면 안 됨 |
| systemPrompt | string | ❌ | 시스템 프롬프트 |

**헤더**

| 헤더 | 필수 | 설명 |
|------|------|------|
| `Content-Type: application/json` | ✅ | |
| `x-app-token` | ✅ | `/api/auth`에서 받은 토큰. 없거나 틀리면 401 |

**응답 (Response)**
```json
{
  "content": "안녕하세요!",
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "droppedMessages": 0,
  "approxTokens": 12
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| content | string | 모델 응답 |
| provider | string | 실제 사용된 provider |
| model | string | 실제 사용된 모델 |
| droppedMessages | number | **컨텍스트 예산 때문에 버린 앞쪽 메시지 수** (D-014) |
| approxTokens | number | 버린 뒤 남은 대략 토큰 수. 근삿값이며 provider의 계산과 다르다 |

> `droppedMessages > 0`이면 화면에서 앞부분이 잘렸다고 알려 줍니다.
> 화면에 남아 있는 메시지와 모델이 본 메시지는 **다릅니다** — 숨기지 않기 위한 필드입니다.

### 컨텍스트 예산 규칙

`lib/context.ts`가 이 엔드포인트와 `/api/english` 양쪽에 적용됩니다.

- 기본 예산 **6,000 토큰** (`DEFAULT_CONTEXT_BUDGET`)
- 예산을 넘으면 **앞에서부터** 버리고 최근만 남깁니다
- `messages[0]`이 `system`이면 절대 버리지 않습니다
- 예외: 마지막 메시지 하나는 예산을 넘더라도 보냅니다 (그게 이번 요청이므로)

**예산의 근거는 컨텍스트 창이 아니라 TPM(분당 토큰) 한도입니다.**
groq `openai/gpt-oss-120b`는 컨텍스트 창이 128k여도 TPM이 8,000이라 여기서 막힙니다.

---

### 3. POST /api/english — 영어 학습 세션

`/api/chat`와 다른 점 세 가지입니다.

1. **시스템 프롬프트를 서버가 조립합니다.** 클라이언트가 프롬프트를 바꿔 보낼 수 없습니다.
2. **`jsonMode`를 켭니다.** 모델이 JSON만 반환하도록 강제합니다 (D-015).
3. **응답을 파싱해 구조로 돌려줍니다.** 문자열 하나가 아니라 단계 배열이 나갑니다.

**요청 (Request)**
```json
{
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "profile": { "level": "중급", "goal": "일상 회화" },
  "messages": [
    { "role": "user", "content": "예문 3개만 먼저 내줘." },
    { "role": "assistant", "content": "[예문 학습]\n…" }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| provider | string | ✅ | `openrouter`, `groq`, `gemini` |
| model | string | ❌ | 없으면 해당 provider의 기본 모델 |
| profile.level | string | ❌ | 학습자 수준. 없으면 프롬프트에서 생략 |
| profile.goal | string | ❌ | 학습 목표. 없으면 프롬프트에서 생략 |
| messages | array | ✅ | 대화 히스토리. 비어 있으면 안 됨 |

**응답 (Response)**
```json
{
  "phase": "examples",
  "content": "일상 대화에서 자주 쓰이는 표현 3가지와 번역을 소개합니다.",
  "steps": [
    {
      "type": "example",
      "speaker": "A",
      "text": "How's your day going?",
      "translation": "오늘 하루 어때요?",
      "hint": "연습 문장일 때만 — 왜 이 문장을 쓰는지 한 줄"
    }
  ],
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "droppedMessages": 0,
  "approxTokens": 112
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| phase | string | `intro`, `examples`, `roleplay`, `output`, `summary` 중 하나 |
| content | string | 한국어 설명·질문·피드백 |
| steps | array | 예문·연습 문장. 비어 있을 수 있음 |
| steps[].type | string | `example` 또는 `output_prompt` |
| steps[].speaker | string | `A`, `B` 등 화자 표기 |
| steps[].text | string | 영어 문장 |
| steps[].translation | string | 한국어 번역 |
| steps[].hint | string | `output_prompt`일 때만 존재 |

### 파싱은 절대 던지지 않습니다

모델이 JSON이 아닌 것을 돌려주는 경우 `steps: []`와 함께 원문을 `content`에 통과시킵니다.
영어 기능에서 파싱 오류 때문에 500을 띄우는 건 사용자에게 아무 도움도 안 되는 화면이기 때문입니다.

### 화면 전용 메시지는 다음 호출에 넣지 않습니다 (D-016)

`steps`는 **API로 보내지 않습니다.** 클라이언트는 `turnToHistoryText()`로 압축한 문자열만 보냅니다.

```
[예문 학습]
일상 대화에서 자주 쓰이는 표현 3가지와 번역을 소개합니다.
· 예문 <A> How's your day going? — 오늘 하루 어때요?
· 예문 <A> Can I get a coffee, please? — 커피 하나 주세요?
```

구조를 통째로 직렬화하면 JSON 키가 매번 반복됩니다.
실측: 예문 3개를 포함한 3턴 대화가 **112 토큰**이었습니다.

---

### 에러 응답

모든 에러는 아래 형태입니다.

```json
{ "error": "사람이 읽을 수 있는 메시지" }
```

**상태 코드는 HTTP 상태 코드이며 본문 필드가 아닙니다.** (초기 설계 문서에
`{"error": "...", "status": 400}` 형태로 적혀 있었으나 실제 구현과 달랐습니다.)

| 상태 | 조건 | 본문 메시지 |
|------|------|-----------|
| 400 | `provider` 누락 | `provider가 필요합니다.` |
| 400 | 지원하지 않는 provider | `지원하지 않는 provider입니다: {값}` |
| 400 | `messages`가 없거나 빈 배열 | `messages가 필요합니다.` |
| 400 | 요청 본문을 읽을 수 없음 (auth) | `요청 본문을 읽을 수 없습니다.` |
| 401 | `x-app-token` 없음/불일치 | `잠금 해제가 필요합니다.` |
| 401 | PIN 불일치 (auth) | `PIN이 올바르지 않습니다.` |
| 500 | provider 호출 실패 | `요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.` |
| 500 | 인증 설정 누락 | `인증이 설정되지 않았습니다. ...` |

### provider 원본 에러는 노출하지 않습니다

provider가 실패하면 응답 본문에 키 지문 등이 포함될 수 있습니다.
이 원본은 **서버 콘솔에만** 기록되고, 클라이언트에는 짧은 한국어 메시지만 나갑니다.

다만 아래처럼 우리가 직접 만든 진단 메시지는 그대로 전달합니다 — 키 정보가 없고,
개발 중 실제 원인을 알려줄 가치가 있기 때문입니다.

- `알 수 없는 프로바이더입니다: ...`
- `{provider} API 키가 설정되지 않았습니다. .env.local의 {변수명}을 확인하세요.`
- `지원하지 않는 provider입니다: ...`
- `provider가 필요합니다.` / `messages가 필요합니다.`

`npm run dev`로 작업할 때 터미널에서 원본 원인은 그대로 볼 수 있습니다.
