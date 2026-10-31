import { afterEach, describe, expect, it } from 'vitest'
import type { ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'
import {
  clearLastAiWrite,
  lastAiWrite,
  planWriteRanges,
  recordAiWrite,
} from '../src/renderer/ai-write-anchor'

function plan(over: Partial<ChangePlan>): ChangePlan {
  return {
    transactionId: 't',
    baseRevision: 0,
    cellChanges: [],
    sheetRenames: [],
    structuralChanges: [],
    formatChanges: [],
    warnings: [],
    ...over,
  }
}

afterEach(() => {
  clearLastAiWrite()
})

describe('planWriteRanges', () => {
  it('maps cellChanges to single-cell ranges (0-based)', () => {
    const ranges = planWriteRanges(
      plan({
        cellChanges: [
          { sheetId: 's1', address: 'B2', before: {}, after: {} },
        ] as unknown as ChangePlan['cellChanges'],
      }),
    )
    expect(ranges.get('s1')).toEqual([{ startRow: 1, startColumn: 1, endRow: 1, endColumn: 1 }])
  })

  it('maps formatChanges and structural range ops', () => {
    const ranges = planWriteRanges(
      plan({
        formatChanges: [
          { sheetId: 's1', range: 'A1:B2', format: {}, label: 'fmt' },
        ] as ChangePlan['formatChanges'],
        structuralChanges: [
          {
            op: { op: 'clear_range', sheetId: 's2', range: 'C3:D4' },
            label: 'clear',
          },
        ] as ChangePlan['structuralChanges'],
      }),
    )
    expect(ranges.get('s1')).toEqual([
      { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 },
    ])
    expect(ranges.get('s2')).toEqual([
      { startRow: 2, startColumn: 2, endRow: 3, endColumn: 3 },
    ])
  })

  it('maps row/column structural ops to full bands (1-based input)', () => {
    const ranges = planWriteRanges(
      plan({
        structuralChanges: [
          { op: { op: 'insert_rows', sheetId: 's1', row: 5, count: 2 }, label: 'rows' },
          { op: { op: 'insert_cols', sheetId: 's1', column: 'B', count: 1 }, label: 'cols' },
        ] as ChangePlan['structuralChanges'],
      }),
    )
    expect(ranges.get('s1')).toEqual([
      { startRow: 4, startColumn: 0, endRow: 5, endColumn: 16383 },
      { startRow: 0, startColumn: 1, endRow: 1048575, endColumn: 1 },
    ])
  })

  it('maps add_image to its anchor cell', () => {
    const ranges = planWriteRanges(
      plan({
        structuralChanges: [
          {
            op: { op: 'add_image', sheetId: 's1', path: 'gen.png', anchorCell: 'C3' },
            label: 'image',
          },
        ] as ChangePlan['structuralChanges'],
      }),
    )
    expect(ranges.get('s1')).toEqual([
      { startRow: 2, startColumn: 2, endRow: 2, endColumn: 2 },
    ])
  })

  it('collapses a sheet above 200 primitive ranges to its bounding box', () => {
    const cellChanges = Array.from({ length: 201 }, (_, i) => ({
      sheetId: 's1',
      address: `A${i + 1}`,
      before: {},
      after: {},
    }))
    const ranges = planWriteRanges(
      plan({ cellChanges: cellChanges as unknown as ChangePlan['cellChanges'] }),
    )
    expect(ranges.get('s1')).toEqual([
      { startRow: 0, startColumn: 0, endRow: 200, endColumn: 0 },
    ])
  })

  it('skips web-image add_image (AI-inserted, not AI-generated)', () => {
    const ranges = planWriteRanges(
      plan({
        structuralChanges: [
          {
            op: { op: 'add_image', sheetId: 's1', path: 'https://example.com/pic.jpg', anchorCell: 'B2' },
            label: 'web',
          },
          {
            op: { op: 'add_image', sheetId: 's1', path: '/data/gen.png', anchorCell: 'D4' },
            label: 'gen',
          },
        ] as ChangePlan['structuralChanges'],
      }),
    )
    expect(ranges.get('s1')).toEqual([{ startRow: 3, startColumn: 3, endRow: 3, endColumn: 3 }])
  })

  it('skips malformed addresses instead of throwing', () => {
    const ranges = planWriteRanges(
      plan({
        cellChanges: [
          { sheetId: 's1', address: 'not-an-address', before: {}, after: {} },
          { sheetId: 's1', address: 'A1', before: {}, after: {} },
        ] as unknown as ChangePlan['cellChanges'],
      }),
    )
    expect(ranges.get('s1')).toEqual([{ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 }])
  })

  it('record/take/clear round-trip', () => {
    expect(lastAiWrite()).toBeNull()
    recordAiWrite(new Map([['s1', [{ startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 }]]]))
    expect(lastAiWrite()?.sheetRanges.get('s1')).toHaveLength(1)
    clearLastAiWrite()
    expect(lastAiWrite()).toBeNull()
  })
})
