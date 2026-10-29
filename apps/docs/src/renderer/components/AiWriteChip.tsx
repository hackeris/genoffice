/**
 * Floating "AI-generated" label anchored beside the most recent AI write
 * (recorded by ai/last-write.ts). Same presentation contract as the paste
 * chip: mounted at the app root with fixed positioning, follows scrolling,
 * and ✕ only drops the label — the document model is never touched, so
 * nothing can leak into a saved file. Re-anchors on the next AI write and
 * hides when edits (an undo) map the written range away.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { AiGeneratedChip } from '@genoffice/ui'
import { clearLastAiWrite, lastAiWrite } from '../ai/last-write'

const GAP = 6
const EDGE = 8

export function AiWriteChip({
  editor,
  label,
}: {
  editor: Editor
  label: string
}): ReactElement | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const anchorRef = useRef<{ from: number; to: number } | null>(null)
  const consumedRef = useRef(0)

  useEffect(() => {
    // a new editor is a new document: never carry an anchor across
    clearLastAiWrite()
    let frame = 0
    // rAF-deferred: coordsAtPos forces layout, so coalesce bursts of
    // transactions (streaming writes, typing) into one measurement per frame
    const reposition = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const anchor = anchorRef.current
        if (!anchor) {
          setPos(null)
          return
        }
        try {
          const doc = editor.state.doc
          const max = doc.content.size
          const from = Math.max(0, Math.min(anchor.from, max))
          const to = Math.min(anchor.to, max)
          // Whole-block writes end at a block boundary: anchoring there puts
          // the label at the text column's right margin, detached from the
          // words. Anchor to the last real text inside the range instead.
          let tail = -1
          doc.nodesBetween(from, to, (node, nodePos) => {
            if (node.isText && node.text?.trim()) {
              tail = Math.max(tail, Math.min(nodePos + node.nodeSize, max))
            }
          })
          const coords = editor.view.coordsAtPos(tail >= 0 ? tail : to)
          const left = Math.min(Math.max(EDGE, coords.right + GAP), window.innerWidth - EDGE - 32)
          const top = Math.min(Math.max(EDGE, coords.bottom + GAP), window.innerHeight - EDGE - 32)
          setPos({ left, top })
        } catch {
          setPos(null)
        }
      })
    }
    const onTransaction = ({ transaction: tr }: { transaction: Transaction }) => {
      let changed = false
      const prev = anchorRef.current
      if (prev && tr.docChanged) {
        const size = tr.doc.content.size
        const from = Math.min(tr.mapping.map(prev.from, 1), size)
        const to = Math.max(from, Math.min(tr.mapping.map(prev.to, -1), size))
        anchorRef.current = to > from ? { from, to } : null
        changed = true
      }
      const fresh = lastAiWrite()
      if (fresh && fresh.at !== consumedRef.current) {
        consumedRef.current = fresh.at
        anchorRef.current = { from: fresh.from, to: fresh.to }
        changed = true
      }
      if (changed) reposition()
    }
    editor.on('transaction', onTransaction)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      editor.off('transaction', onTransaction)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      cancelAnimationFrame(frame)
      clearLastAiWrite()
    }
  }, [editor])

  if (!pos) return null
  return (
    <AiGeneratedChip
      label={label}
      onClose={() => {
        clearLastAiWrite()
        anchorRef.current = null
        setPos(null)
      }}
      left={pos.left}
      top={pos.top}
    />
  )
}
