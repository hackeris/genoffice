/**
 * Module-level record of the most recent AI write, in source-text
 * coordinates. The AI access wrappers in App record; the floating
 * "AI-generated" chip consumes, merges and clamps against the live document.
 * Presentation only — never part of the document text.
 */

export type AiWriteRanges = { ranges: Array<[number, number]>; at: number }

let last: AiWriteRanges | null = null

/** Record the ranges an AI write just produced (unclamped source offsets). */
export function recordAiWrite(ranges: Array<[number, number]>): void {
  if (ranges.length === 0) return
  last = { ranges, at: Date.now() }
}

/** The most recent AI write; `at` stamps the recording so the chip can tell a
 * fresh anchor from one it already showed. */
export function lastAiWrite(): AiWriteRanges | null {
  return last
}

/** Drop the anchor (chip closed, AI run rolled back, document switched). */
export function clearLastAiWrite(): void {
  last = null
}

/** Clamp into [0, size], drop empties, merge overlapping/adjacent ranges;
 * null when nothing survives (the write was edited away). */
export function normalizeRanges(
  ranges: Array<[number, number]>,
  size: number,
): Array<[number, number]> | null {
  const sorted = ranges
    .map(
      ([from, to]) =>
        [Math.max(0, Math.min(from, size)), Math.max(0, Math.min(to, size))] as [number, number],
    )
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const range of sorted) {
    const prev = out[out.length - 1]
    if (prev && range[0] <= prev[1] + 1) prev[1] = Math.max(prev[1], range[1])
    else out.push([range[0], range[1]])
  }
  return out.length > 0 ? out : null
}
