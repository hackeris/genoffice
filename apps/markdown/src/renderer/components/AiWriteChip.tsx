import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { Editor } from '@tiptap/core'
import { AiGeneratedChip } from '@genoffice/ui'
import { clearAiWriteRange, lastAiWriteRange } from '../editor/aiHighlight'

/**
 * Floating "AI-generated" label anchored beside the most recent AI-written
 * range, read out of the aiHighlight plugin. ✕ only drops the label — the
 * document model is never touched. Re-anchors on the next AI write, hides
 * when edits collapse the range away (undo).
 */
export function AiWriteChip({
  editor,
  label,
}: {
  readonly editor: Editor
  readonly label: string
}): ReactElement | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let frame = 0
    // rAF-deferred: coordsAtPos forces layout, so coalesce bursts of
    // transactions (streaming writes, typing) into one measurement per frame
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const range = lastAiWriteRange(editor.state)
        if (!range) {
          setPos(null)
          return
        }
        const doc = editor.state.doc
        const max = doc.content.size
        const from = Math.max(0, Math.min(range.from, max))
        const to = Math.min(range.to, max)
        // Whole-block writes end at a block boundary: anchor to the last real
        // text inside the range so the label hugs the words, not the margin
        let tail = -1
        doc.nodesBetween(from, to, (node, nodePos) => {
          if (node.isText && node.text?.trim()) {
            tail = Math.max(tail, Math.min(nodePos + node.nodeSize, max))
          }
        })
        const coords = editor.view.coordsAtPos(tail >= 0 ? tail : to)
        if (!coords) {
          setPos(null)
          return
        }
        setPos({
          left: Math.min(Math.max(8, coords.left), window.innerWidth - 8),
          top: coords.bottom + 6,
        })
      })
    }
    measure()
    editor.on('transaction', measure)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      editor.off('transaction', measure)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(frame)
    }
  }, [editor])

  if (!pos) return null
  return (
    <AiGeneratedChip
      label={label}
      onClose={() => clearAiWriteRange(editor)}
      left={pos.left}
      top={pos.top}
    />
  )
}
