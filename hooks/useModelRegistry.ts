'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ModelInfo } from '@/lib/models'
import type { Provider } from '@/lib/llm'
import { getToken } from '@/lib/auth-client'

/** 서버가 돌려주는 모양. lib/model-registry.ts의 Registry와 같습니다. */
export type RegistryResponse = {
  models: Record<Provider, ModelInfo[]>
  source: 'db' | 'default'
}

/**
 * 등록 폼이 다루는 값.
 *
 * ★ provider는 여기에 없습니다 ★
 * 폼은 "지금 보고 있는 provider"에 등록합니다. 상태로 들고 있다가
 * provider가 바뀌는 순간 effect로 맞춰주는 방식은 React가 권하지 않습니다
 * (연쇄 렌더). 화면 밖에서 들어오는 값은 처음부터 받아들이지 않는 편이 낫습니다.
 */
export type RegistryDraft = {
  modelId: string
  name: string
  maxTokens: string
  tpm: string
  rpm: string
}

export const EMPTY_DRAFT: RegistryDraft = {
  modelId: '',
  name: '',
  maxTokens: '2000',
  tpm: '',
  rpm: '',
}

/**
 * 모델 목록을 서버에서 읽고, 고친 결과를 되돌립니다.
 *
 * ★ 왜 목록을 prop으로 안 받고 여기서 읽나 ★
 * /chat 과 /english 가 같은 ModelPicker를 씁니다. 목록을 여기서 한 번 읽어
 * 두 화면이 같은 값을 보게 하면, 한쪽만 갱신되는 일이 없습니다.
 *
 * ★ source를 그대로 화면에 보여줍니다 ★
 * 'default'는 "DB를 못 읽어서 lib/models.ts로 돌아간 상태"입니다.
 * 이때 사용자가 자기 모델이 왜 없는지 알 수 없으므로, 화면에 드러냅니다.
 */
export function useModelRegistry() {
  const [models, setModels] = useState<Record<Provider, ModelInfo[]>>({
    openrouter: [],
    groq: [],
    gemini: [],
  })
  const [source, setSource] = useState<'db' | 'default'>('default')
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')

  /**
   * 읽기만 합니다.
   *
   * 상태를 여기서 바꾸지 않는 이유: 이 함수를 effect 안에서 부르면
   * 동기 setState로 잡힙니다. 읽기와 반영을 갈라 두면 effect는
   * "구독 → 나중에 반영" 형태로만 쓰입니다.
   */
  const fetchRegistry = useCallback(async (): Promise<RegistryResponse | null> => {
    const res = await fetch('/api/models', {
      headers: { 'x-app-token': getToken() || '' },
    })

    if (res.status === 401) throw new Error('잠금 해제가 필요합니다.')

    const data = await res.json()
    if (!res.ok) throw new Error(data?.error || '모델 목록을 읽지 못했습니다.')
    return data as RegistryResponse
  }, [])

  const apply = useCallback((data: RegistryResponse) => {
    setModels(data.models)
    setSource(data.source)
    setError('')
  }, [])

  // 첫 읽기. effect는 "외부 값을 구해오는 일"만 합니다.
  useEffect(() => {
    let alive = true
    fetchRegistry()
      .then((d) => {
        if (alive && d) apply(d)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : '모델 목록을 읽지 못했습니다.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [fetchRegistry, apply])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetchRegistry()
      if (d) apply(d)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '모델 목록을 읽지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [fetchRegistry, apply])

  const save = useCallback(
    async (provider: Provider, draft: RegistryDraft): Promise<RegistryResponse | null> => {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-token': getToken() || '',
        },
        body: JSON.stringify({
          provider,
          modelId: draft.modelId.trim(),
          name: draft.name.trim() || draft.modelId.trim(),
          maxTokens: draft.maxTokens,
          tpm: draft.tpm,
          rpm: draft.rpm,
          // 정렬은 직접 손대지 않습니다. 목록 끝에 붙입니다.
          sortOrder: 9000,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '저장하지 못했습니다.')
      apply(data as RegistryResponse)
      return data as RegistryResponse
    },
    [apply]
  )

  const remove = useCallback(
    async (provider: Provider, modelId: string) => {
      const qs = `provider=${encodeURIComponent(provider)}&modelId=${encodeURIComponent(modelId)}`
      const res = await fetch(`/api/models?${qs}`, {
        method: 'DELETE',
        headers: { 'x-app-token': getToken() || '' },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || '지우지 못했습니다.')
      apply(data as RegistryResponse)
    },
    [apply]
  )

  /**
   * provider를 실제로 한 번 불러봅니다.
   *
   * 실패는 여기서 끝이 아니라 **정상 결과**입니다 — 그래서 200으로 kind를 담아
   * 돌려줍니다 (app/api/models/test/route.ts).
   */
  const probe = useCallback(async (provider: Provider, modelId: string) => {
    const res = await fetch('/api/models/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-token': getToken() || '',
      },
      body: JSON.stringify({ provider, model: modelId.trim() }),
    })
    return (await res.json()) as {
      ok: boolean
      kind: string | null
      message: string
      repliedModel: string | null
      redirected: boolean
      sample: string
    }
  }, [])

  return { models, source, loading, error, reload, save, remove, probe }
}