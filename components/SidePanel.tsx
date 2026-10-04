'use client'

import { useState, type ReactNode } from 'react'
import Icon from './Icon'

/**
 * ============================================================================
 *  왼쪽 설정 칸 (탭)
 * ============================================================================
 *
 *  채팅과 영어가 같은 것을 씁니다 — 어제 대화 목록·모델 선택을 컴포넌트로
 *  뺀 것과 같은 이유입니다. 칸 구조가 두 벌이면 한쪽만 고치는 사고가 납니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  왜 탭으로 나눴나
 *  ─────────────────────────────────────────────────────────────────────────
 *  한 번에 전부 펼쳐 두면 세 덩어리가 동시에 자리를 차지합니다. 대화 목록은
 *  "과거를 찾는" 동안, 모델 선택은 "바꾸는" 동안, 프롬프트는 거의 한 번만 봅니다.
 *  셋이 같은 자리에 있어도 한 번에 하나만 쓰입니다.
 *
 *  탭으로 나누면 펼친 높이가 그 중 필요한 만큼만 됩니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  ★ 탭 표시줄이 곧 접기 버튼입니다 ★
 *  "설정 · 대화 · 모델 · 프롬프트"이라는 제목을 따로 두지 않았습니다.
 *  탭을 눌러야 그 탭이 열리고, 열려 있는 탭을 다시 누르면 닫힙니다.
 *  제목을 따로 두면 "무엇을 닫는 버튼인지"가 화면에 두 개로 흩어집니다.
 *
 *  기본은 접힘입니다. 이 앱의 주된 행동은 메시지를 보내는 것이고,
 *  이 칸은 그 옆에서 자리를 차지할 뿐이었습니다.
 */

export type SidePanelTab = {
  id: string
  label: string
}

export default function SidePanel({
  tabs,
  defaultTabId,
  children,
}: {
  tabs: SidePanelTab[]
  /** 처음 열 때 어떤 탭을 보여줄지. 기본은 첫 번째 탭. */
  defaultTabId?: string
  /** 지금 열려 있는 탭의 내용을 돌려줍니다. */
  children: (activeTabId: string) => ReactNode
}) {
  const [open, setOpen] = useState<boolean>(false)
  const [activeId, setActiveId] = useState<string>(defaultTabId ?? tabs[0]?.id ?? '')

  /**
   * 다른 탭을 누르면 그 탭으로 옮기고, 열려 있는 탭을 다시 누르면 닫습니다.
   *
   * 닫았다가 다시 열 때 마지막으로 보던 탭을 기억합니다 — 매번 첫 탭으로
   * 돌아가면 "방금 모델 바꿨는데"를 다시 눌러야 합니다.
   */
  const handleTab = (id: string) => {
    if (open && id === activeId) {
      setOpen(false)
      return
    }
    setActiveId(id)
    setOpen(true)
  }

  const active = tabs.find((t) => t.id === activeId)

  return (
    <aside className="w-full md:w-80 shrink-0 border-b md:border-b-0 md:border-r border-line">
      <div
        role="tablist"
        aria-label="설정"
        className="flex items-center gap-1 px-4 sm:px-6 md:px-4 py-2"
      >
        {tabs.map((t) => {
          const isActive = open && t.id === activeId
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTab(t.id)}
              className={`px-2.5 py-1.5 rounded-md text-meta border transition-colors ${
                isActive
                  ? 'border-accent/40 bg-accent/5 text-ink'
                  : 'border-transparent text-ink-muted hover:bg-surface-1 hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          )
        })}

        {/*
          화살표는 상태 표시일 뿐 클릭하지 않습니다.
          닫혀 있으면 아래, 열려 있으면 위(180도)를 가리킵니다 — 어느 칸이
          열려 있는지도 같이 알립니다.
        */}
        <span className="ml-auto pr-1 text-ink-faint">
          <Icon
            name="chevron"
            size={13}
            strokeWidth={2}
            className={`block transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </div>

      {open && active && (
        <div className="p-4 sm:p-6 pt-0 md:pt-0">
          <div role="tabpanel" aria-label={active.label}>
            {children(activeId)}
          </div>
        </div>
      )}
    </aside>
  )
}