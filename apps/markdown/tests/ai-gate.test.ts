import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { AI_DISABLED } from '@genoffice/electron-utils/ai-gate'

// The assistant is unrelated to the surfaces under test.
vi.mock('../src/renderer/ai/AiPanel', () => ({ GensparkMark: () => null }))

// No ai-gate mock here on purpose: this is the one suite that exercises the
// shipped gate value. When AI_DISABLED is true (store-review build) no AI
// entry may render in the ribbon, so a future AI button added outside a gate
// wrapper fails here instead of shipping. Flip the constant in ai-gate.ts and
// this suite's first assertion tells you why the ribbon changed.
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

function renderRibbon() {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '<p>body</p>',
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(Ribbon, {
        editor,
        disabled: false,
        dirty: false,
        onSave: vi.fn(),
        onSaveAs: vi.fn(),
        onFind: vi.fn(),
        autoSave: false,
        onToggleAutoSave: vi.fn(),
        imageEnabled: true,
        onInsertImage: vi.fn(),
        frontmatterOpen: false,
        onToggleFrontmatter: vi.fn(),
        outlineOpen: false,
        onToggleOutline: vi.fn(),
        hasOutline: false,
        spellcheck: true,
        onToggleSpellcheck: vi.fn(),
        aiOpen: false,
        onToggleAi: vi.fn(),
        onAiPreset: vi.fn(),
        sourceMode: false,
        sourceViewOpen: false,
        onToggleSource: vi.fn(),
      }),
    )
  })
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
    editor.destroy()
  })
  return container
}

describe('ai gate', () => {
  it('ships gated on, and the ribbon renders no AI entries', () => {
    expect(AI_DISABLED).toBe(true)
    const container = renderRibbon()
    expect(container.querySelectorAll('.ai-entry').length).toBe(0)
    const aiButtons = [...container.querySelectorAll('button')].filter(
      (b) => (b.textContent ?? '').trim() === 'AI',
    )
    expect(aiButtons.length).toBe(0)
  })
})
