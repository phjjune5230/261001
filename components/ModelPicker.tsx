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
        <label className="block font-mono text-label tracking-label uppercase text-ink-faint mb-2">
          프로바이더 (Provider)
        </label>
        <div className="grid grid-cols-2 gap-2">
          {ALL_PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onProviderChange(p)}
              className={`px-3 py-2 text-meta rounded-md border text-left transition-colors ${
                p === provider
                  ? 'border-accent/40 bg-accent/5 text-ink'
                  : 'border-line bg-surface-1 text-ink-muted hover:border-line-strong hover:text-ink'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block font-mono text-label tracking-label uppercase text-ink-faint mb-2">
          모델 선택 (Model)
        </label>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full bg-surface-2 border border-line rounded-md px-3 py-2 pr-8 text-meta text-ink shadow-edge outline-none focus:border-line-strong transition-colors"
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
            className="mt-2 w-full bg-surface-2 border border-accent/40 rounded-md px-3 py-2 text-meta font-mono text-ink shadow-edge outline-none focus:border-accent/60 transition-colors"
          />
        )}

        <p className="mt-2 text-meta leading-relaxed text-ink-faint">
          목록 변경은 <code className="text-ink-muted">lib/models.ts</code> 에서.
          <br />
          목록에 없는 모델은 &lsquo;직접 입력&rsquo;으로 ID만 넣으면 됩니다.
        </p>
      </div>
    </>
  )
}

export { CUSTOM }