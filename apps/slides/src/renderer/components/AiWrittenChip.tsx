/**
 * Floating "AI-generated" label for pages AI tools wrote. Mounted at the app
 * root, never inside `.stage-scale` — that subtree carries
 * `transform: scale(zoom)`, which would scale the label with the canvas (same
 * reason as AiAskPopover). App supplies the anchor (the written page's
 * visible box, null when the current page was not AI-written) and it is
 * re-measured on scroll/zoom/page changes. ✕ only drops the label; the deck
 * model is never touched.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { AiGeneratedChip } from '@genoffice/ui'
import type { AnchorRect } from './AiAskPopover'

interface Props {
  label: string
  /** Re-measured on scroll/zoom/page change; null hides the chip */
  getAnchorRect: () => AnchorRect | null
  onClose: () => void
}

const EDGE = 8

export function AiWrittenChip({ label, getAnchorRect, onClose }: Props): ReactElement | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    // park the label just inside the page's top-left corner: no width
    // measurement needed, safe in every locale (long RTL labels included)
    const update = () => {
      const rect = getAnchorRect()
      if (!rect) {
        setPos(null)
        return
      }
      setPos({
        left: Math.max(EDGE, Math.min(rect.left + 6, window.innerWidth - EDGE - 32)),
        top: Math.max(EDGE, Math.min(rect.top + 6, window.innerHeight - EDGE - 32)),
      })
    }
    update()
    const scroller = document.querySelector('.stage-wrap')
    scroller?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      scroller?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [getAnchorRect])

  if (!pos) return null
  return <AiGeneratedChip label={label} onClose={onClose} left={pos.left} top={pos.top} />
}
