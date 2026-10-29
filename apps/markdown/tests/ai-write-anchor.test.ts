import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../src/renderer/editor/extensions'
import { runOps, uiOp } from '../src/renderer/editor/ops'
import {
  clearAiHighlights,
  clearAiWriteRange,
  lastAiWriteRange,
} from '../src/renderer/editor/aiHighlight'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

function createEditor(md = ''): Editor {
  const editor = new Editor({
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
      slashItems: () => [],
    }),
    content: '',
  })
  if (md) editor.commands.setContent(md, { contentType: 'markdown' })
  editors.push(editor)
  return editor
}

const ai = (editor: Editor, ...ops: Parameters<typeof runOps>[1]) =>
  runOps(editor, ops, { source: 'ai' })

describe('lastAiWriteRange', () => {
  it('covers the range an AI op wrote', () => {
    const editor = createEditor('# T\n\nkeep\n')
    const run = ai(editor, { op: 'insertContent', after: 'end', markdown: 'written' })
    expect(run.results[0]?.ok).toBe(true)
    const range = lastAiWriteRange(editor.state)
    expect(range).not.toBeNull()
    expect(editor.state.doc.textBetween(range!.from, range!.to, '\n')).toContain('written')
  })

  it('follows later edits without absorbing boundary-typed characters', () => {
    const editor = createEditor('# T\n\nkeep\n')
    ai(editor, { op: 'insertContent', after: 'end', markdown: 'written' })
    const before = lastAiWriteRange(editor.state)!
    const typed = editor.state.tr.insertText('tail', before.to)
    editor.view.dispatch(typed)
    const after = lastAiWriteRange(editor.state)!
    expect(editor.state.doc.textBetween(after.from, after.to, '\n')).toContain('written')
    expect(editor.state.doc.textBetween(after.from, after.to, '\n')).not.toContain('tail')
  })

  it('collapses to null when the written content is deleted away', () => {
    const editor = createEditor('# T\n')
    ai(editor, { op: 'insertContent', after: 'end', markdown: 'written' })
    const range = lastAiWriteRange(editor.state)!
    editor.view.dispatch(editor.state.tr.delete(range.from, range.to))
    expect(lastAiWriteRange(editor.state)).toBeNull()
  })

  it('aiHighlightClear keeps the anchor; aiWriteClear drops it', () => {
    const editor = createEditor('# T\n')
    ai(editor, { op: 'insertContent', after: 'end', markdown: 'written' })
    clearAiHighlights(editor)
    expect(lastAiWriteRange(editor.state)).not.toBeNull()
    clearAiWriteRange(editor)
    expect(lastAiWriteRange(editor.state)).toBeNull()
  })

  it('a user-sourced write never sets the anchor', () => {
    const editor = createEditor('# T\n')
    uiOp(editor, { op: 'insertContent', after: 'end', markdown: 'typed' })
    expect(lastAiWriteRange(editor.state)).toBeNull()
  })
})
