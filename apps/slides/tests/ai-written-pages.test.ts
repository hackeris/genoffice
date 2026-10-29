import { describe, expect, it } from 'vitest'
import { touchedPagesOf } from '../src/renderer/ai/slide-qc'

describe('touchedPagesOf', () => {
  it('parses numeric slide prefixes and dedupes + sorts', () => {
    expect(
      touchedPagesOf([
        { target: '3/text:box1' },
        { target: '0/style:box2' },
        { target: '3/fill:box1' },
      ]),
    ).toEqual([0, 3])
  })

  it('skips non-numeric and out-of-deck targets', () => {
    expect(
      touchedPagesOf([{ target: 'master/bg' }, { target: undefined }, { target: '9/text:x' }], 4),
    ).toEqual([])
  })

  it('keeps indexes inside the rebuilt deck when a size is given', () => {
    expect(touchedPagesOf([{ target: '2/text:a' }, { target: '5/text:b' }], 4)).toEqual([2])
    expect(touchedPagesOf([{ target: '2/text:a' }, { target: '5/text:b' }])).toEqual([2, 5])
  })

  it('tolerates missing records', () => {
    expect(touchedPagesOf(undefined)).toEqual([])
    expect(touchedPagesOf([])).toEqual([])
  })
})
