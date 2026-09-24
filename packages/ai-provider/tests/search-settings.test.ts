import { describe, expect, it } from 'vitest'
import { defaultAiSettings, resolveAiSettings } from '../src/providers'
import {
  activeSearchProvider,
  defaultAiSearchSettings,
  resolveAiSearchSettings,
} from '../src/search-settings'
import type { AiSearchProviderId, AiSearchSettings } from '../src/types'

describe('search settings', () => {
  it('defaults to bocha with empty keys and rides along in defaultAiSettings', () => {
    expect(defaultAiSearchSettings()).toEqual({
      provider: 'bocha',
      providers: {
        bocha: { apiKey: '' },
        serper: { apiKey: '' },
        tavily: { apiKey: '' },
        custom: { apiKey: '', baseUrl: '' },
      },
    })
    expect(defaultAiSettings().search?.provider).toBe('bocha')
    const resolved = resolveAiSettings(
      { provider: 'glm', providers: {} as never },
      defaultAiSettings(),
    )
    expect(resolved.search).toEqual(defaultAiSearchSettings())
  })

  it('merges and trims stored keys', () => {
    const s = resolveAiSearchSettings({
      provider: 'tavily',
      providers: { tavily: { apiKey: ' tvly-1 ' } } as never,
    })
    expect(s.provider).toBe('tavily')
    expect(s.providers.tavily.apiKey).toBe('tvly-1')
    expect(s.providers.serper.apiKey).toBe('')
  })

  it('activates a search backend only when it can answer', () => {
    const base = defaultAiSearchSettings()
    const withProvider = (
      provider: AiSearchProviderId,
      patch: Partial<AiSearchSettings['providers'][AiSearchProviderId]>,
    ): AiSearchSettings => ({
      provider,
      providers: { ...base.providers, [provider]: { apiKey: '', ...patch } },
    })
    expect(activeSearchProvider({ search: undefined })).toBeNull()
    expect(activeSearchProvider({ search: withProvider('serper', {}) })).toBeNull()
    expect(activeSearchProvider({ search: withProvider('serper', { apiKey: 'k' }) })).toBe('serper')
    expect(activeSearchProvider({ search: withProvider('serper', { apiKey: '   ' }) })).toBeNull()
    // a self-hosted endpoint is keyed by URL, not by an API key
    expect(activeSearchProvider({ search: withProvider('custom', {}) })).toBeNull()
    expect(
      activeSearchProvider({ search: withProvider('custom', { baseUrl: 'https://sx.search' }) }),
    ).toBe('custom')
    expect(activeSearchProvider({ search: { provider: 'bing', providers: {} } as never })).toBeNull()
  })
})
