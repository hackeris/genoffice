/**
 * Live vendor model catalogs for the settings picker. The static tables in
 * providers.ts are hand-maintained snapshots ("ids exactly as GET … lists
 * them") that go stale the day a vendor ships or retires a model; these
 * fetchers refresh them from the same endpoints the snapshots were taken
 * from. Everything here runs in the main process — renderers reach it via
 * the ai:list-models IPC, never directly.
 *
 * Failure is always a value, never a throw: the caller keeps serving the
 * static table and uses `status` to tell a rejected key (401/403) from a
 * vendor without a list endpoint (404/405) from transport trouble.
 */
import { aiFetch } from './fetch'
import { ANTHROPIC_BASE_URL } from './protocols/anthropic'
import { AI_PROVIDER_ADAPTERS, OPENCODE_GATEWAY_ROOTS } from './registry'
import type { AiProviderId, ProviderModelCatalog } from './types'

const LIST_TIMEOUT_MS = 15_000
const ANTHROPIC_VERSION = '2023-06-01'

type Auth = { apiKey?: string | undefined; baseUrl?: string | undefined }

function bearer(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {}
}

function cleanBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/** the JSON array to read ids/names from, tolerant of vendor envelope shapes */
function itemsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const key of ['data', 'models', 'result']) {
      const v = (body as Record<string, unknown>)[key]
      if (Array.isArray(v)) return v
    }
  }
  return []
}

function idsOf(body: unknown): string[] {
  const out: string[] = []
  for (const item of itemsOf(body)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const id = rec.id ?? rec.name
    if (typeof id === 'string' && id) out.push(id)
  }
  return out
}

/** Gemini names its catalog entries "models/gemini-…"; the picker wants bare ids */
function geminiIds(body: unknown): string[] {
  const out: string[] = []
  for (const item of itemsOf(body)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.name !== 'string') continue
    const methods = rec.supportedGenerationMethods
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue
    out.push(rec.name.replace(/^models\//, ''))
  }
  return out
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: true; body: unknown } | { ok: false; status?: number; error: string }> {
  let resp: Response
  try {
    resp = await aiFetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    return { ok: false, status: resp.status, error: `HTTP ${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` }
  }
  try {
    return { ok: true, body: await resp.json() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** One catalog fetch per provider id; `ok: false` never throws. Codex has its own channel. */
export async function listProviderModels(
  provider: AiProviderId,
  config: Auth,
): Promise<ProviderModelCatalog> {
  const apiKey = config.apiKey?.trim() || undefined
  const storedBase = config.baseUrl?.trim() || undefined
  switch (provider) {
    case 'codex':
      // lives in codex-app-server (ai:codex-models), not an HTTP catalog
      return { ok: false, error: 'codex has no HTTP model catalog' }
    case 'anthropic': {
      const r = await fetchJson(`${cleanBase(storedBase ?? ANTHROPIC_BASE_URL)}/v1/models`, {
        'x-api-key': apiKey ?? '',
        'anthropic-version': ANTHROPIC_VERSION,
      })
      return r.ok ? { ok: true, models: idsOf(r.body) } : r
    }
    case 'gemini': {
      const base = storedBase ?? 'https://generativelanguage.googleapis.com/v1beta'
      const r = await fetchJson(`${cleanBase(base)}/models?pageSize=200`, {
        'x-goog-api-key': apiKey ?? '',
      })
      return r.ok ? { ok: true, models: geminiIds(r.body) } : r
    }
    case 'requesty': {
      // managed policy ids (short stable names), the same shape the static table pins
      const r = await fetchJson(`${cleanBase(storedBase ?? 'https://router.requesty.ai/v1')}/models/managed`, bearer(apiKey))
      return r.ok ? { ok: true, models: idsOf(r.body) } : r
    }
    case 'opper': {
      // chat rides /v3/compat; the catalog sits at the /v3 root
      const base = cleanBase(storedBase ?? 'https://api.opper.ai/v3/compat').replace(/\/compat$/, '')
      const r = await fetchJson(`${base}/models`, bearer(apiKey))
      return r.ok ? { ok: true, models: idsOf(r.body) } : r
    }
    case 'opencode-zen':
    case 'opencode-go': {
      // the gateway roots route chat per model across protocols; the catalog
      // sits at `<root>/v1/models` regardless
      const root = provider === 'opencode-zen' ? OPENCODE_GATEWAY_ROOTS.zen : OPENCODE_GATEWAY_ROOTS.go
      const base = cleanBase(storedBase ?? root).replace(/\/v1$/, '')
      const r = await fetchJson(`${base}/v1/models`, bearer(apiKey))
      return r.ok ? { ok: true, models: idsOf(r.body) } : r
    }
    default: {
      // every remaining id is OpenAI-compatible: `{endpoint}/models` + Bearer.
      // custom endpoints (Ollama, LM Studio, vLLM) accept anonymous requests,
      // so a missing key simply omits the header instead of failing here
      let base: string
      try {
        base = getEndpointBase(provider, storedBase)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      const r = await fetchJson(`${cleanBase(base)}/models`, bearer(apiKey))
      return r.ok ? { ok: true, models: idsOf(r.body) } : r
    }
  }
}

function getEndpointBase(provider: AiProviderId, storedBase: string | undefined): string {
  // resolved without a model so per-model protocol routing cannot skew the base
  const adapter = AI_PROVIDER_ADAPTERS[provider]
  if (!adapter) throw new Error(`Unknown provider: ${provider}`)
  return adapter.resolveEndpoint({ apiKey: '', model: '', baseUrl: storedBase }).baseUrl
}
