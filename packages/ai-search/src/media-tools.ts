/**
 * generate_image / analyze_media for the five editors' main processes: one
 * place that reads ai-settings.json live and routes to the configured BYOK
 * media provider. Providers answer with bytes; those land in the local
 * generated-image store and come back as a file:// URL that the insert
 * pipelines' fetchRemoteImage accepts. With no provider configured the tool
 * returns the not-configured message instead of calling anything upstream.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
  activeMediaConfig,
  analyzeMediaWithProvider,
  defaultAiSettings,
  generateImageWithProvider,
  resolveAiSettings,
  type AiSettings,
  type LegacyAiSettings,
  type MediaBlob,
} from '@genoffice/ai-provider'
// deep imports: the package root re-exports Electron-bound modules, and this file also runs in the genoffice CLI
import { readGeneratedImage, storeGeneratedImage } from '@genoffice/electron-utils/generated-images'
import { fetchRemoteImage } from '@genoffice/electron-utils/remote-image'
import { fetchWithSsrfGuard } from '@genoffice/electron-utils/safe-remote-url'

export const MEDIA_NOT_CONFIGURED_ERROR =
  'No image/media provider is configured; pick one and add its API key under Settings (AI Media) to use this tool'

/** 200 MB: enough for a long clip through the Gemini Files API, small enough to hold in memory */
const MAX_MEDIA_BYTES = 200 * 1024 * 1024

/** the size cap, reported distinctly; other load failures read as-is */
export class MediaTooLargeError extends Error {}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
}

export function readAiSettingsFile(path: string): AiSettings {
  let stored: Partial<AiSettings> & LegacyAiSettings = {}
  try {
    if (existsSync(path)) stored = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    /* corrupted settings file: defaults */
  }
  return resolveAiSettings(stored, defaultAiSettings())
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Resolves a tool-supplied media reference to bytes: an https URL (SSRF-guarded),
 * a file:// URL from the generated-image store, or a local media file
 * (attachments). Only media extensions are read locally — the model must not be
 * able to ship arbitrary files to a vendor.
 */
export async function loadMediaReference(ref: string): Promise<MediaBlob> {
  if (/^https?:\/\//i.test(ref)) {
    const resp = await (ref.match(/\.(png|jpe?g|gif|webp)(\?|$)/i)
      ? fetchRemoteImage(ref)
      : fetchWithSsrfGuard(ref, { headers: { 'User-Agent': 'Mozilla/5.0' } }))
    if (!resp || !resp.ok) throw new Error(`Could not download ${ref}`)
    const declared = Number(resp.headers.get('content-length') ?? 0)
    if (declared > MAX_MEDIA_BYTES) throw new MediaTooLargeError(`${ref} is too large to analyze`)
    const bytes = new Uint8Array(await resp.arrayBuffer())
    if (bytes.byteLength > MAX_MEDIA_BYTES) {
      throw new MediaTooLargeError(`${ref} is too large to analyze`)
    }
    const rawCt = resp.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    const ct = rawCt && rawCt !== 'application/octet-stream' ? rawCt : undefined
    const name = basename(new URL(ref).pathname) || undefined
    const mime =
      ct && ct !== 'application/octet-stream' ? ct : MIME_BY_EXT[extname(name ?? '').toLowerCase()]
    if (!mime) throw new Error(`Could not tell the media type of ${ref}`)
    return { bytes, mime, ...(name ? { name } : {}) }
  }
  if (ref.startsWith('file:')) {
    const local = readGeneratedImage(ref)
    if (!local) throw new Error(`Not an accessible image: ${ref}`)
    return { bytes: new Uint8Array(local.bytes), mime: local.mime }
  }
  const mime = MIME_BY_EXT[extname(ref).toLowerCase()]
  if (!mime) throw new Error(`Unsupported media file: ${ref} (images, video and audio only)`)
  if (!existsSync(ref)) throw new Error(`File not found: ${ref}`)
  if (statSync(ref).size > MAX_MEDIA_BYTES) {
    throw new MediaTooLargeError(`${ref} is too large to analyze`)
  }
  return { bytes: new Uint8Array(readFileSync(ref)), mime, name: basename(ref) }
}

export interface MediaToolOptions {
  /** localized replacement for the default not-configured message */
  notConfiguredError?: string
}

export type GenerateImageToolOp = {
  /** Image description (English works better; text that must appear in the image stays verbatim) */
  prompt: string
  /** Accepted for callers that pass a model hint; the BYOK path uses the configured image model. */
  model?: string
  /** Reference/edit-target image URLs (local paths also supported) */
  referenceImageUrls?: string[]
  /** 1:1 | 4:3 | 16:9 | 9:16 | 3:4 | 2:3 | 3:2 | auto */
  aspectRatio?: string
  /** Accepted for callers that pass a size hint; the BYOK path uses the provider default. */
  imageSize?: string
  /** The result must have real PNG alpha (icons/logos/cutouts). Generation models cannot
   * produce transparency from the prompt alone — they paint a fake gray checkerboard into
   * the pixels — so the provider is asked for transparency support instead. */
  transparentBackground?: boolean
}

export async function generateImageTool(
  settingsPath: string,
  op: GenerateImageToolOp,
  options: MediaToolOptions = {},
): Promise<{ url?: string; error?: string }> {
  const prompt = String(op.prompt ?? '').trim()
  if (!prompt) return { error: 'prompt must not be empty' }
  const settings = readAiSettingsFile(settingsPath)
  const byok = activeMediaConfig(settings, 'image')
  if (!byok) return { error: options.notConfiguredError ?? MEDIA_NOT_CONFIGURED_ERROR }
  try {
    const references = await Promise.all((op.referenceImageUrls ?? []).map(loadMediaReference))
    const image = await generateImageWithProvider(byok.provider, byok.config, {
      prompt,
      aspectRatio: op.aspectRatio,
      references,
      transparent: op.transparentBackground === true,
    })
    return { url: storeGeneratedImage(image.bytes, image.mime) }
  } catch (err) {
    return { error: errorText(err) }
  }
}

export async function analyzeMediaTool(
  settingsPath: string,
  op: { mediaUrls: string[]; requirements: string },
  options: MediaToolOptions = {},
): Promise<{ text?: string; error?: string }> {
  const mediaUrls = (op.mediaUrls ?? []).map(String).filter(Boolean)
  const requirements = String(op.requirements ?? '').trim()
  if (!mediaUrls.length) return { error: 'mediaUrls must not be empty' }
  if (!requirements) return { error: 'requirements must not be empty' }
  const settings = readAiSettingsFile(settingsPath)
  const imageByok = activeMediaConfig(settings, 'analysis')
  const videoByok = activeMediaConfig(settings, 'video')
  if (!imageByok && !videoByok) {
    return { error: options.notConfiguredError ?? MEDIA_NOT_CONFIGURED_ERROR }
  }
  try {
    // route on the loaded bytes' real MIME, not the URL spelling: images go to the
    // image-analysis provider, anything with video/audio to the video one
    let media: MediaBlob[]
    try {
      media = await Promise.all(mediaUrls.map(loadMediaReference))
    } catch (err) {
      // scheme / path / SSRF rejections and the size cap all read as-is; there is no
      // upstream fallback left to hand anything back to
      return { error: errorText(err) }
    }
    const hasVideo = media.some((m) => !m.mime.startsWith('image/'))
    const byok = hasVideo ? videoByok : imageByok
    if (!byok) return { error: options.notConfiguredError ?? MEDIA_NOT_CONFIGURED_ERROR }
    return {
      text: await analyzeMediaWithProvider(byok.provider, byok.config, { media, requirements }),
    }
  } catch (err) {
    return { error: errorText(err) }
  }
}
