/**
 * Module-level record of the most recent AI write, in final-doc coordinates
 * of the moment it landed. The AI write paths (ai/protocol.ts, ai/ops.ts
 * executeOps) record here; the floating "AI-generated" chip consumes the
 * anchor and maps it forward through later edits itself. Presentation only —
 * nothing here touches the document, and the anchor dies with the editor.
 */

export type AiWriteRange = { from: number; to: number }

type Recorded = AiWriteRange & { at: number }

let last: Recorded | null = null

/** Sibling blocks sit two boundary tokens apart, so writes landing in
 * adjacent blocks merge into one recent write; a separated write re-anchors
 * to the latest range instead. */
const touches = (a: AiWriteRange, b: AiWriteRange) => a.from <= b.to + 2 && b.from <= a.to + 2

/** Record the range an AI write landed on. */
export function recordAiWrite(from: number, to: number): void {
  const at = Date.now()
  if (last && touches(last, { from, to })) {
    last = { from: Math.min(last.from, from), to: Math.max(last.to, to), at }
  } else {
    last = { from, to, at }
  }
}

/** The most recent AI write; `at` stamps the recording so the chip can tell a
 * fresh anchor from one it already adopted. */
export function lastAiWrite(): Recorded | null {
  return last
}

/** Drop the anchor (chip closed, revisions accepted, document switched). */
export function clearLastAiWrite(): void {
  last = null
}
