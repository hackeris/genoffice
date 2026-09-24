import {
  activeMediaProvider,
  activeSearchProvider,
  imageGenerationAvailable,
  mediaAnalysisAvailable,
} from '@genoffice/ai-provider'
import { readAiSettingsFile } from '@genoffice/ai-search'
import { aiSettingsPath, prepareCloud } from '../cloud'
import type { CommandDef } from '../registry'
import { appLaunch } from '../resources'

/**
 * What the cloud commands can do on this machine, decided from GenOffice's
 * own settings without a network call: a key the user entered in Settings for
 * the chat / media / search backends. Unkeyed fallbacks (DuckDuckGo) do not
 * count as configured. Agents check this once before planning work that needs
 * photos or web facts.
 */
export const capabilitiesCommand: CommandDef = {
  name: 'capabilities',
  summary:
    'Report which cloud features (search, image search, image generation, media analysis) are configured in GenOffice, and whether the app is installed.',
  usage: 'capabilities',
  async run(_args, ctx) {
    await prepareCloud(ctx.env)
    const settings = readAiSettingsFile(aiSettingsPath(ctx.env))
    const searchProvider = activeSearchProvider(settings)
    const search = searchProvider !== null
    const imageSearch = searchProvider === 'serper'
    const imageGeneration = imageGenerationAvailable(settings)
    const mediaAnalysis = mediaAnalysisAvailable(settings)
    const detail = {
      search: { available: search, via: searchProvider },
      image_search: {
        available: imageSearch,
        via: imageSearch ? 'serper' : null,
      },
      image_generation: {
        available: imageGeneration,
        via: imageGeneration ? activeMediaProvider(settings, 'image') : null,
      },
      media_analysis: {
        available: mediaAnalysis,
        via: mediaAnalysis ? activeMediaProvider(settings, 'analysis') : null,
      },
      app: { available: appLaunch(ctx.env) !== null },
      settings_path: aiSettingsPath(ctx.env),
    }
    const on = Object.entries(detail)
      .filter(([k, v]) => k !== 'settings_path' && (v as { available: boolean }).available)
      .map(([k]) => k)
    return {
      summary: on.length
        ? `configured: ${on.join(', ')}`
        : 'no cloud feature configured; the app is not installed',
      detail,
    }
  },
}
