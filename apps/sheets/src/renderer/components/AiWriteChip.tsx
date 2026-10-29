/**
 * Floating "AI-generated" label anchored to the viewport box of the most
 * recent AI write. Owns its grid event subscriptions (scroll/zoom/sheet
 * switch) so following the canvas never re-renders the app; ✕ also erases
 * the canvas outline. The workbook model is never touched.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { AiGeneratedChip } from '@genoffice/ui'
import type { UniverRuntime } from '../univer-state'
import { aiWriteViewportRect, clearAiWriteOutline } from '../ai-write-outline'

const EDGE = 8
const GAP = 6

export function AiWriteChip({
  runtime,
  label,
  tick,
  onClose,
}: {
  runtime: UniverRuntime | null
  label: string
  /** bumped by App when the AI writes or the anchor clears */
  tick: number
  onClose: () => void
}): ReactElement | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!runtime) {
      setPos(null)
      return
    }
    const measure = () => {
      const box = aiWriteViewportRect(runtime)
      if (!box) {
        setPos(null)
        return
      }
      setPos({
        left: Math.max(EDGE, Math.min(box.left + GAP, window.innerWidth - EDGE - 32)),
        top: Math.max(EDGE, Math.min(box.top + GAP, window.innerHeight - EDGE - 32)),
      })
    }
    measure()
    const disposables = [
      runtime.univerAPI.addEvent(runtime.univerAPI.Event.Scroll, measure),
      runtime.univerAPI.addEvent(runtime.univerAPI.Event.SheetZoomChanged, measure),
      runtime.univerAPI.addEvent(runtime.univerAPI.Event.ActiveSheetChanged, measure),
    ]
    window.addEventListener('resize', measure)
    return () => {
      for (const disposable of disposables) disposable.dispose()
      window.removeEventListener('resize', measure)
    }
  }, [runtime, tick])

  if (!pos) return null
  return (
    <AiGeneratedChip
      label={label}
      onClose={() => {
        if (runtime) clearAiWriteOutline(runtime)
        // hide immediately: the next measure only runs on scroll/zoom/sheet
        // switch, so a closed chip would otherwise linger until then
        setPos(null)
        onClose()
      }}
      left={pos.left}
      top={pos.top}
    />
  )
}
