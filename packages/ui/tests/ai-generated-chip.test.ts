/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AiGeneratedBadge } from '../src/AiGeneratedBadge'
import { AiGeneratedChip } from '../src/AiGeneratedChip'
import { AI_GENERATED_LABELS } from '../src/strings-ai-generated'
import { LANGS } from '@genoffice/i18n'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('covers every language with a non-empty label', () => {
  for (const lang of LANGS) {
    expect(AI_GENERATED_LABELS[lang].trim().length).toBeGreaterThan(0)
  }
})

it('badge renders the language wording as plain, control-free marking', () => {
  act(() => root.render(createElement(AiGeneratedBadge, { lang: 'zh' })))
  const badge = host.querySelector('.ai-generated-badge')!
  expect(badge.textContent).toBe('AI生成')
  expect(badge.querySelector('button')).toBeNull()
})

it('chip shows the label and ✕ reports exactly one close per click', async () => {
  const onClose = vi.fn()
  act(() =>
    root.render(
      createElement(AiGeneratedChip, { label: 'AI-generated', onClose, left: 12, top: 34 }),
    ),
  )
  const chip = host.querySelector<HTMLElement>('[data-testid="ai-generated-chip"]')!
  expect(chip.textContent).toContain('AI-generated')
  expect(chip.style.left).toBe('12px')
  expect(chip.style.top).toBe('34px')
  const close = chip.querySelector('button')!
  expect(close.getAttribute('aria-label')).toBe('✕')
  await act(async () => close.click())
  expect(onClose).toHaveBeenCalledTimes(1)
})
