/**
 * Floating "AI-generated" label anchored beside the most recent AI write
 * (recorded by ai-write-anchor.ts). On the source/split faces it anchors at
 * the end of the topmost written range via the CodeMirror handle; on the
 * preview face the sandboxed iframe exposes no coordinates, so it parks at
 * the frame container's corner (a weak "the AI content is in the preview"
 * anchor). ✕ only drops the label — the document text is never touched.
 * Offsets are not remapped through later edits (v1): they are clamped against
 * the live document at measure time and the label hides once out of bounds.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { AiGeneratedChip } from '@genoffice/ui'
import { lastAiWrite, normalizeRanges } from '../ai-write-anchor'

interface Props {
  label: string
  /** bumped by App whenever the AI writes — the re-measure trigger */
  tick: number
  /** true while the source face is visible (view !== 'preview') */
  sourceVisible: boolean
  /** CodeMirror handle lookup; null before the editor mounts */
  coordsAt: ((
    offset: number,
  ) => { left: number; right: number; top: number; bottom: number } | null) | null
  /** live source-text length for clamping / out-of-bounds hiding */
  getTextLength: () => number
  onClose: () => void
}

const GAP = 6
const EDGE = 8

export function AiWriteChip({
  label,
  tick,
  sourceVisible,
  coordsAt,
  getTextLength,
  onClose,
}: Props): ReactElement | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const record = lastAiWrite()
      if (!record) {
        setPos(null)
        return
      }
      const ranges = normalizeRanges(record.ranges, getTextLength())
      if (!ranges) {
        setPos(null)
        return
      }
      if (sourceVisible && coordsAt) {
        const coords = coordsAt(ranges[0]![1])
        if (coords) {
          setPos({
            left: Math.min(Math.max(EDGE, coords.right + GAP), window.innerWidth - EDGE - 32),
            top: Math.min(Math.max(EDGE, coords.bottom + GAP), window.innerHeight - EDGE - 32),
          })
          return
        }
      }
      // preview face (or no coordinate on the source face): park at the frame
      // container's corner
      const frame = document.querySelector('.preview-frame')?.getBoundingClientRect()
      if (frame && frame.width > 0) {
        setPos({
          left: Math.max(EDGE, Math.min(frame.left + GAP, window.innerWidth - EDGE - 32)),
          top: Math.max(EDGE, Math.min(frame.top + GAP, window.innerHeight - EDGE - 32)),
        })
        return
      }
      setPos(null)
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [tick, sourceVisible, coordsAt, getTextLength])

  if (!pos) return null
  return <AiGeneratedChip label={label} onClose={onClose} left={pos.left} top={pos.top} />
}
