/**
 * The page an AI write addressed, as a 0-based original index — the anchor
 * for the floating "AI-generated" chip. Most mutating tools carry a 1-based
 * `page` (resolved through resolvePage); apply_ops ops address pages via
 * `page`/`pageIndex`. Whole-document rewrites (split/merge/crop/watermark)
 * have no single page and yield null — no chip for those.
 */
export function pdfWritePageOf(call: {
  name: string
  input: Record<string, unknown>
}): number | null {
  const page = Number(call.input?.page)
  if (Number.isInteger(page) && page >= 1) return page - 1
  const ops = Array.isArray(call.input?.ops) ? (call.input.ops as unknown[]) : null
  if (ops) {
    for (const item of ops) {
      const op = item as Record<string, unknown> | null
      if (!op) continue
      const addressed = Number(op.page ?? op.pageIndex)
      if (Number.isInteger(addressed) && addressed >= 1) return addressed - 1
    }
  }
  return null
}
