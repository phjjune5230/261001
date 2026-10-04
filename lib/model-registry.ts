/**
 * ============================================================================
 *  모델 레지스트리 — 서버 전용
 * ============================================================================
 *
 *  ⚠️ 이 파일을 클라이언트에서 import하지 마세요.
 *     `lib/db-server.ts`를 거칩니다. 허용되는 호출부는 `app/api/**` 뿐입니다
 *     (`docs/RULE.md` 1절의 표에도 한 줄을 추가했습니다).
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  무엇을 하나
 *  "이 provider에 어떤 모델이 있고 그 모델의 한도가 얼마인가"를 **DB에서** 읽습니다.
 *  그 값을 토큰 예산 계산에 씁니다 (lib/context.ts의 contextBudgetFor).
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  왜 DB가 필요한가 — 브라우저에 두면 안 되는 이유
 *  모델의 `tpm`은 **서버**가 계산에 씁니다. 브라우저 localStorage에 두면
 *  서버가 그 값을 볼 수 없어서, 요청마다 값을 보내 "브라우저가 말한 TPM을
 *  서버가 믿는" 구조가 됩니다. 틀린 값이 그대로 예산에 들어가 조용히 400이 납니다.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  ★ 조용히 꺼지지 않게 ★
 *  DB 조회가 실패하면 `lib/models.ts`의 값으로 돌아갑니다. 앱이 멈추지
 *  않기 때문입니다 — 하지만 **서버 로그에는 반드시 이유를 남깁니다.**
 *  이 표를 못 읽은 채로 조용히 기본값을 쓰면, 사용자는 자기 모델이
 *  사라진 걸로 오해하고 우리는 아무 clue를 갖지 못합니다.
 *  조용히 돌아가는 것과 조용히 실패하는 것은 다릅니다.
 *
 *  캐시는 60초입니다. 모델은 자주 안 바뀌는데 매 요청마다 DB를 치는 것은
 *  낭비입니다. 쓰기가 일어나면 `invalidateRegistry()`가 즉시 지웁니다.
 */

import { getServerSupabase, isDbConfigured } from './db-server'
import { ALL_PROVIDERS, type Provider } from './llm'
import { MODELS, type ModelInfo } from './models'

/** 조회가 밀리면 화면이 늦게 고칩니다. 한도·버전 표시는 지직거려도 괜찮습니다. */
const CACHE_TTL_MS = 60_000

export type RegistrySource = 'db' | 'default'

export type Registry = {
  models: Record<Provider, ModelInfo[]>
  /** 지금 쓰는 값이 DB에서 온 것인지, 안전망에서 온 것인지 */
  source: RegistrySource
}

type Cached = { value: Registry; at: number }

let cache: Cached | null = null

/** 쓰기가 끝난 뒤에 부릅니다. 다음 읽기는 곧바로 DB를 봅니다. */
export function invalidateRegistry(): void {
  cache = null
}

/** DB 한 행 → ModelInfo. 잘못된 값은 null로 두어 걸러냅니다. */
function rowToModel(row: Record<string, unknown>): ModelInfo | null {
  const id = row.model_id
  const name = row.name
  const maxTokens = row.max_tokens
  if (typeof id !== 'string' || !id.trim()) return null
  if (typeof name !== 'string' || !name.trim()) return null
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) return null

  // ★ null을 지어내지 않습니다 ★
  // DB에 숫자가 있으면 쓰고, 없으면 없는 그대로 둡니다 (lib/models.ts와 같은 원칙).
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null

  return { id: id.trim(), name: name.trim(), maxTokens, tpm: num(row.tpm), rpm: num(row.rpm) }
}

async function loadFromDb(): Promise<Registry | null> {
  if (!isDbConfigured()) return null

  const { data, error } = await getServerSupabase()
    .from('models')
    .select('provider, model_id, name, max_tokens, tpm, rpm, sort_order')
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message)
  if (!data) return null

  const models = emptyRegistry()
  let count = 0
  for (const row of data) {
    const provider = (row as Record<string, unknown>).provider
    if (typeof provider !== 'string' || !ALL_PROVIDERS.includes(provider as Provider)) continue
    const m = rowToModel(row as Record<string, unknown>)
    if (!m) continue
    models[provider as Provider].push(m)
    count++
  }

  // 0행이면 안전망을 씁니다.
  // 표가 비었다는 사실과 표를 못 읽었다는 사실은 구분해야 합니다 —
  // 전자는 정상 상태지만, 후자는 조용히 실패입니다.
  return count > 0 ? { models, source: 'db' } : null
}

function emptyRegistry(): Record<Provider, ModelInfo[]> {
  return { openrouter: [], groq: [], gemini: [] }
}

function defaultRegistry(): Registry {
  return { models: MODELS, source: 'default' }
}

/**
 * 모델 목록을 돌려줍니다. **절대 실패하지 않습니다.**
 *
 * 실패하면 안전망을 돌려주되, 왜 실패했는지 서버 로그에 남깁니다.
 * 조회하지 않고서 "기본값으로 도는 중"인 상태를 모른 채로 넘어가면,
 * 사용자가 등록한 모델이 안 보일 때 아무도 원인을 모릅니다.
 */
export async function getModelRegistry(): Promise<Registry> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value

  let value: Registry
  try {
    value = (await loadFromDb()) ?? defaultRegistry()
  } catch (err: unknown) {
    // Supabase 에러에는 표·열 이름이 함께 오는 경우가 많아, 로그에 남기는 것은
    // 괜찮습니다 (provider 키는 여기 없습니다). 브라우저로는 내보내지 않습니다.
    console.error('[models] 레지스트리 조회 실패 — lib/models.ts 기본값으로 대체합니다:', err)
    value = defaultRegistry()
  }

  cache = { value, at: Date.now() }
  return value
}

/**
 * 고른 모델의 한도를 돌려줍니다.
 *
 * 목록에 없는 ID를 직접 입력한 경우 UNKNOWN_MODEL을 줍니다.
 * provider의 첫 번째 모델 한도를 빌려주는 것은 오답입니다
 * (lib/models.ts의 limitsFor와 같은 판단).
 */
export async function limitsForModel(provider: Provider, model?: string): Promise<ModelInfo> {
  const { models } = await getModelRegistry()
  const list = models[provider] ?? []

  if (model) {
    const found = list.find((m) => m.id === model)
    if (found) return found
  }
  return {
    id: '',
    name: '알 수 없는 모델',
    maxTokens: 2_000,
    tpm: null,
    rpm: null,
  }
}

/** provider의 기본 모델 (정렬된 첫 번째) */
export async function defaultModelOf(provider: Provider): Promise<string> {
  const { models } = await getModelRegistry()
  return models[provider]?.[0]?.id ?? ''
}