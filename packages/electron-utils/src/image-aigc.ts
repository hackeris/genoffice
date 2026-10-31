/**
 * Implicit provenance for AI-generated images: metadata inserted into the
 * container bytes (PNG iTXt chunk / JPEG XMP APP1), keyed "AIGC", value is
 * the TC260 实践指南 field set (see aigcPayload). Pixels are untouched —
 * every viewer renders the image identically — and the marking rides along
 * in the bytes, so documents embedding the stamped media carry it into
 * saved files. Unrecognized formats pass through unchanged.
 */
import { randomUUID } from 'node:crypto'

export interface AiImageMeta {
  /** media provider id that produced the image ('glm', 'doubao', …) */
  readonly provider?: string
}

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** zlib CRC-32 (polynomial 0xEDB88320) over bytes[from, to) */
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

function be32(a: number, b: number, c: number, d: number): number {
  return (((a << 24) | (b << 16) | (c << 8) | d) >>> 0)
}

/** iTXt: keyword \0 compressionFlag(0=none) compressionMethod(0) languageTag\0 translatedKeyword\0 text(UTF-8) */
function iTXtChunk(keyword: string, text: string): Uint8Array {
  const encoder = new TextEncoder()
  const keywordBytes = encoder.encode(keyword)
  const textBytes = encoder.encode(text)
  const dataLength = keywordBytes.length + 1 + 2 + 1 + 1 + textBytes.length
  const chunk = new Uint8Array(12 + dataLength) // length(4) + type(4) + data + crc(4)
  chunk[4] = 0x69 // 'i'
  chunk[5] = 0x54 // 'T'
  chunk[6] = 0x58 // 'X'
  chunk[7] = 0x74 // 't'
  chunk.set(keywordBytes, 8)
  const flags = 8 + keywordBytes.length
  chunk[flags] = 0 // keyword terminator
  chunk[flags + 1] = 0 // compression flag: uncompressed
  chunk[flags + 2] = 0 // compression method
  chunk[flags + 3] = 0 // language tag terminator
  chunk[flags + 4] = 0 // translated keyword terminator
  chunk.set(textBytes, flags + 5)
  const length = dataLength
  chunk[0] = (length >>> 24) & 0xff
  chunk[1] = (length >>> 16) & 0xff
  chunk[2] = (length >>> 8) & 0xff
  chunk[3] = length & 0xff
  const crc = crc32(chunk, 4, 8 + dataLength)
  chunk[8 + dataLength] = (crc >>> 24) & 0xff
  chunk[8 + dataLength + 1] = (crc >>> 16) & 0xff
  chunk[8 + dataLength + 2] = (crc >>> 8) & 0xff
  chunk[8 + dataLength + 3] = crc & 0xff
  return chunk
}

/**
 * The AIGC metadata payload, in the TC260 实践指南《文件元数据隐式标识》field
 * set: exactly Label / ContentProducer / ProduceID / ReservedCode1 /
 * ContentPropagator / PropagateID / ReservedCode2, JSON-encoded. Every
 * carrier (PNG iTXt, JPEG XMP, later OOXML/PDF) carries this same value
 * under the key "AIGC". ProduceID is a fresh UUID per generation; the
 * propagator fields stay empty at generation time.
 */
function aigcPayload(meta: AiImageMeta): string {
  // provider ids are a fixed enum; the whitelist keeps the value safe inside
  // XML attribute positions (the JSON lands in one, for JPEG)
  const producer = (meta.provider ?? '').replace(/[^A-Za-z0-9_-]/g, '')
  return JSON.stringify({
    Label: 'AI生成',
    ContentProducer: producer,
    ProduceID: randomUUID(),
    ReservedCode1: '',
    ContentPropagator: '',
    PropagateID: '',
    ReservedCode2: '',
  })
}

/** Stamp `bytes` with the AIGC provenance chunk; non-PNG input returns as-is. */
export function stampAiGeneratedPng(bytes: Uint8Array, meta: AiImageMeta = {}): Uint8Array {
  if (
    bytes.length < 8 ||
    !PNG_SIGNATURE.every((expected, i) => bytes[i] === expected)
  ) {
    return bytes
  }
  // walk the chunk chain to IEND; a corrupt walk (length overrun) bails out
  let offset = 8
  let iend = -1
  while (offset + 12 <= bytes.length) {
    const length = be32(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
    if (12 + length > bytes.length - offset) return bytes
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    )
    if (type === 'IEND') {
      iend = offset
      break
    }
    offset += 12 + length
  }
  if (iend < 0) return bytes
  const chunk = iTXtChunk('AIGC', aigcPayload(meta))
  const out = new Uint8Array(bytes.length + chunk.length)
  out.set(bytes.subarray(0, iend), 0)
  out.set(chunk, iend)
  out.set(bytes.subarray(iend), iend + chunk.length)
  return out
}

/**
 * JPEG provenance: an XMP APP1 segment inserted right after SOI (the Adobe
 * placement; decoders ignore metadata segments, pixels untouched). The TC260
 * namespace carries the standard JSON as a single attribute (single-quoted —
 * the JSON itself only ever contains double quotes). JPEG segments carry no
 * CRC — just a big-endian length — so insertion is a splice.
 */
const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/\0'
const TC260_AIGC_NS = 'http://www.tc260.org.cn/ns/AIGC/1.0/'

function xmpPacket(meta: AiImageMeta): string {
  const aigc = aigcPayload(meta)
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:tc260="${TC260_AIGC_NS}" tc260:AIGC='${aigc}'/>` +
    `</rdf:RDF></x:xmpmeta><?xpacket end=" w"?>`
  )
}

/** Stamp `bytes` with the AIGC XMP APP1 segment; non-JPEG input returns as-is. */
export function stampAiGeneratedJpeg(bytes: Uint8Array, meta: AiImageMeta = {}): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const payload = new TextEncoder().encode(XMP_NAMESPACE + xmpPacket(meta))
  if (payload.length > 0xffff - 2) return bytes
  const segment = new Uint8Array(4 + payload.length) // marker(2) + length(2) + payload
  segment[0] = 0xff
  segment[1] = 0xe1 // APP1
  segment[2] = ((payload.length + 2) >>> 8) & 0xff
  segment[3] = (payload.length + 2) & 0xff
  segment.set(payload, 4)
  const out = new Uint8Array(2 + segment.length + bytes.length - 2)
  out.set(bytes.subarray(0, 2), 0) // SOI
  out.set(segment, 2)
  out.set(bytes.subarray(2), 2 + segment.length)
  return out
}

/**
 * Stamp AI-generated provenance onto an image, dispatching on the magic
 * bytes: PNG gets an iTXt chunk, JPEG gets an XMP APP1 segment; anything
 * else passes through unchanged.
 */
export function stampAiGeneratedImage(bytes: Uint8Array, meta: AiImageMeta = {}): Uint8Array {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return stampAiGeneratedJpeg(bytes, meta)
  }
  return stampAiGeneratedPng(bytes, meta)
}

/** Read back the stamped provenance (null when absent) — tests and tooling. */
export function readAiPngStamp(bytes: Uint8Array): string | null {
  if (
    bytes.length < 8 ||
    !PNG_SIGNATURE.every((expected, i) => bytes[i] === expected)
  ) {
    return null
  }
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = be32(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
    if (12 + length > bytes.length - offset) return null
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    )
    if (type === 'iTXt') {
      const data = bytes.subarray(offset + 8, offset + 8 + length)
      const keywordEnd = data.indexOf(0)
      const keyword = new TextDecoder().decode(data.subarray(0, keywordEnd >= 0 ? keywordEnd : 0))
      if (keyword !== 'AIGC') return null
      // skip flag/method/language/translated to the text payload
      let cursor = (keywordEnd >= 0 ? keywordEnd : 0) + 1 + 2
      for (let skips = 0; skips < 2 && cursor < data.length; skips += 1) {
        while (cursor < data.length && data[cursor] !== 0) cursor += 1
        cursor += 1
      }
      return new TextDecoder().decode(data.subarray(cursor))
    }
    if (type === 'IEND') return null
    offset += 12 + length
  }
  return null
}
