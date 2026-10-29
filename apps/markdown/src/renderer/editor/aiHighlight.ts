import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform'
import type { Mappable } from '@tiptap/pm/transform'
import { OP_META, blockIndexRange, blockRange, type OpMeta } from './ops'

type Range = { from: number; to: number }

/** Plugin state: the yellow wash decorations plus the anchor range the
 * floating "AI-generated" chip tracks. `last` deliberately outlives
 * `aiHighlightClear` — the chip must stay up after a run ends; only
 * `aiWriteClear` drops it. */
type AiHighlightState = { decos: DecorationSet; last: Range | null }

const key = new PluginKey<AiHighlightState>('aiHighlight')

/**
 * Ranges (in tr.doc coordinates) an AI op transaction rewrote, read off its
 * step maps. A structural step (heading conversion, wrap) only touches node
 * boundary tokens where an inline decoration paints nothing, so text-less
 * ranges widen to the top-level block(s) they sit in.
 */
function changedRanges(tr: Transaction): Range[] {
  const ranges: Range[] = []
  const push = (from: number, to: number) => {
    if (to <= from) return
    let inline = false
    tr.doc.nodesBetween(from, to, (node) => {
      if (node.isInline) inline = true
      return !inline
    })
    if (inline) return ranges.push({ from, to })
    const { startIndex, endIndex } = blockIndexRange(tr.doc, from, to)
    ranges.push(blockRange(tr.doc, startIndex, endIndex))
  }
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1)
    // mark steps do not move positions, so their step map is empty — use the step's own range
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      push(rest.map(step.from, 1), rest.map(step.to, -1))
      return
    }
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      push(rest.map(newStart, 1), rest.map(newEnd, -1))
    })
  })
  return ranges
}

/** Map a range through later edits; collapses to null when its content is
 * deleted (an undo of the AI write hides the chip with it). Boundary-typed
 * characters are not absorbed: assoc 1/-1 keeps the range at what was
 * actually written. */
function mapRange(range: Range, mapping: Mappable, doc: Node): Range | null {
  const size = doc.content.size
  const from = Math.max(0, Math.min(mapping.map(range.from, 1), size))
  const to = Math.max(from, Math.min(mapping.map(range.to, -1), size))
  return to > from ? { from, to } : null
}

/** Adjacent or overlapping (one position of tolerance for boundary tokens) */
const touches = (a: Range, b: Range) => a.from <= b.to + 1 && b.from <= a.to + 1

const union = (a: Range, b: Range): Range => ({
  from: Math.min(a.from, b.from),
  to: Math.max(a.to, b.to),
})

/** Remove every AI-change highlight (called when a run finishes) */
export function clearAiHighlights(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta('aiHighlightClear', true))
}

/** The most recent AI-written range, mapped forward through later edits —
 * the anchor for the floating "AI-generated" chip. */
export function lastAiWriteRange(state: EditorState): Range | null {
  return key.getState(state)?.last ?? null
}

/** Drop the chip anchor; the yellow-wash decorations are untouched. */
export function clearAiWriteRange(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta('aiWriteClear', true))
}

/**
 * Transient yellow wash over content the AI just wrote (every transaction an
 * AI-sourced runOps dispatches), so the user can see what changed during a
 * run. Display-only: decorations never touch the document or the serialized
 * markdown.
 */
export const AiHighlight = Extension.create({
  name: 'aiHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<AiHighlightState>({
        key,
        state: {
          init: () => ({ decos: DecorationSet.empty, last: null }),
          apply(tr, { decos, last }) {
            let next = decos.map(tr.mapping, tr.doc)
            let lastRange = last ? mapRange(last, tr.mapping, tr.doc) : null
            if (tr.getMeta('aiHighlightClear')) next = DecorationSet.empty
            if (tr.getMeta('aiWriteClear')) lastRange = null
            const meta = tr.getMeta(OP_META) as OpMeta | undefined
            const add =
              meta?.source === 'ai' && !meta.rollback && tr.docChanged ? changedRanges(tr) : []
            for (const range of add) {
              const from = Math.max(0, Math.min(range.from, tr.doc.content.size))
              const to = Math.max(from, Math.min(range.to, tr.doc.content.size))
              if (to <= from) continue
              next = next.add(tr.doc, [Decoration.inline(from, to, { class: 'ai-changed' })])
              // one run landing adjacent chunks reads as one recent write; a
              // separated write re-anchors the chip to the latest range
              const written = { from, to }
              lastRange = lastRange && touches(lastRange, written) ? union(lastRange, written) : written
            }
            return { decos: next, last: lastRange }
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)?.decos ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})
