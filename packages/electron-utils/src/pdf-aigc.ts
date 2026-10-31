/**
 * AI 生成内容隐式标识(PDF):catalog 挂 TC260 XMP Metadata 流,Info 字典
 * 加自定义 /AIGC 键(实践指南的 PDF 承载方式),两处并存。经 pdf-lib
 * 读取与重写;加密/解析失败时原样返回(盖章失败不破坏文件,调用方
 * 酌情告警)。
 */
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
} from 'pdf-lib'
import { aigcJsonFields, aigcMetaJson, aigcXmpPacketFromJson } from './aigc-meta'

export interface AiPdfMeta {
  readonly provider: string
  /** 文档级 ProduceID(与该文档 OOXML 标识一致,由闩锁持有) */
  readonly produceId: string
}

/**
 * 往未保存的 pdf-lib 文档注入标识(catalog Metadata + Info /AIGC)。给
 * 应用内「live doc」保存链用:文档对象已在手上,无需重新 parse。
 */
export function applyAiProvenanceToPdfDoc(doc: PDFDocument, aigcJson: string): void {
  const xmp = new TextEncoder().encode(aigcXmpPacketFromJson(aigcJson))
  const stream = doc.context.stream(xmp, {
    Type: 'Metadata',
    Subtype: 'XML',
    Length: xmp.length,
  })
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream))
  const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)
  info?.set(PDFName.of('AIGC'), PDFHexString.fromText(aigcJson))
}

/** 盖章(TC260 JSON 现成时用,如 slides 闩锁);失败原样返回 */
export async function stampAiGeneratedPdfJson(
  bytes: Uint8Array,
  aigcJson: string,
): Promise<Uint8Array> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    applyAiProvenanceToPdfDoc(doc, aigcJson)
    return new Uint8Array(await doc.save())
  } catch {
    return bytes
  }
}

/** 盖章:catalog Metadata + Info /AIGC;失败原样返回 */
export async function stampAiGeneratedPdf(bytes: Uint8Array, meta: AiPdfMeta): Promise<Uint8Array> {
  return stampAiGeneratedPdfJson(bytes, aigcMetaJson(meta))
}

/** 读取现有 AIGC JSON(catalog Metadata 里的 tc260:AIGC;无则 null) */
export async function readAiPdfStamp(bytes: Uint8Array): Promise<string | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    const ref = doc.catalog.get(PDFName.of('Metadata'))
    if (!ref) return null
    const obj = doc.context.lookup(ref)
    if (!(obj instanceof PDFRawStream)) return null
    const text = new TextDecoder().decode(decodePDFRawStream(obj).decode())
    return /tc260:AIGC='([^']*)'/.exec(text)?.[1] ?? null
  } catch {
    return null
  }
}
