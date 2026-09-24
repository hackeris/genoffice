import type {
  AiSearchProviderId,
  AiSearchProviderMeta,
  AiSearchSettings,
  AiSettings,
} from './types'

export const AI_SEARCH_PROVIDERS: AiSearchProviderMeta[] = [
  // Hosted Chinese search API: reachable from the mainland, unlike Serper/Tavily.
  { id: 'bocha', label: 'Bocha', keyPlaceholder: 'sk-...', imageSearch: false },
  { id: 'serper', label: 'Serper', keyPlaceholder: 'Serper API key', imageSearch: true },
  { id: 'serply', label: 'Serply', keyPlaceholder: 'Serply API key', imageSearch: true },
  { id: 'tavily', label: 'Tavily', keyPlaceholder: 'tvly-...', imageSearch: false },
  { id: 'parallel', label: 'Parallel', keyPlaceholder: 'Parallel API key', imageSearch: false },
  // exa/firecrawl: AI-search APIs without an image endpoint (like Tavily/Parallel)
  { id: 'exa', label: 'Exa', keyPlaceholder: 'Exa API key', imageSearch: false },
  { id: 'firecrawl', label: 'Firecrawl', keyPlaceholder: 'fc-...', imageSearch: false },
  {
    id: 'custom',
    label: 'Custom',
    keyPlaceholder: 'API Key (optional - self-hosted endpoints may not need one)',
    imageSearch: false,
    baseUrlPlaceholder: 'https://your-searxng.example/search',
  },
]

export function defaultAiSearchSettings(): AiSearchSettings {
  return {
    provider: 'bocha',
    providers: {
      bocha: { apiKey: '' },
      serper: { apiKey: '' },
      serply: { apiKey: '' },
      tavily: { apiKey: '' },
      parallel: { apiKey: '' },
      exa: { apiKey: '' },
      firecrawl: { apiKey: '' },
      custom: { apiKey: '', baseUrl: '' },
    },
  }
}

export function resolveAiSearchSettings(
  stored: Partial<AiSearchSettings> | undefined,
): AiSearchSettings {
  const defaults = defaultAiSearchSettings()
  if (!stored) return defaults
  const providers = { ...defaults.providers }
  for (const id of [
    'bocha',
    'serper',
    'serply',
    'tavily',
    'parallel',
    'exa',
    'firecrawl',
    'custom',
  ] as const) {
    const cfg = stored.providers?.[id]
    if (!cfg) continue
    providers[id] = {
      apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : '',
      ...(typeof cfg.baseUrl === 'string' ? { baseUrl: cfg.baseUrl.trim() } : {}),
    }
  }
  return { provider: stored.provider ?? defaults.provider, providers }
}

/**
 * The stored search backend, honored only when it can answer a query; null
 * means none is configured — the search tools report "configure a search
 * provider" instead of querying a backend the user never chose.
 */
export function activeSearchProvider(
  settings: Pick<AiSettings, 'search'>,
): AiSearchProviderId | null {
  const search = settings.search
  if (!search) return null
  if (!AI_SEARCH_PROVIDERS.some((m) => m.id === search.provider)) return null
  const cfg = search.providers?.[search.provider]
  // Self-hosted endpoints carry their own URL and often need no key; Parallel
  // can run keylessly; the other hosted APIs are keyed.
  if (search.provider === 'custom') return cfg?.baseUrl?.trim() ? 'custom' : null
  if (search.provider === 'parallel') return 'parallel'
  // Trim-aware: a whitespace-only key from in-memory settings falls back
  // instead of sending `Bearer    ` to the search backend.
  return cfg?.apiKey?.trim() ? search.provider : null
}
