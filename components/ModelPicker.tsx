'use client'

import { useEffect, useMemo, useState } from 'react'
import { ALL_PROVIDERS, type Provider } from '@/lib/llm'
import type { ModelInfo } from '@/lib/models'
import { EMPTY_DRAFT, type RegistryDraft, type useModelRegistry } from '@/hooks/useModelRegistry'

const CUSTOM = '__custom__'

type Registry = ReturnType<typeof useModelRegistry>

type Props = {
  provider: Provider
  onProviderChange: (p: Provider) => void
  model: string
  onModelChange: (m: string) => void
  customModel: string
  onCustomModelChange: (m: string) => void
  /** 목록과 편집 기능. 페이지가 한 번 읽고 두 화면에 같은 값을 줍니다. */
  registry: Registry
}

const LABEL =
  'block font-mono text-label tracking-label uppercase text-ink-faint mb-2'

const FIELD =
  'w-full bg-surface-2 border border-line rounded-md px-3 py-2 text-meta text-ink shadow-edge outline-none focus:border-line-strong transition-colors'

/**
 * 프로바이더·모델 선택 패널.
 *
 * /chat 과 /english 가 같은 것을 필요로 해서 뺐다. 두 곳에 복제하면
 * 목록 추가를 두 군데 고치는 순간 한쪽만 깨진다.
 *
 * v0.13.0부터 목록을 서버(DB)에서 읽고 여기서 고칩니다.
 * 이전에는 lib/models.ts를 고쳐 배포해야 했습니다.
 */
export default function ModelPicker({
  provider,
  onProviderChange,
  model,
  onModelChange,
  customModel,
  onCustomModelChange,
  registry,
}: Props) {
  const { models, source, loading, error, save, remove, probe } = registry
  const [managing, setManaging] = useState<boolean>(false)
  const [draft, setDraft] = useState<RegistryDraft>({ ...EMPTY_DRAFT })
  const [busy, setBusy] = useState<boolean>(false)
  const [formError, setFormError] = useState<string>('')
  const [probeResult, setProbeResult] = useState<string>('')

  // ★ useMemo로 고정합니다 ★
  // `models[provider] ?? []`를 그대로 쓰면 렌더마다 새 배열이 생겨서
  // 아래 effect의 의존성이 매번 바뀝니다. effect가 매번 다시 돌면
  // 왜 돌아갔는지 추적이 안 됩니다.
  const list: ModelInfo[] = useMemo(() => models[provider] ?? [], [models, provider])

  /**
   * 고른 모델이 목록에 없으면 목록의 첫 것으로 옮깁니다.
   *
   * DB에서 지웠는데 화면에는 아직 남아 있는 경우입니다. 그대로 두면
   * select가 빈 값으로 보이고, 그대로 보내면 "알 수 없는 모델"로 계산됩니다.
   */
  useEffect(() => {
    if (loading) return
    if (model === CUSTOM) return
    if (list.length === 0) return
    if (list.some((m) => m.id === model)) return
    onModelChange(list[0].id)
  }, [list, loading, model, onModelChange])

  const handleSave = async () => {
    setFormError('')
    setProbeResult('')
    if (!draft.modelId.trim()) {
      setFormError('modelId를 입력해주세요.')
      return
    }
    setBusy(true)
    try {
      await save(provider, draft)
      setDraft({ ...EMPTY_DRAFT })
      setProbeResult('저장됐습니다. 이 모델로 채팅할 수 있습니다.')
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const handleProbe = async (m: ModelInfo) => {
    setProbeResult('')
    setBusy(true)
    try {
      const r = await probe(provider, m.id)
      if (r.ok) {
        setProbeResult(
          `${m.id} — 연결됨` +
          (r.redirected ? ` (provider가 ${r.repliedModel}로 돌려줌)` : '')
        )
      } else {
        setProbeResult(`${m.id} — 실패 [${r.kind}] ${r.message}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (m: ModelInfo) => {
    setFormError('')
    setProbeResult('')
    setBusy(true)
    try {
      await remove(provider, m.id)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '지우지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div>
        <label className={LABEL}>프로바이더 (Provider)</label>
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
        <label className={LABEL}>모델 선택 (Model)</label>
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={loading}
          className={`${FIELD} pr-8 disabled:text-ink-faint`}
        >
          {list.map((m) => (
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
            className={`mt-2 ${FIELD} font-mono border-accent/40`}
          />
        )}

        {loading && <p className="mt-2 text-meta text-ink-faint">목록을 읽는 중…</p>}

        {/*
          source가 'default'는 "DB를 못 읽어서 코드 기본값으로 돌아간 상태"입니다.
          조용히 숨기면 사용자는 자기 모델이 왜 없는지 알 수 없습니다.
        */}
        {!loading && source === 'default' && (
          <p className="mt-2 text-meta text-ink-muted">
            기본 목록으로 보고 있습니다. 모델을 등록하려면 Supabase의
            <code className="text-ink-faint"> models </code> 표가 필요합니다.
          </p>
        )}

        {error && <p className="mt-2 text-meta text-danger">{error}</p>}

        <button
          type="button"
          onClick={() => setManaging((v) => !v)}
          className="mt-2 text-meta text-ink-muted hover:text-ink transition-colors"
        >
          {managing ? '닫기' : '모델 관리…'}
        </button>

        {managing && (
          <div className="mt-3 border border-line rounded-md p-3 bg-surface-1">
            <p className="text-meta text-ink-muted mb-2">
              provider에 한정된 목록입니다. ID는 provider가 폐기하면 404가 나므로
              등록 전에 시험을 돌려보세요.
            </p>

            {list.length === 0 ? (
              <p className="text-meta text-ink-faint">등록된 모델이 없습니다.</p>
            ) : (
              <ul className="space-y-2 mb-3">
                {list.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 text-meta text-ink-muted"
                  >
                    <span className="font-mono text-ink-faint truncate flex-1" title={m.id}>
                      {m.id}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleProbe(m)}
                      className="shrink-0 text-meta text-ink-muted hover:text-ink transition-colors disabled:text-ink-faint"
                    >
                      시험
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDelete(m)}
                      className="shrink-0 text-meta text-danger/70 hover:text-danger transition-colors disabled:text-ink-faint"
                    >
                      지우기
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {probeResult && (
              <p className="text-meta text-ink-muted mb-2 break-all">{probeResult}</p>
            )}

            <label className={LABEL}>model ID</label>
            <input
              type="text"
              value={draft.modelId}
              onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
              placeholder="openai/gpt-oss-120b"
              className={`${FIELD} mb-2 font-mono`}
            />

            <label className={LABEL}>표시 이름 (비우면 ID 그대로)</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="GPT-OSS 120B"
              className={`${FIELD} mb-2`}
            />

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={LABEL}>maxTokens</label>
                <input
                  type="number"
                  min={1}
                  value={draft.maxTokens}
                  onChange={(e) => setDraft({ ...draft, maxTokens: e.target.value })}
                  className={`${FIELD} font-mono`}
                />
              </div>
              <div>
                <label className={LABEL}>tpm</label>
                <input
                  type="number"
                  min={1}
                  value={draft.tpm}
                  onChange={(e) => setDraft({ ...draft, tpm: e.target.value })}
                  placeholder="모르면 빈칸"
                  className={`${FIELD} font-mono`}
                />
              </div>
              <div>
                <label className={LABEL}>rpm</label>
                <input
                  type="number"
                  min={1}
                  value={draft.rpm}
                  onChange={(e) => setDraft({ ...draft, rpm: e.target.value })}
                  placeholder="모르면 빈칸"
                  className={`${FIELD} font-mono`}
                />
              </div>
            </div>

            <p className="mt-2 text-meta text-ink-faint">
              tpm을 모르면 비워 두세요. 입력 예산이 여기서 나오므로, 지어낸 숫자는
              조용히 틀립니다.
            </p>

            {formError && <p className="mt-2 text-meta text-danger">{formError}</p>}

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSave()}
              className="mt-3 w-full px-3 py-2 text-meta rounded-md border border-line-strong bg-surface-2 text-ink hover:bg-surface-3 transition-colors disabled:text-ink-faint"
            >
              {busy ? '처리 중…' : '이 provider에 등록'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export { CUSTOM }