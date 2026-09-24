/**
 * Search utilities (main process) — a user-configured backend (Bocha, Serper,
 * Tavily, or a self-hosted endpoint) with DuckDuckGo as the keyless last
 * resort. Runs in the main process (Node fetch) to avoid renderer CORS; the
 * host keys reuse BOCHA_API_KEY / SERPER_API_KEY / TAVILY_API_KEY when the
 * caller passes no per-call key.
 */

import {
  asRecord,
  isCopyrightHost,
  safeHost,
  type ImageSearchResult,
  type WebSearchResult,
} from './shared'

export type { ImageSearchResult, WebSearchResult } from './shared'
// Transitional: gsk / genoffice-auth are still exported for the account
// surfaces (ai:gsk-status, cloud slides, cloud projects). The search and media
// paths no longer route through them.
export * from './gsk'
export * from './genoffice-auth'
export * from './media-tools'
export * from './search-tools'

const BOCHA_KEY = () => process.env.BOCHA_API_KEY ?? ''
const SERPER_KEY = () => process.env.SERPER_API_KEY ?? ''
const TAVILY_KEY = () => process.env.TAVILY_API_KEY ?? ''

/**
 * Backend selection for one search. Keys default to the BOCHA_API_KEY /
 * SERPER_API_KEY / TAVILY_API_KEY env vars; settings-driven callers
 * (search-tools.ts) pass the user's key so the chosen backend runs first.
 */
export interface SearchOptions {
  bochaKey?: string
  serperKey?: string
  tavilyKey?: string
  /** self-hosted endpoint (SearXNG & co.); an explicit choice, so it runs before the rest */
  customUrl?: string
  customKey?: string
  /** which hosted backend to try first (default serper) */
  prefer?: 'serper' | 'tavily'
}

/** `boolean` is the legacy "cloud tools on/off" form; it no longer selects a backend */
function normalizeOptions(opts: boolean | SearchOptions | undefined): Required<SearchOptions> {
  const o = typeof opts === 'boolean' ? {} : (opts ?? {})
  return {
    bochaKey: o.bochaKey ?? BOCHA_KEY(),
    serperKey: o.serperKey ?? SERPER_KEY(),
    tavilyKey: o.tavilyKey ?? TAVILY_KEY(),
    customUrl: o.customUrl ?? '',
    customKey: o.customKey ?? '',
    prefer: o.prefer ?? 'serper',
  }
}

type WebSearchResponse = {
  results: WebSearchResult[]
  answer?: string
  method: string
  error?: string
}

/** Bocha (bochaai.com) web search; null when the key is empty, the call fails, or nothing comes back */
async function bochaWebSearch(
  key: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResponse | null> {
  if (!key) return null
  try {
    const resp = await fetchWithTimeout('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, count: Math.min(maxResults, 50), freshness: 'noLimit' }),
    })
    if (!resp.ok) return null
    const data = asRecord(await resp.json())
    const webPages = asRecord(asRecord(data.data).webPages)
    const raw: unknown[] = Array.isArray(webPages.value) ? webPages.value : []
    const results: WebSearchResult[] = raw.slice(0, maxResults).map((item) => {
      const o = asRecord(item)
      return {
        title: String(o.name ?? ''),
        url: String(o.url ?? ''),
        snippet: String(o.snippet ?? o.summary ?? ''),
      }
    })
    if (!results.length) return null
    return { results, method: 'bocha' }
  } catch {
    return null
  }
}

/**
 * Self-hosted search endpoint (SearXNG, or anything answering the same shape).
 * Two response shapes are accepted, both `{ results: [...] }`:
 *   SearXNG — `{ title, url, content }`;  minimal — `{ title, url, snippet }`.
 */
async function customWebSearch(
  url: string,
  key: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResponse | null> {
  if (!url) return null
  try {
    const target = new URL(url)
    target.searchParams.set('q', query)
    // SearXNG only answers JSON when asked; endpoints that do not know the
    // parameter ignore it.
    if (!target.searchParams.has('format')) target.searchParams.set('format', 'json')
    const resp = await fetchWithTimeout(target.toString(), {
      headers: {
        Accept: 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
    })
    if (!resp.ok) return null
    const data = asRecord(await resp.json())
    const raw: unknown[] = Array.isArray(data.results) ? data.results : []
    const results: WebSearchResult[] = raw.slice(0, maxResults).map((item) => {
      const o = asRecord(item)
      return {
        title: String(o.title ?? ''),
        url: String(o.url ?? ''),
        snippet: String(o.snippet ?? o.content ?? ''),
      }
    })
    if (!results.length) return null
    return { results, method: 'custom' }
  } catch {
    return null
  }
}

/** Serper Google web search; null when the key is empty, the call fails, or nothing comes back */
async function serperWebSearch(
  key: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResponse | null> {
  if (!key) return null
  try {
    const resp = await fetchWithTimeout('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: maxResults, gl: 'us', hl: 'en' }),
    })
    if (!resp.ok) return null
    const data = asRecord(await resp.json())
    const organic: unknown[] = Array.isArray(data.organic) ? data.organic : []
    const results: WebSearchResult[] = organic.slice(0, maxResults).map((item) => {
      const o = asRecord(item)
      return {
        title: String(o.title ?? ''),
        url: String(o.link ?? ''),
        snippet: String(o.snippet ?? ''),
      }
    })
    const answerBox = asRecord(data.answerBox)
    const answerRaw =
      answerBox.answer || answerBox.snippet || asRecord(data.knowledgeGraph).description
    const answer = typeof answerRaw === 'string' && answerRaw ? answerRaw : undefined
    if (!results.length) return null
    return answer !== undefined
      ? { results, answer, method: 'serper' }
      : { results, method: 'serper' }
  } catch {
    return null
  }
}

async function tavilyWebSearch(
  key: string,
  query: string,
  maxResults: number,
): Promise<WebSearchResponse | null> {
  if (!key) return null
  try {
    const resp = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: maxResults,
        include_answer: true,
      }),
    })
    if (!resp.ok) return null
    const data = asRecord(await resp.json())
    const raw: unknown[] = Array.isArray(data.results) ? data.results : []
    const results: WebSearchResult[] = raw.slice(0, maxResults).map((item) => {
      const o = asRecord(item)
      return {
        title: String(o.title ?? ''),
        url: String(o.url ?? ''),
        snippet: String(o.content ?? ''),
      }
    })
    const answerRaw = data.answer
    const answer = typeof answerRaw === 'string' && answerRaw ? answerRaw : undefined
    if (!results.length) return null
    return answer !== undefined
      ? { results, answer, method: 'tavily' }
      : { results, method: 'tavily' }
  } catch {
    return null
  }
}

// ── Web search ──────────────────────────────────────────────────────

export async function webSearch(
  query: string,
  maxResults = 6,
  options: boolean | SearchOptions = true,
): Promise<WebSearchResponse> {
  const o = normalizeOptions(options)
  const keyed = [
    // A custom endpoint is an explicit user choice, so it runs before the hosted APIs.
    () => customWebSearch(o.customUrl, o.customKey, query, maxResults),
    ...(o.prefer === 'tavily'
      ? [
          () => tavilyWebSearch(o.tavilyKey, query, maxResults),
          () => bochaWebSearch(o.bochaKey, query, maxResults),
          () => serperWebSearch(o.serperKey, query, maxResults),
        ]
      : [
          () => bochaWebSearch(o.bochaKey, query, maxResults),
          () => serperWebSearch(o.serperKey, query, maxResults),
          () => tavilyWebSearch(o.tavilyKey, query, maxResults),
        ]),
  ]
  for (const attempt of keyed) {
    const r = await attempt()
    if (r) return r
  }
  try {
    return { results: await duckWebSearch(query, maxResults), method: 'duckduckgo' }
  } catch (err) {
    // an unreachable backend must not read as an empty result set
    return { results: [], method: 'error', error: `duckduckgo: ${String(err)}` }
  }
}

// ── Image search ────────────────────────────────────────────────────

export async function imageSearch(
  query: string,
  maxResults = 8,
  options: boolean | SearchOptions = true,
): Promise<{
  images: ImageSearchResult[]
  method: string
  error?: string
}> {
  const o = normalizeOptions(options)
  // Tavily has no image endpoint; Serper is the only keyed image backend
  const key = o.serperKey
  if (key) {
    try {
      const resp = await fetchWithTimeout('https://google.serper.dev/images', {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: Math.min(maxResults, 10), gl: 'us', hl: 'en' }),
      })
      if (resp.ok) {
        const data = asRecord(await resp.json())
        const raw: unknown[] = Array.isArray(data.images) ? data.images : []
        const images: ImageSearchResult[] = []
        for (const item of raw) {
          const img = asRecord(item)
          const imageUrl = String(img.imageUrl ?? img.original ?? '')
          if (!imageUrl) continue
          if (isCopyrightHost(imageUrl)) continue
          const entry: ImageSearchResult = {
            title: String(img.title ?? ''),
            imageUrl,
            sourceUrl: String(img.link ?? ''),
            source: String(img.source ?? safeHost(img.link)),
          }
          if (typeof img.imageWidth === 'number') entry.width = img.imageWidth
          if (typeof img.imageHeight === 'number') entry.height = img.imageHeight
          images.push(entry)
          if (images.length >= maxResults) break
        }
        if (images.length) return { images, method: 'serper' }
      }
    } catch {
      /* fall back to DuckDuckGo */
    }
  }
  try {
    return { images: await duckImageSearch(query, maxResults), method: 'duckduckgo' }
  } catch (err) {
    // an unreachable backend must not read as an empty gallery
    return { images: [], method: 'error', error: `duckduckgo: ${String(err)}` }
  }
}

// ── DuckDuckGo fallback (no key / quota exhausted) ──────────────────
// These throw on network/HTTP failure so the caller can distinguish
// "backend unreachable" from a genuinely empty result set.

// short timeout: an unreachable backend should fail fast so the next one gets its turn
const FALLBACK_TIMEOUT_MS = 5000

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

async function duckWebSearch(query: string, maxResults: number): Promise<WebSearchResult[]> {
  // DuckDuckGo HTML endpoint (lightweight, no key needed)
  const resp = await fetchWithTimeout(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: BROWSER_HEADERS, timeoutMs: FALLBACK_TIMEOUT_MS },
  )
  if (!resp.ok) throw new Error(`http ${resp.status}`)
  const html = await resp.text()
  const results: WebSearchResult[] = []
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && results.length < maxResults) {
    const url = decodeDuckUrl(m[1]!)
    const title = stripTags(m[2]!)
    if (url && title) results.push({ title, url, snippet: '' })
  }
  return results
}

async function duckImageSearch(query: string, maxResults: number): Promise<ImageSearchResult[]> {
  // DuckDuckGo i.js needs a vqd token, so it takes two steps
  const tokenResp = await fetchWithTimeout(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    { headers: BROWSER_HEADERS, timeoutMs: FALLBACK_TIMEOUT_MS },
  )
  if (!tokenResp.ok) throw new Error(`http ${tokenResp.status}`)
  const tokenHtml = await tokenResp.text()
  const vqd = /vqd=["']?([\d-]+)["']?/.exec(tokenHtml)?.[1]
  if (!vqd) throw new Error('no vqd token')
  const resp = await fetchWithTimeout(
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}`,
    {
      headers: { ...BROWSER_HEADERS, Referer: 'https://duckduckgo.com/' },
      timeoutMs: FALLBACK_TIMEOUT_MS,
    },
  )
  if (!resp.ok) throw new Error(`http ${resp.status}`)
  const data = asRecord(await resp.json())
  const list: unknown[] = Array.isArray(data.results) ? data.results : []
  const out: ImageSearchResult[] = []
  for (const item of list.slice(0, maxResults)) {
    const img = asRecord(item)
    const imageUrl = String(img.image ?? '')
    if (!imageUrl || isCopyrightHost(imageUrl)) continue
    const entry: ImageSearchResult = {
      title: String(img.title ?? ''),
      imageUrl,
      sourceUrl: String(img.url ?? ''),
      source: safeHost(img.url),
    }
    if (typeof img.width === 'number') entry.width = img.width
    if (typeof img.height === 'number') entry.height = img.height
    out.push(entry)
  }
  return out
}

// ── utils ───────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function decodeDuckUrl(href: string): string {
  // DuckDuckGo result links are often /l/?uddg=<encoded>
  const m = /[?&]uddg=([^&]+)/.exec(href)
  if (m) return decodeURIComponent(m[1]!)
  return href.startsWith('http') ? href : ''
}
