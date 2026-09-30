'use client'

import { ALL_PROVIDERS, type Provider } from '@/lib/llm'
import { MODELS } from '@/lib/models'

const CUSTOM = '__custom__'

type Props = {
  provider: Provider
  onProviderChange: (p: Provider) => void
  model: string
  onModelChange: (m: string) => void
  customModel: string
  onCustomModelChange: (m: string) => void
}

/**
 * 프로바이더·모델 선택 패널.
 *
 * /chat 과 /english 가 같은 것을 필요로 해서 뺐다. 두 곳에 복제하면
 * 목록 추가를 두 군데 고치는 순간 한쪽만 깨진다.
 */
export default function ModelPicker({
  provider,
  onProviderChange,
  model,
  onModelChange,
  customModel,
  onCustomModelChange,
}: Props) {
  return (
    <>
      <div>
        <label className="block text-xs font-semibold text-[#888] mb-2">
          프로바이더 (Provider)
        </label>
        <div className="grid grid-cols-2 gap-2">
          {ALL_PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onProviderChange(p)}
              className={`px-3 py-2 text-xs rounded border text-left transition-colors ${
                p === provider
                  ? 'border-[#e8ff47] text-[#e8ff47] bg-[#e8ff47]/5'
                  : 'border-[#222] text-[#555] hover:border-[#444] hover:text-[#888]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-[#888] mb-2">
          모델 선택 (Model)
        </label>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full bg-[#151515] border border-[#222] rounded px-3 py-2 text-xs text-white focus:border-[#e8ff47] outline-none"
        >
          {MODELS[provider].map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.id})
            </option>
          ))}
          <option value={CUSTOM}>직접 입력…</option>
        </select>

        {model === CUSTOM && (
          <input
            type="text"
            value={customModel}
            onChange={(e) => onCustomModelChange(e.target.value)}
            placeholder="model ID 입력 (예: openai/gpt-oss-120b)"
            className="mt-2 w-full bg-[#151515] border border-[#e8ff47] rounded px-3 py-2 text-xs font-mono text-white focus:border-[#e8ff47] outline-none"
          />
        )}

        <p className="mt-2 text-[10px] leading-relaxed text-[#444]">
          목록 변경은 <code className="text-[#666]">lib/models.ts</code> 에서.
          <br />
          목록에 없는 모델은 &lsquo;직접 입력&rsquo;으로 ID만 넣으면 됩니다.
        </p>
      </div>
    </>
  )
}

export { CUSTOM }
