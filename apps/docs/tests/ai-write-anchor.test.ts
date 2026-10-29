import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import {
  BLANK_BULLET_NUM_ID,
  BLANK_ORDERED_NUM_ID,
  buildBlankDocx,
  parseDocx,
} from '@genoffice/docx-engine'
import { blocksToPmDoc } from '../src/renderer/editor/convert'
import { executeTool } from '../src/renderer/ai/tools'
import {
  clearLastAiWrite,
  lastAiWrite,
  recordAiWrite,
} from '../src/renderer/ai/last-write'

const NUM_IDS = { bullet: BLANK_BULLET_NUM_ID, ordered: BLANK_ORDERED_NUM_ID }
const TRACK = { author: 'AI Assistant' }

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
  clearLastAiWrite()
})

async function createEditor(withText = false): Promise<Editor> {
  const { editorExtensions } = await import('../src/renderer/editor/extensions')
  const parsed = await parseDocx(await buildBlankDocx())
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
  })
  editor.commands.setContent(blocksToPmDoc(parsed.blocks) as never)
  if (withText) {
    await executeTool(
      editor,
      { id: 'seed', name: 'insert_content', input: { html: '<p>Original first paragraph.</p>' } },
      NUM_IDS,
    )
  }
  clearLastAiWrite() // seeding is not the write under test
  editors.push(editor)
  return editor
}

describe('the AI-write anchor', () => {
  it('records an untracked AI write at the written range', async () => {
    const editor = await createEditor()
    const exec = await executeTool(
      editor,
      { id: 't', name: 'insert_content', input: { html: '<p>written by AI</p>' } },
      NUM_IDS,
    )
    expect(exec.isError).toBeFalsy()
    const anchor = lastAiWrite()
    expect(anchor).not.toBeNull()
    expect(editor.state.doc.textBetween(anchor!.from, anchor!.to, '\n')).toContain('written by AI')
  })

  it('records a tracked AI write too (the inserted text, not the struck old text)', async () => {
    const editor = await createEditor(true)
    const exec = await executeTool(
      editor,
      {
        id: 't',
        name: 'replace_blocks',
        input: { startBlockIndex: 0, endBlockIndex: 0, html: '<p>Rewritten by AI.</p>' },
      },
      NUM_IDS,
      TRACK,
    )
    expect(exec.isError).toBeFalsy()
    const anchor = lastAiWrite()
    expect(anchor).not.toBeNull()
    const text = editor.state.doc.textBetween(anchor!.from, anchor!.to, '\n')
    expect(text).toContain('Rewritten by AI')
    expect(text).not.toContain('Original first paragraph')
  })

  it('merges adjacent-block writes and re-anchors separated ones', () => {
    recordAiWrite(10, 20)
    recordAiWrite(22, 30)
    expect(lastAiWrite()).toMatchObject({ from: 10, to: 30 })
    recordAiWrite(100, 110)
    expect(lastAiWrite()).toMatchObject({ from: 100, to: 110 })
  })

  it('clearLastAiWrite drops the anchor', () => {
    recordAiWrite(5, 8)
    clearLastAiWrite()
    expect(lastAiWrite()).toBeNull()
  })
})
