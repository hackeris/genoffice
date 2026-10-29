import React from 'react'
import type { Lang } from '@genoffice/i18n'
import { AI_GENERATED_LABELS } from './strings-ai-generated'
import './ai-generated.css'

/** Compliance label on assistant replies. Plain marking, never a control and
 * never dismissible — the reply itself is the AI-generated content. */
export function AiGeneratedBadge({ lang }: { readonly lang: Lang }): React.JSX.Element {
  return (
    <span className="ai-generated-badge" dir="auto">
      {AI_GENERATED_LABELS[lang]}
    </span>
  )
}
