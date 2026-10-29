import { describe, expect, it } from 'vitest'
import { pdfWritePageOf } from '../src/renderer/ai/write-page'

describe('pdfWritePageOf', () => {
  it('maps the 1-based page of direct tools to a 0-based index', () => {
    expect(pdfWritePageOf({ name: 'edit_text', input: { page: 3 } })).toBe(2)
    expect(pdfWritePageOf({ name: 'insert_text', input: { page: 1 } })).toBe(0)
    expect(pdfWritePageOf({ name: 'markup_text', input: { page: '2' } })).toBe(1)
  })

  it('takes the first page-addressed op of apply_ops', () => {
    expect(
      pdfWritePageOf({ name: 'apply_ops', input: { ops: [{ op: 'deleteNote', page: 4 }] } }),
    ).toBe(3)
    expect(
      pdfWritePageOf({ name: 'apply_ops', input: { ops: [{ op: 'x', pageIndex: 7 }] } }),
    ).toBe(6)
  })

  it('yields null for non-page tools and doc-wide rewrites', () => {
    expect(pdfWritePageOf({ name: 'read_pages', input: { start: 1 } })).toBeNull()
    expect(pdfWritePageOf({ name: 'split_pdf', input: {} })).toBeNull()
    expect(pdfWritePageOf({ name: 'set_watermark', input: { text: 'x' } })).toBeNull()
  })

  it('rejects out-of-range and malformed page values', () => {
    expect(pdfWritePageOf({ name: 'edit_text', input: { page: 0 } })).toBeNull()
    expect(pdfWritePageOf({ name: 'edit_text', input: { page: -2 } })).toBeNull()
    expect(pdfWritePageOf({ name: 'edit_text', input: {} })).toBeNull()
    expect(pdfWritePageOf({ name: 'apply_ops', input: { ops: [{ op: 'x' }] } })).toBeNull()
  })
})
