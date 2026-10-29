/**
 * Floating "AI-generated" label for the page AI tools last wrote. Anchored to
 * the page element via the same `.pdf-page[data-page]` lookup the view uses;
 * pending text-insert previews inside that page refine the anchor (their
 * union box). Pages outside the rendered viewport hide the label. ✕ only
 * drops the label — the PDF model is never touched.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { AiGeneratedChip } from '@genoffice/ui'

interface Props {
  label: string
  /** 0-based original page index; null hides the chip */
  page: number | null
  onClose: () => void
}

const EDGE = 8
const GAP = 6

export function AiWrittenChip({ label, page, onClose }: Props): ReactElement | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    const update = () => {
      if (page === null) {
        setPos(null)
        return
      }
      const pageEl = document.querySelector(`.pdf-page[data-page="${page}"]`)
      if (!pageEl) {
        setPos(null)
        return
      }
      let box: {
        left: number
        top: number
        right: number
        bottom: number
        width: number
        height: number
      } = pageEl.getBoundingClientRect()
      // pending inserts are the visible form of the AI write: widen the
      // anchor to them when they are on this page
      for (const preview of pageEl.querySelectorAll<HTMLElement>('.pdf-textinsert-preview')) {
        const r = preview.getBoundingClientRect()
        const left = Math.min(box.left, r.left)
        const top = Math.min(box.top, r.top)
        const right = Math.max(box.right, r.right)
        const bottom = Math.max(box.bottom, r.bottom)
        box = { left, top, right, bottom, width: right - left, height: bottom - top }
      }
      if (box.width <= 0 || box.bottom < 0 || box.top > window.innerHeight) {
        setPos(null)
        return
      }
      setPos({
        left: Math.max(EDGE, Math.min(box.left + GAP, window.innerWidth - EDGE - 32)),
        top: Math.max(EDGE, Math.min(box.top + GAP, window.innerHeight - EDGE - 32)),
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [page])

  if (!pos) return null
  return <AiGeneratedChip label={label} onClose={onClose} left={pos.left} top={pos.top} />
}
