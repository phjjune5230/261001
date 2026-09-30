# 02. 디자인 시스템 (Design System)

## 테마
**다크 모드 전용** — 밝은 모드는 계획에 없습니다.

## 색상 팔레트

| 용도 | 색상 | 코드 | 실제 쓰임 |
|------|------|------|----------|
| **배경** | 다크 그레이 | `#0f0f0f` | `bg-[#0f0f0f]` |
| **입력 배경** | 어두운 그레이 | `#151515` | 인풋, 셀렉트, 텍스트에어리어 |
| **말풍선 배경** | 어두운 그레이 | `#181818` | AI 말풍선, 로딩 표시 |
| **경계선** | 다크 그레이 | `#222` | `border-[#222]` |
| **보조 텍스트** | 중간 그레이 | `#555` | 설명, 보조 링크 |
| **비활성 텍스트** | 어두운 그레이 | `#444` | 비활성 항목, 라벨 |
| **강조색** | 라임 그린 | `#e8ff47` | 활성 상태, 버튼, 포커스 |
| **에러** | 레드 | `#ef4444` | 잠금 실패, API 오류 |

> 초기 설계 문서의 보조 배경은 `#1a1a1a`였으나 실제 코드에서 쓰인 적이 없습니다.
> 인풋은 `#151515`, 말풍선은 `#181818`으로 실제 사용값을 기록했습니다.

## 폰트

| 용도 | 폰트 | 로드 방식 |
|------|------|----------|
| **타이틀 / 헤딩** | Syne | `next/font/google`, CSS 변수 `--font-syne` |
| **본문 / 코드** | DM Mono | `next/font/google`, CSS 변수 `--font-dm-mono` |

```css
body       { font-family: var(--font-dm-mono), monospace; }
.font-display { font-family: var(--font-syne), sans-serif; font-weight: 700; }
```

### 반드시 알아야 할 제약

`next/font`는 **리터럴 폰트 이름을 노출하지 않습니다.** CSS 변수로만 접근할 수 있습니다.

```tsx
// ❌ 동작하지 않음 — next/font에서는 이 이름이 존재하지 않는다
style={{ fontFamily: "'Syne'" }}

// ✅ 이쪽을 쓴다
style={{ fontFamily: 'var(--font-syne), sans-serif', fontWeight: 700 }}
```

`.font-display` 유틸리티가 `globals.css`에 정의돼 있으나, 현재 페이지는 전부
인라인 `style`로 폰트를 지정합니다. 통일 여부는 미정입니다.

## 컴포넌트 규칙

### 버튼

**주요 액션** (전송, 잠금 해제)
```
bg-[#e8ff47] text-black font-semibold px-6 py-3 rounded-lg text-sm hover:opacity-90 disabled:opacity-50 transition-opacity
```

**토글 / 선택지** (provider 선택 등)
```
px-3 py-2 text-xs rounded border text-left transition-colors
  활성:   border-[#e8ff47] text-[#e8ff47] bg-[#e8ff47]/5
  비활성: border-[#222] text-[#555] hover:border-[#444] hover:text-[#888]
```

`bg-[#e8ff47]/5` — 강조색을 5% 불투명도로 깔아 "선택됨"을 표현합니다.

### 카드 / 메뉴 항목
```
group border border-[#222] hover:border-[#e8ff47] p-6 rounded-xl transition-colors
텍스트:      text-sm text-[#555] group-hover:text-[#e8ff47] transition-colors
```

### 입력 필드
```
bg-[#151515] border border-[#222] rounded-lg px-4 py-3 text-sm text-white focus:border-[#e8ff47] outline-none
```
에러 상태: `border-[#ef4444]`

### 말풍선
- 사용자: `bg-[#e8ff47] text-black self-end`
- AI: `bg-[#181818] border border-[#222] text-[#ddd]`

### 에러 표시
에러는 말풍선으로 표시하지 **않습니다**. provider 원본 JSON이 AI 응답처럼 보이던 것을
막기 위해 별도 영역에 둡니다.
```
border border-[#ef4444]/40 bg-[#ef4444]/5 rounded-lg px-4 py-3 text-sm text-[#ef8888]
```

### 레이아웃 셸
모든 페이지가 아래를 공통으로 씁니다.
```
min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center px-6
컨테이너: w-full max-w-4xl (일반) / max-w-7xl w-full mx-auto (채팅)
```

### 코드 블록
**미구현.** `react-markdown` + `remark-gfm`이 설치돼 있으나 아직 import되지 않았습니다.
구현 시 Syntax Highlighter는 `prismjs` / `shiki` 중 설치된 쪽을 씁니다 — 현재 둘 다 미설치.
