import { describe, expect, it } from 'vitest'
import {
  readAiPngStamp,
  stampAiGeneratedImage,
  stampAiGeneratedJpeg,
  stampAiGeneratedPng,
} from '../src/image-aigc'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let crc = 0xffffffff
  for (let i = from; i < to; i += 1) {
    crc ^= bytes[i]!
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: number[]): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  out[0] = (data.length >>> 24) & 0xff
  out[1] = (data.length >>> 16) & 0xff
  out[2] = (data.length >>> 8) & 0xff
  out[3] = data.length & 0xff
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const crc = crc32(out, 4, 8 + data.length)
  out[8 + data.length] = (crc >>> 24) & 0xff
  out[8 + data.length + 1] = (crc >>> 16) & 0xff
  out[8 + data.length + 2] = (crc >>> 8) & 0xff
  out[8 + data.length + 3] = crc & 0xff
  return out
}

function minimalPng(): Uint8Array {
  const ihdr = chunk('IHDR', [
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
  ])
  const idat = chunk('IDAT', [0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])
  const iend = chunk('IEND', [])
  const out = new Uint8Array(8 + ihdr.length + idat.length + iend.length)
  out.set(SIGNATURE, 0)
  out.set(ihdr, 8)
  out.set(idat, 8 + ihdr.length)
  out.set(iend, 8 + ihdr.length + idat.length)
  return out
}

interface ParsedChunk {
  type: string
  data: Uint8Array
  crcValid: boolean
}

function parseChunks(bytes: Uint8Array): ParsedChunk[] {
  const chunks: ParsedChunk[] = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length =
      ((bytes[offset]! << 24) |
        (bytes[offset + 1]! << 16) |
        (bytes[offset + 2]! << 8) |
        bytes[offset + 3]!) >>>
    0
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    )
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data, crcValid: crc32(bytes, offset + 4, offset + 8 + length) === ((bytes[offset + 8 + length]! << 24) | (bytes[offset + 8 + length + 1]! << 16) | (bytes[offset + 8 + length + 2]! << 8) | bytes[offset + 8 + length + 3]!) >>> 0 })
    offset += 12 + length
  }
  return chunks
}

describe('stampAiGeneratedPng', () => {
  it('inserts a valid AIGC iTXt chunk before IEND', () => {
    const png = minimalPng()
    const stamped = stampAiGeneratedPng(png, { provider: 'glm' })
    expect(stamped.length).toBeGreaterThan(png.length)
    const chunks = parseChunks(stamped)
    expect(chunks.every((c) => c.crcValid)).toBe(true)
    const iendIndex = chunks.findIndex((c) => c.type === 'IEND')
    const stampIndex = chunks.findIndex((c) => c.type === 'iTXt')
    expect(stampIndex).toBeGreaterThan(-1)
    expect(stampIndex).toBeLessThan(iendIndex)
    // keyword + terminator, then flag/method/language/translated before the UTF-8 payload
    const raw = new TextDecoder().decode(chunks[stampIndex]!.data)
    expect(raw.startsWith('AIGC\0')).toBe(true)
    const payload = JSON.parse(readAiPngStamp(stamped)!) as Record<string, string>
    // TC260 实践指南字段集:固定 7 字段
    expect(Object.keys(payload).sort()).toEqual([
      'ContentProducer',
      'ContentPropagator',
      'Label',
      'ProduceID',
      'PropagateID',
      'ReservedCode1',
      'ReservedCode2',
    ])
    expect(payload.Label).toBe('AI生成')
    expect(payload.ContentProducer).toBe('glm')
    expect(payload.ProduceID.length).toBeGreaterThan(0)
    // the original chunks survive untouched (signature + IHDR + IDAT first)
    expect(chunks[0].type).toBe('IHDR')
    expect(Array.from(stamped.subarray(0, 8))).toEqual(SIGNATURE)
  })

  it('passes non-PNG bytes through unchanged', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(stampAiGeneratedPng(jpeg, { provider: 'glm' })).toBe(jpeg)
  })

  it('passes a PNG with a corrupt chunk walk through unchanged', () => {
    const png = minimalPng()
    // IHDR length lies: claims far more data than the file holds
    const broken = png.slice()
    broken[8] = 0x7f
    expect(stampAiGeneratedPng(broken, { provider: 'glm' })).toBe(broken)
  })

  it('omits the provider field when none is given', () => {
    const stamped = stampAiGeneratedPng(minimalPng())
    const payload = JSON.parse(readAiPngStamp(stamped)!) as Record<string, string>
    expect(payload.Label).toBe('AI生成')
    expect(payload.ContentProducer).toBe('')
  })
})

function minimalJpeg(): Uint8Array {
  const app0 = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 2, 0, 0, 1, 0, 1, 0, 0,
  ]
  const eoi = [0xff, 0xd9]
  return new Uint8Array([0xff, 0xd8, ...app0, ...eoi])
}

describe('stampAiGeneratedJpeg', () => {
  it('inserts an XMP APP1 segment right after SOI', () => {
    const jpeg = minimalJpeg()
    const stamped = stampAiGeneratedJpeg(jpeg, { provider: 'glm' })
    expect(stamped.length).toBeGreaterThan(jpeg.length)
    expect(stamped[0]).toBe(0xff)
    expect(stamped[1]).toBe(0xd8) // SOI stays first
    expect(stamped[2]).toBe(0xff)
    expect(stamped[3]).toBe(0xe1) // APP1 follows
    const length = (stamped[4]! << 8) | stamped[5]!
    expect(length).toBeGreaterThan(2)
    const payload = new TextDecoder().decode(stamped.subarray(6, 4 + length))
    expect(payload.startsWith('http://ns.adobe.com/xap/1.0/\0')).toBe(true)
    expect(payload).toContain('xmlns:tc260="http://www.tc260.org.cn/ns/AIGC/1.0/"')
    expect(payload).toContain('"Label":"AI生成"')
    expect(payload).toContain('"ContentProducer":"glm"')
    // the original segments survive untouched after the inserted one
    expect(Array.from(stamped.subarray(stamped.length - jpeg.length + 2))).toEqual(
      Array.from(jpeg.subarray(2)),
    )
  })

  it('whitelists the provider id for the XML attribute position', () => {
    const stamped = stampAiGeneratedJpeg(minimalJpeg(), { provider: 'a<b>&"c"' })
    const stampedText = new TextDecoder().decode(stamped)
    expect(stampedText).toContain('"ContentProducer":"abc"')
  })

  it('passes non-JPEG bytes through unchanged', () => {
    const png = minimalPng()
    expect(stampAiGeneratedJpeg(png, { provider: 'glm' })).toBe(png)
  })
})

describe('stampAiGeneratedImage', () => {
  it('dispatches on magic bytes: JPEG gets APP1, PNG gets iTXt', () => {
    expect(stampAiGeneratedImage(minimalJpeg(), { provider: 'glm' })[3]).toBe(0xe1)
    const stampedPng = stampAiGeneratedImage(minimalPng(), { provider: 'glm' })
    expect(new TextDecoder().decode(stampedPng).includes('iTXt')).toBe(true)
  })

  it('stamps WebP (RIFF) with an XMP chunk and rewrites the RIFF size', () => {
    const body = [0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0x02, 0x00, 0x00, 0x00, 0x01, 0x02]
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, body.length + 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...body,
    ])
    const stamped = stampAiGeneratedImage(webp, { provider: 'glm' })
    expect(stamped.length).toBeGreaterThan(webp.length)
    // 尾部 'XMP ' chunk:FourCC + sizeLE + payload
    const tail = stamped.subarray(webp.length)
    expect(String.fromCharCode(tail[0]!, tail[1]!, tail[2]!, tail[3]!)).toBe('XMP ')
    const chunkSize = tail[4]! | (tail[5]! << 8) | (tail[6]! << 16) | (tail[7]! << 24)
    expect(tail.length).toBe(8 + chunkSize)
    const payload = new TextDecoder().decode(tail.subarray(8))
    expect(payload).toContain('"Label":"AI生成"')
    expect(payload).toContain('tc260:AIGC')
    // RIFF size 重写为覆盖新 chunk
    const riffSize = stamped[4]! | (stamped[5]! << 8) | (stamped[6]! << 16) | (stamped[7]! << 24)
    expect(riffSize).toBe(stamped.length - 8)
  })

  it('passes unknown formats through unchanged', () => {
    const riff = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5, 6, 7, 8]) // RIFF 但非 WEBP
    expect(stampAiGeneratedImage(riff, { provider: 'glm' })).toBe(riff)
  })
})

describe('readAiPngStamp', () => {
  it('round-trips the stamped payload', () => {
    const stamped = stampAiGeneratedPng(minimalPng(), { provider: 'qwen' })
    const payload = JSON.parse(readAiPngStamp(stamped)!) as Record<string, string>
    expect(payload.ContentProducer).toBe('qwen')
  })

  it('returns null for clean and non-PNG input', () => {
    expect(readAiPngStamp(minimalPng())).toBeNull()
    expect(readAiPngStamp(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('honors an explicit produceId and generates fresh ids without one', () => {
    const latched = stampAiGeneratedPng(minimalPng(), {
      provider: 'glm',
      produceId: 'doc-uuid-1',
    })
    const payload = JSON.parse(readAiPngStamp(latched)!) as Record<string, string>
    expect(payload.ProduceID).toBe('doc-uuid-1')
    expect(payload.ContentProducer).toBe('glm')

    const first = JSON.parse(readAiPngStamp(stampAiGeneratedPng(minimalPng()))!) as Record<
      string,
      string
    >
    const second = JSON.parse(readAiPngStamp(stampAiGeneratedPng(minimalPng()))!) as Record<
      string,
      string
    >
    expect(first.ProduceID).not.toBe(second.ProduceID)
  })

  it('carries the explicit produceId into the JPEG XMP packet', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const stamped = stampAiGeneratedJpeg(jpeg, { provider: 'glm', produceId: 'doc-uuid-2' })
    const payload = new TextDecoder().decode(stamped)
    expect(payload).toContain('"ProduceID":"doc-uuid-2"')
  })
})
