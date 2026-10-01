# First App

개인 실 사용 AI 어시스턴트. provider를 직접 골라 쓰고, 대화는 어디서든 이어갑니다.

- **채팅** — `/chat`
- **영어 학습** — `/english`
- **운영 중** — https://261001-zeta.vercel.app (push 하면 자동 배포)

> 이전 프로젝트 `C:\june\old`는 **컨셉만** 참고했고 코드는 가져오지 않았습니다.

---

## 읽는 순서

이 저장소에는 문서가 **4개** 있습니다. 위에서부터 읽으면 되고, 이게 전부입니다.

| | 파일 | 답해 주는 것 |
|---|---|---|
| 1 | `README.md` (이 파일) | 이게 뭔가, 어떻게 도는지 |
| 2 | [`docs/RULE.md`](docs/RULE.md) | 앞으로 뭘 지켜야 하나 — **코딩 전에 읽음** |
| 3 | [`docs/DESIGN.md`](docs/DESIGN.md) | 왜 이렇게 만들었나 + 어디로 가나 |
| 4 | [`docs/BACKLOG.md`](docs/BACKLOG.md) | 아직 안 된 것 |

모델 목록은 문서가 아니라 **`lib/models.ts`** 한 곳에서만 봅니다. 모델을 추가·삭제할 때 손댈 곳은 저 파일 하나입니다.

## 빠른 시작

```powershell
cd C:\june\first_app
Copy-Item .env.example .env.local
npm install
npm run dev
```

`.env.local`에 채울 값 (없으면 앱이 열리지 않습니다 — fail-closed):

```env
OPENROUTER_API_KEY=...
GROQ_API_KEY=...
GEMINI_API_KEY=...
APP_PIN=본인이 정한 6자리 숫자
APP_TOKEN=임의의 긴 랜덤 문자열
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

- **`.env`가 아니라 `.env.local`입니다.** 둘 다 커밋에서 제외됩니다.
- `SUPABASE_SERVICE_ROLE_KEY`에 **`NEXT_PUBLIC_` 접두사를 절대 붙이지 마세요.**
  이 키는 DB 권한을 완전히 우회하고, 접두사가 붙는 순간 브라우저 번들에 평문으로 실립니다.
  자세한 건 [`docs/RULE.md`](docs/RULE.md).

## 대화 저장이 안 될 때

가장 흔한 함정입니다. **`SUPABASE_SERVICE_ROLE_KEY`가 없으면 저장이 조용히 꺼집니다.**
화면은 정상 작동하고 대화도 되기 때문에 눈에 띄는 실패가 없습니다.

- 대화 목록이 안 보이면 이 키부터 확인하세요 (503을 "저장 안 됨"으로 바꿔 보여 줍니다).
- `SUPABASE_URL`은 예전 이름(`NEXT_PUBLIC_SUPABASE_URL`)도 읽지만 `SUPABASE_SERVICE_ROLE_KEY`에는 대체 이름이 없습니다.

스키마는 **`supabase/schema.sql` → `supabase/single-user.sql` 이 순서로** 실행해야 합니다.
순서가 반대면 정책이 참조하던 열이 사라져 실패합니다.

## 기술 스택

Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · React 19
LLM 호출은 OpenRouter·Groq가 raw `fetch`, Gemini만 `@google/generative-ai` SDK를 씁니다 (Vercel AI SDK 미사용).
대화 저장은 Supabase Postgres. 응답은 비스트리밍입니다 — 전체를 받고 나서 렌더링합니다.

## 알려진 한계

읽어두면 좋은 것만 적었습니다. 자세한 건 [`docs/BACKLOG.md`](docs/BACKLOG.md).

- **접근 보호가 약합니다.** 토큰이 `sessionStorage`에 있어 개발자도구로 볼 수 있고 시도 제한이 없습니다.
  "URL만 아는 사람"은 막지만 "집요한 사람"은 막지 못합니다. 의도적으로 이 수준입니다.
- **긴 대화는 앞부분이 잘립니다.** 토큰 예산 6,000을 넘으면 오래된 메시지를 버립니다.
  화면과 DB에는 전부 남지만 **모델에게는 최근 일부만 보입니다.** 압축 요약은 아직 없습니다.
- 대화가 100턴을 넘으면 "아까 그 얘기"가 풀리지 않습니다. 위와 같은 이유입니다.