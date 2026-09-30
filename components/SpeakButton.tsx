'use client'

import { useState, useSyncExternalStore } from 'react'

// 마운트 여부를 구독 없이 읽기 위한 더미 구독.
// 서버에서는 false, 클라이언트에서는 true를 준다.
const noopSubscribe = () => () => {}
const isClient = () => true

/**
 * 예문을 읽어주는 버튼.
 *
 * Web Speech API(`speechSynthesis`)를 쓴다 — TTS API 키도, 추가 의존성도 없다.
 * OLD가 쓰던 방식과 같은 근본 선택이지만 구현은 전부 다시 않았다 (D-008).
 *
 * 서버에서는 렌더하지 않는다. `window`를 직접 확인하면 서버는 null,
 * 클라이언트는 버튼을 그려 **hydration 불일치**가 납니다. 마운트 여부를
 * 구독으로 읽어 서버와 첫 페인트의 출력을 같게 맞춥니다.
 */
export default function SpeakButton({ text, label = '발음 듣기' }: { text: string; label?: string }) {
  const [speaking, setSpeaking] = useState(false)
  const mounted = useSyncExternalStore(noopSubscribe, isClient, () => false)

  if (!mounted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return null
  }

  const speak = () => {
    // 연타하면 쌓인다. 끊고 새로 읽는다.
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'en-US'
    utterance.rate = 1.0

    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)

    setSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }

  return (
    <button
      type="button"
      onClick={speak}
      title={label}
      aria-label={label}
      className={`shrink-0 w-7 h-7 rounded-full border text-xs flex items-center justify-center transition-colors ${
        speaking
          ? 'border-[#e8ff47] bg-[#e8ff47]/10'
          : 'border-[#333] text-[#888] hover:border-[#e8ff47] hover:text-[#e8ff47]'
      }`}
    >
      {speaking ? '■' : '🔊'}
    </button>
  )
}
