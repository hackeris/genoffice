import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

const shellSrc = read('src/renderer/ExcelShell.tsx')
const css = read('src/renderer/styles.css')

/**
 * Gated-off AI build (see ai-gate): the panel is not mounted, so the sheet
 * body's two-column grid has only one child and the sheet lands in the AI
 * panel's slot. The shell therefore has to drop to the single-column
 * `copilot-off` state whenever AI_DISABLED, or the workbook renders 34px wide.
 * jsdom applies no stylesheet, so this pins the source-level contract the
 * device check confirmed (sheet-body columns 33.99px 1328px before the fix).
 */
describe('sheets layout with the AI panel gated off', () => {
  it('forces the single-column shell class when AI is disabled', () => {
    expect(shellSrc).toMatch(/AI_DISABLED\s*\?\s*'copilot-off'/)
  })

  it('copilot-off gives the sheet the whole row', () => {
    expect(css).toMatch(
      /\.app-shell\.copilot-off \.sheet-body \{[^}]*grid-template-columns: minmax\(0, 1fr\);/s,
    )
  })
})
