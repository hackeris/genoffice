import { afterEach, describe, expect, it } from 'vitest'
import {
  clearLastAiWrite,
  lastAiWrite,
  normalizeRanges,
  recordAiWrite,
} from '../src/renderer/ai-write-anchor'

afterEach(() => {
  clearLastAiWrite()
})

describe('the AI-write anchor', () => {
  it('records and clears the latest write', () => {
    recordAiWrite([[10, 20]])
    expect(lastAiWrite()?.ranges).toEqual([[10, 20]])
    recordAiWrite([[50, 60]])
    expect(lastAiWrite()?.ranges).toEqual([[50, 60]])
    clearLastAiWrite()
    expect(lastAiWrite()).toBeNull()
  })

  it('ignores empty recordings', () => {
    recordAiWrite([])
    expect(lastAiWrite()).toBeNull()
  })

  it('clamps to the document and drops emptied ranges', () => {
    expect(normalizeRanges([[10, 20]], 15)).toEqual([[10, 15]])
    expect(normalizeRanges([[10, 20]], 5)).toBeNull()
    expect(normalizeRanges([[0, 0]], 100)).toBeNull()
  })

  it('merges overlapping and adjacent ranges, keeps separated ones', () => {
    expect(normalizeRanges([[10, 20], [20, 30], [31, 40]], 100)).toEqual([[10, 40]])
    expect(normalizeRanges([[10, 20], [50, 60]], 100)).toEqual([
      [10, 20],
      [50, 60],
    ])
  })

  it('returns the topmost-first order regardless of recording order', () => {
    expect(normalizeRanges([[50, 60], [10, 20]], 100)).toEqual([
      [10, 20],
      [50, 60],
    ])
  })
})
