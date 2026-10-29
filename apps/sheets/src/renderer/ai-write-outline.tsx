/**
 * Canvas outline around the ranges of the most recent AI write, plus the
 * viewport conversion its floating chip anchors with. Static by design: the
 * outline freezes where the write landed and does not follow later edits —
 * a "look here" marker, cleared on ✕. Plumbing (registry + dirty-marking)
 * clones cross-highlight.tsx; it renders no document content and is skipped
 * for print.
 */
import type { IRange, IScale } from '@univerjs/core'
import {
  IRenderManagerService,
  SHEET_VIEWPORT_KEY,
  SheetExtension,
  SpreadsheetExtensionRegistry,
  type IDrawInfo,
  type SpreadsheetSkeleton,
  type UniverRenderingContext,
} from '@univerjs/engine-render'
import { SheetSkeletonManagerService } from '@univerjs/preset-sheets-core'
import type { UniverRuntime } from './univer-state'
import { clearLastAiWrite, lastAiWrite, type WriteRange } from './ai-write-anchor'

/** Canvas chrome colors, keyed by UI theme (AI accent, like --color-ai-action). */
export const AI_WRITE_OUTLINE_COLORS = {
  light: { line: 'rgba(199, 81, 29, 0.8)' },
  dark: { line: 'rgba(240, 122, 85, 0.85)' },
} as const

export type AiWriteOutlineTheme = keyof typeof AI_WRITE_OUTLINE_COLORS

/** UI theme for canvas chrome, mirroring App's precedence: an explicit
 * <html data-doc-theme> pin wins, then data-theme, then the OS preference. */
export function currentOutlineTheme(): AiWriteOutlineTheme {
  const docAttr = document.documentElement.getAttribute('data-doc-theme')
  if (docAttr === 'dark') return 'dark'
  if (docAttr === 'light') return 'light'
  if (document.documentElement.getAttribute('data-theme') === 'dark') return 'dark'
  return document.documentElement.hasAttribute('data-theme')
    ? 'light'
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
}

interface OutlineState {
  readonly visible: boolean
  readonly workbookId: string
  readonly sheetId: string
  readonly ranges: IRange[]
  readonly theme: AiWriteOutlineTheme
}

let outlineState: OutlineState = {
  visible: false,
  workbookId: '',
  sheetId: '',
  ranges: [],
  theme: 'light',
}

const toIRange = (range: WriteRange): IRange => ({ ...range })

/** The range overlaps the visible window (skip painting far-away writes) */
function intersects(range: IRange, viewRanges: readonly IRange[]): boolean {
  return viewRanges.some(
    (view) =>
      range.startRow <= view.endRow &&
      range.endRow >= view.startRow &&
      range.startColumn <= view.endColumn &&
      range.endColumn >= view.startColumn,
  )
}

/** Grid extension ordered just below the cross-highlight's chrome layer. */
export class AiWriteOutlineExtension extends SheetExtension {
  readonly uKey = 'GenOfficeAiWriteOutlineExtension'
  protected Z_INDEX = 21

  override draw(
    ctx: UniverRenderingContext,
    _parentScale: IScale,
    skeleton: SpreadsheetSkeleton,
    _diffRanges: IRange[] | undefined,
    drawInfo?: IDrawInfo,
  ): void {
    if (!outlineState.visible || outlineState.ranges.length === 0) return
    if (ctx.__mode === 'printing') return
    const worksheet = skeleton.worksheet
    if (
      !worksheet ||
      worksheet.unitId !== outlineState.workbookId ||
      worksheet.getSheetId() !== outlineState.sheetId
    ) {
      return
    }
    const viewRanges = drawInfo?.viewRanges?.length
      ? drawInfo.viewRanges
      : [skeleton.rowColumnSegment]
    const { scaleX, scaleY } = ctx.getScale()
    const unit = 1 / Math.max(scaleX, scaleY, 1)
    ctx.save()
    ctx.strokeStyle = AI_WRITE_OUTLINE_COLORS[outlineState.theme].line
    ctx.lineWidth = 1.5 * unit
    ctx.setLineDash([4 * unit, 3 * unit])
    for (const range of outlineState.ranges) {
      if (!intersects(range, viewRanges)) continue
      const first = skeleton.getCellWithCoordByIndex(range.startRow, range.startColumn, false)
      const lastCell = skeleton.getCellWithCoordByIndex(range.endRow, range.endColumn, false)
      if (!first || !lastCell) continue
      ctx.strokeRect(
        first.startX,
        first.startY,
        lastCell.endX - first.startX,
        lastCell.endY - first.startY,
      )
    }
    ctx.restore()
  }
}

SpreadsheetExtensionRegistry.add(AiWriteOutlineExtension)

function markRenderDirty(runtime: UniverRuntime, workbookId: string): void {
  if (!workbookId) return
  try {
    const render = runtime.univer
      .__getInjector()
      .get(IRenderManagerService)
      .getRenderById(workbookId)
    render?.mainComponent?.makeDirty(true)
    render?.scene?.makeDirty(true)
  } catch {
    // Render modules may not exist yet during workbook replacement.
  }
}

function activeWorkbookId(runtime: UniverRuntime): string | null {
  try {
    return runtime.univerAPI.getActiveWorkbook()?.getId() ?? null
  } catch {
    return null
  }
}

function activeSheetId(runtime: UniverRuntime): string | null {
  try {
    return runtime.univerAPI.getActiveWorkbook()?.getActiveSheet()?.getSheetId() ?? null
  } catch {
    return null
  }
}

/** Point the outline at the recorded AI write's ranges on the active sheet. */
export function setAiWriteOutline(
  runtime: UniverRuntime,
  theme: AiWriteOutlineTheme,
): void {
  const workbookId = activeWorkbookId(runtime)
  const sheetId = activeSheetId(runtime)
  const record = lastAiWrite()
  const ranges =
    workbookId && sheetId && record ? (record.sheetRanges.get(sheetId) ?? []) : []
  outlineState = {
    visible: ranges.length > 0,
    workbookId: workbookId ?? '',
    sheetId: sheetId ?? '',
    ranges: ranges.map(toIRange),
    theme,
  }
  if (workbookId) markRenderDirty(runtime, workbookId)
}

/** Erase the outline and drop the recorded anchor (chip ✕). */
export function clearAiWriteOutline(runtime: UniverRuntime): void {
  const workbookId = activeWorkbookId(runtime)
  outlineState = { visible: false, workbookId: '', sheetId: '', ranges: [], theme: 'light' }
  clearLastAiWrite()
  if (workbookId) markRenderDirty(runtime, workbookId)
}

export interface ViewportBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/**
 * Viewport-space box of the recorded write on the active sheet, clamped to
 * the visible grid — the chip's anchor. Same conversion the outline gutter
 * uses: content coordinates (size accumulations) shift by the main viewport's
 * scroll inside the scene, then land on screen through the canvas rect.
 */
export function aiWriteViewportRect(runtime: UniverRuntime): ViewportBox | null {
  const record = lastAiWrite()
  if (!record) return null
  try {
    const workbook = runtime.univerAPI.getActiveWorkbook()
    const sheetId = workbook?.getActiveSheet()?.getSheetId()
    if (!workbook || !sheetId) return null
    const ranges = record.sheetRanges.get(sheetId)
    if (!ranges || ranges.length === 0) return null
    const render = runtime.univer
      .__getInjector()
      .get(IRenderManagerService)
      .getRenderById(workbook.getId())
    if (!render) return null
    const skeleton = render.with(SheetSkeletonManagerService).getCurrentSkeleton()
    if (!skeleton) return null
    const scene = render.scene
    const { scaleX, scaleY } = scene.getAncestorScale()
    const viewMain = scene.getViewport(SHEET_VIEWPORT_KEY.VIEW_MAIN)
    if (!viewMain) return null
    const canvas = render.engine.getCanvasElement()
    if (!canvas) return null
    const gridRect = canvas.getBoundingClientRect()
    const rows = skeleton.rowHeightAccumulation
    const columns = skeleton.columnWidthAccumulation
    const contentY = (row: number): number => (row > 0 ? (rows[row - 1] ?? 0) : 0)
    const contentX = (column: number): number => (column > 0 ? (columns[column - 1] ?? 0) : 0)
    let box: ViewportBox | null = null
    for (const range of ranges) {
      const canvasLeft =
        viewMain.left + (contentX(range.startColumn) - viewMain.viewportScrollX) * scaleX
      const canvasTop =
        viewMain.top + (contentY(range.startRow) - viewMain.viewportScrollY) * scaleY
      const canvasRight =
        viewMain.left + (contentX(range.endColumn + 1) - viewMain.viewportScrollX) * scaleX
      const canvasBottom =
        viewMain.top + (contentY(range.endRow + 1) - viewMain.viewportScrollY) * scaleY
      // clamp to the visible grid band
      const left = Math.max(gridRect.left, gridRect.left + canvasLeft)
      const top = Math.max(gridRect.top, gridRect.top + canvasTop)
      const right = Math.min(gridRect.right, gridRect.left + canvasRight)
      const bottom = Math.min(gridRect.bottom, gridRect.top + canvasBottom)
      if (right <= left || bottom <= top) continue
      box = box
        ? {
            left: Math.min(box.left, left),
            top: Math.min(box.top, top),
            right: Math.max(box.right, right),
            bottom: Math.max(box.bottom, bottom),
          }
        : { left, top, right, bottom }
    }
    return box
  } catch {
    return null
  }
}
