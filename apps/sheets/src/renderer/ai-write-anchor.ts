/**
 * Module-level record of the most recent AI write, as per-sheet cell ranges
 * (0-based, Univer's IRange convention). Recorded when an AI plan applies;
 * the canvas outline and the floating chip consume it. Presentation only —
 * nothing here touches the workbook.
 */
import { parseAddress, parseRange } from '@genoffice/xlsx-gateway/domain/cell-address'
import type { ChangePlan } from '@genoffice/xlsx-gateway/domain/workbook.types'

export interface WriteRange {
  readonly startRow: number
  readonly startColumn: number
  readonly endRow: number
  readonly endColumn: number
}

export interface AiWriteRecord {
  readonly sheetRanges: ReadonlyMap<string, readonly WriteRange[]>
  readonly at: number
}

let last: AiWriteRecord | null = null

/** One op's written spans (defensive: malformed range strings are skipped).
 * Sources are read, not written, so only target spans count. */
function opRanges(op: Record<string, unknown>): WriteRange[] {
  const out: WriteRange[] = []
  const add = (range: WriteRange): void => {
    if (
      [range.startRow, range.startColumn, range.endRow, range.endColumn].every(Number.isInteger) &&
      range.startRow >= 0 &&
      range.startColumn >= 0 &&
      range.endRow >= range.startRow &&
      range.endColumn >= range.startColumn
    ) {
      out.push(range)
    }
  }
  const addRange = (value: unknown): void => {
    if (typeof value !== 'string') return
    try {
      add(parseRange(value))
    } catch {
      // malformed range string: skip
    }
  }
  const addAddress = (value: unknown): void => {
    if (typeof value !== 'string') return
    try {
      const a = parseAddress(value)
      add({ startRow: a.row, startColumn: a.column, endRow: a.row, endColumn: a.column })
    } catch {
      // malformed address: skip
    }
  }
  addRange(op.range)
  addRange(op.target)
  addAddress(op.start)
  // add_image writes at its anchor cell (single cell provenance)
  addAddress(op.anchorCell)
  // structural row/column spans: insert_rows {row, count} touches rows
  // (1-based, converted to 0-based below); full band across the other axis
  const row = Number(op.row)
  const rowCount = Number(op.count)
  if (Number.isInteger(row) && row >= 1 && Number.isInteger(rowCount) && rowCount >= 1) {
    add({ startRow: row - 1, startColumn: 0, endRow: row - 1 + rowCount - 1, endColumn: 16_383 })
  }
  const column = typeof op.column === 'string' ? op.column : null
  const colCount = Number(op.count)
  if (column && Number.isInteger(colCount) && colCount >= 1) {
    try {
      const a = parseAddress(`${column}1`)
      add({ startRow: 0, startColumn: a.column, endRow: 1_048_575, endColumn: a.column + colCount - 1 })
    } catch {
      // malformed column label: skip
    }
  }
  return out
}

/**
 * Collect the ranges an AI plan writes, grouped by sheet. Cell-level batches
 * (a big set_range arrives as thousands of cellChanges) collapse to the
 * per-sheet bounding box once a sheet tops 200 primitive ranges.
 */
export function planWriteRanges(plan: ChangePlan): Map<string, WriteRange[]> {
  const bySheet = new Map<string, WriteRange[]>()
  const push = (sheetId: string, range: WriteRange): void => {
    const list = bySheet.get(sheetId)
    if (list) list.push(range)
    else bySheet.set(sheetId, [range])
  }
  for (const change of plan.cellChanges) {
    try {
      const a = parseAddress(change.address)
      push(change.sheetId, {
        startRow: a.row,
        startColumn: a.column,
        endRow: a.row,
        endColumn: a.column,
      })
    } catch {
      // malformed address: skip
    }
  }
  for (const change of plan.formatChanges) {
    try {
      push(change.sheetId, parseRange(change.range))
    } catch {
      // malformed range: skip
    }
  }
  for (const structural of plan.structuralChanges) {
    const op = structural.op as Record<string, unknown>
    if (typeof op.sheetId !== 'string') continue
    // add_image 的 path 是 http(s) 即搜来的网图:AI 只是执行插入,内容不是
    // 生成的,浮标不锚它(本地生成文件才锚)
    if (op.op === 'add_image' && /^https?:\/\//i.test(String(op.path ?? ''))) continue
    for (const range of opRanges(op)) push(op.sheetId, range)
  }
  for (const [sheetId, list] of bySheet) {
    if (list.length <= 200) continue
    let startRow = list[0]!.startRow
    let startColumn = list[0]!.startColumn
    let endRow = list[0]!.endRow
    let endColumn = list[0]!.endColumn
    for (const r of list) {
      startRow = Math.min(startRow, r.startRow)
      startColumn = Math.min(startColumn, r.startColumn)
      endRow = Math.max(endRow, r.endRow)
      endColumn = Math.max(endColumn, r.endColumn)
    }
    bySheet.set(sheetId, [{ startRow, startColumn, endRow, endColumn }])
  }
  return bySheet
}

/** Record the ranges an AI write just landed on. */
export function recordAiWrite(sheetRanges: ReadonlyMap<string, readonly WriteRange[]>): void {
  if (sheetRanges.size === 0) return
  last = { sheetRanges, at: Date.now() }
}

/** The most recent AI write; `at` stamps the recording so consumers can tell
 * a fresh anchor from one they already showed. */
export function lastAiWrite(): AiWriteRecord | null {
  return last
}

/** Drop the anchor (chip closed, workbook switched). */
export function clearLastAiWrite(): void {
  last = null
}
