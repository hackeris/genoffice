import React from 'react'
import './ai-generated.css'

/**
 * Floating provenance chip anchored beside an AI-written document range.
 * Purely presentational: the caller computes the fixed coordinates and owns
 * the anchor lifecycle (re-anchor on the next write, gone when the document
 * closes); the chip never touches the document model, so nothing it shows or
 * hides can end up in a saved file.
 */
export function AiGeneratedChip({
  label,
  onClose,
  left,
  top,
}: {
  readonly label: string
  readonly onClose: () => void
  readonly left: number
  readonly top: number
}): React.JSX.Element {
  return (
    <div className="ai-generated-chip" style={{ left, top }} title={label} data-testid="ai-generated-chip">
      <span dir="auto">{label}</span>
      <button type="button" className="ai-generated-chip-close" aria-label="✕" onClick={onClose}>
        ✕
      </button>
    </div>
  )
}
