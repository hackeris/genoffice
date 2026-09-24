/**
 * ai:web-search / ai:image-search for the editors' main processes: reads
 * ai-settings.json live and turns the search provider choice into
 * SearchOptions — the user's backend (custom endpoint, Bocha, Serper, Tavily)
 * runs first, with DuckDuckGo as the keyless last resort.
 */

import {
  activeSearchProvider,
  type AiSearchProviderId,
  type AiSettings,
} from '@genoffice/ai-provider'
import { imageSearch, webSearch, type SearchOptions } from './index'
import { readAiSettingsFile } from './media-tools'

export function searchOptionsFromSettings(settings: AiSettings): SearchOptions {
  const provider = activeSearchProvider(settings)
  // Nothing configured: fall through to the env keys and the free chain.
  if (!provider) return {}
  const cfg = settings.search!.providers[provider]
  const key = cfg.apiKey ?? ''
  if (provider === 'custom') return { customUrl: cfg.baseUrl ?? '', customKey: key }
  if (provider === 'tavily') return { tavilyKey: key, prefer: 'tavily' }
  if (provider === 'bocha') return { bochaKey: key }
  return { serperKey: key }
}

export function webSearchTool(settingsPath: string, query: string, maxResults = 6) {
  return webSearch(query, maxResults, searchOptionsFromSettings(readAiSettingsFile(settingsPath)))
}

export function imageSearchTool(settingsPath: string, query: string, maxResults = 8) {
  return imageSearch(query, maxResults, searchOptionsFromSettings(readAiSettingsFile(settingsPath)))
}

/** settings-UI test: one minimal query against the given backend must be answered by it */
export async function testSearchProvider(
  provider: AiSearchProviderId,
  apiKey: string,
  baseUrl?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (provider === 'custom' && !baseUrl?.trim()) {
    return { ok: false, error: 'Endpoint URL is empty' }
  }
  if (provider !== 'custom' && !apiKey) return { ok: false, error: 'API key is empty' }
  // Every other backend is blanked out so a rejection cannot be masked by a fallback.
  const options: SearchOptions =
    provider === 'custom'
      ? { customUrl: baseUrl ?? '', customKey: apiKey }
      : provider === 'tavily'
        ? { tavilyKey: apiKey, serperKey: '', bochaKey: '' }
        : provider === 'bocha'
          ? { bochaKey: apiKey, serperKey: '', tavilyKey: '' }
          : { serperKey: apiKey, bochaKey: '', tavilyKey: '' }
  const r = await webSearch('GenOffice', 1, options)
  if (r.method === provider) return { ok: true }
  return {
    ok: false,
    error:
      r.method === 'error'
        ? (r.error ?? 'search failed')
        : `${provider} did not answer (endpoint/key rejected or quota exhausted); fell back to ${r.method}`,
  }
}
