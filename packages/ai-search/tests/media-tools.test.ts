import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@genoffice/ai-provider', () => ({
  activeMediaConfig: vi.fn(),
  generateImageWithProvider: vi.fn(),
  analyzeMediaWithProvider: vi.fn(),
  defaultAiSettings: vi.fn(() => ({})),
  resolveAiSettings: vi.fn(() => ({})),
}))
vi.mock('@genoffice/electron-utils/generated-images', () => ({
  readGeneratedImage: vi.fn(),
  storeGeneratedImage: vi.fn(() => 'file:///gen/generated.png'),
}))

import { activeMediaConfig, generateImageWithProvider } from '@genoffice/ai-provider'
import {
  MEDIA_NOT_CONFIGURED_ERROR,
  analyzeMediaTool,
  generateImageTool,
} from '../src/media-tools'

const mockActive = vi.mocked(activeMediaConfig)
const mockGenerate = vi.mocked(generateImageWithProvider)

// nonexistent settings file → defaults, i.e. no BYOK media provider configured
const SETTINGS = '/nonexistent/ai-settings.json'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateImageTool', () => {
  it('reports the not-configured message when no image provider is set', async () => {
    mockActive.mockReturnValue(null)
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon' })
    expect(r).toEqual({ error: MEDIA_NOT_CONFIGURED_ERROR })
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('prefers the caller-localized message', async () => {
    mockActive.mockReturnValue(null)
    const r = await generateImageTool(
      SETTINGS,
      { prompt: 'red podcast icon' },
      { notConfiguredError: 'configure an image provider first' },
    )
    expect(r).toEqual({ error: 'configure an image provider first' })
  })

  it('rejects an empty prompt before touching any provider', async () => {
    const r = await generateImageTool(SETTINGS, { prompt: '   ' })
    expect(r).toEqual({ error: 'prompt must not be empty' })
    expect(mockActive).not.toHaveBeenCalled()
  })

  it('routes to the configured provider and returns the stored image URL', async () => {
    mockActive.mockReturnValue({ provider: 'glm', config: {} } as never)
    mockGenerate.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
    } as never)
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon', aspectRatio: '1:1' })
    expect(r).toEqual({ url: 'file:///gen/generated.png' })
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockGenerate.mock.calls[0]![0]).toBe('glm')
  })

  it('surfaces a provider failure as an error', async () => {
    mockActive.mockReturnValue({ provider: 'glm', config: {} } as never)
    mockGenerate.mockRejectedValue(new Error('quota exceeded'))
    const r = await generateImageTool(SETTINGS, { prompt: 'red podcast icon' })
    expect(r).toEqual({ error: 'quota exceeded' })
  })
})

describe('analyzeMediaTool', () => {
  it('reports the not-configured message when neither analysis nor video provider is set', async () => {
    mockActive.mockReturnValue(null)
    const r = await analyzeMediaTool(SETTINGS, {
      mediaUrls: ['https://cdn/x/a.png'],
      requirements: 'describe',
    })
    expect(r).toEqual({ error: MEDIA_NOT_CONFIGURED_ERROR })
  })

  it('requires both mediaUrls and requirements', async () => {
    const noUrls = await analyzeMediaTool(SETTINGS, { mediaUrls: [], requirements: 'describe' })
    expect(noUrls).toEqual({ error: 'mediaUrls must not be empty' })
    const noReq = await analyzeMediaTool(SETTINGS, {
      mediaUrls: ['https://cdn/x/a.png'],
      requirements: '  ',
    })
    expect(noReq).toEqual({ error: 'requirements must not be empty' })
  })
})
