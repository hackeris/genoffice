import { afterEach, describe, expect, it, vi } from 'vitest'
import { listProviderModels } from '../src/model-catalog'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sentUrl(fetchMock: { mock: { calls: unknown[][] } }): string {
  return String(fetchMock.mock.calls[0]?.[0])
}

function sentHeaders(fetchMock: { mock: { calls: unknown[][] } }): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined
  return (init?.headers ?? {}) as Record<string, string>
}

describe('listProviderModels', () => {
  it('reads data[].id from an OpenAI-compatible catalog with a Bearer header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: 'gpt-5.7-sol' }, { id: 'gpt-5.6-sol' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await listProviderModels('openai', { apiKey: 'sk-test' })
    expect(r).toEqual({ ok: true, models: ['gpt-5.7-sol', 'gpt-5.6-sol'] })
    expect(sentUrl(fetchMock)).toBe('https://api.openai.com/v1/models')
    expect(sentHeaders(fetchMock).authorization).toBe('Bearer sk-test')
  })

  it('uses the stored base URL over the default endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'm' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await listProviderModels('deepseek', { apiKey: 'k', baseUrl: 'https://mirror.example.com/v1 ' })
    expect(sentUrl(fetchMock)).toBe('https://mirror.example.com/v1/models')
  })

  it('sends the anthropic version header and hits /v1/models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'claude-opus-5' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await listProviderModels('anthropic', { apiKey: 'sk-ant' })
    expect(r).toEqual({ ok: true, models: ['claude-opus-5'] })
    expect(sentUrl(fetchMock)).toBe('https://api.anthropic.com/v1/models')
    expect(sentHeaders(fetchMock)['x-api-key']).toBe('sk-ant')
    expect(sentHeaders(fetchMock)['anthropic-version']).toBe('2023-06-01')
  })

  it('strips the models/ prefix and keeps generateContent-capable entries only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        models: [
          { name: 'models/gemini-4-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-4-pro' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await listProviderModels('gemini', { apiKey: 'AIza' })
    expect(r).toEqual({ ok: true, models: ['gemini-4-flash', 'gemini-4-pro'] })
    expect(sentHeaders(fetchMock)['x-goog-api-key']).toBe('AIza')
  })

  it('reads the requesty managed catalog', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ id: 'claude-sonnet-5' }, { id: 'kimi-k3' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await listProviderModels('requesty', { apiKey: 'sk' })
    expect(r).toEqual({ ok: true, models: ['claude-sonnet-5', 'kimi-k3'] })
    expect(sentUrl(fetchMock)).toBe('https://router.requesty.ai/v1/models/managed')
  })

  it('sits the opper catalog at the /v3 root while chat rides /v3/compat', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ name: 'gpt-5.5' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await listProviderModels('opper', { apiKey: 'k' })
    expect(r).toEqual({ ok: true, models: ['gpt-5.5'] })
    expect(sentUrl(fetchMock)).toBe('https://api.opper.ai/v3/models')
  })

  it('lists the opencode gateway roots at <root>/v1/models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'kimi-k3' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await listProviderModels('opencode-go', { apiKey: 'k' })
    expect(sentUrl(fetchMock)).toBe('https://opencode.ai/zen/go/v1/models')
  })

  it('omits the Authorization header for anonymous custom endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'llama3' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await listProviderModels('custom', { baseUrl: 'http://127.0.0.1:11434/v1' })
    expect(r).toEqual({ ok: true, models: ['llama3'] })
    expect(sentHeaders(fetchMock).authorization).toBeUndefined()
  })

  it('reports a rejected key as ok:false with the status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad key' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    const r = await listProviderModels('openai', { apiKey: 'nope' })
    expect(r).toEqual({ ok: false, status: 401, error: expect.stringContaining('HTTP 401') })
  })

  it('reports transport failures without a status', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await listProviderModels('kimi', { apiKey: 'k' })
    expect(r).toEqual({ ok: false, error: 'ECONNRESET' })
  })

  it('never serves codex through HTTP', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await listProviderModels('codex', {})
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
