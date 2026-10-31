import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  applyAiProvenanceToPdfDoc,
  readAiPdfStamp,
  stampAiGeneratedPdf,
  stampAiGeneratedPdfJson,
} from '../src/pdf-aigc'

async function minimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 300])
  return new Uint8Array(await doc.save())
}

describe('stampAiGeneratedPdf', () => {
  it('stamps catalog Metadata + Info /AIGC with the TC260 field set', async () => {
    const pdf = await minimalPdf()
    const stamped = await stampAiGeneratedPdf(pdf, {
      provider: 'glm',
      produceId: '00000000-0000-4000-8000-000000000000',
    })
    expect(stamped.length).toBeGreaterThan(pdf.length)
    const json = JSON.parse((await readAiPdfStamp(stamped))!) as Record<string, string>
    expect(Object.keys(json)).toHaveLength(7)
    expect(json.Label).toBe('AI生成')
    expect(json.ContentProducer).toBe('glm')
    expect(json.ProduceID).toBe('00000000-0000-4000-8000-000000000000')
  })

  it('keeps one ProduceID across re-stamps of the same document', async () => {
    const pdf = await minimalPdf()
    const meta = { provider: 'qwen', produceId: 'pid-fixed' }
    const once = await stampAiGeneratedPdf(pdf, meta)
    const twice = await stampAiGeneratedPdf(once, meta)
    const json = JSON.parse((await readAiPdfStamp(twice))!) as Record<string, string>
    expect(json.ProduceID).toBe('pid-fixed')
  })

  it('fails open: undecodable bytes return unchanged', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5])
    expect(await stampAiGeneratedPdf(garbage, { provider: 'glm', produceId: 'x' })).toBe(garbage)
  })

  it('stamps from a ready-made TC260 JSON (slides latch shape)', async () => {
    const pdf = await minimalPdf()
    const aigcJson = JSON.stringify({
      Label: 'AI生成',
      ContentProducer: 'doubao',
      ProduceID: 'pid-json',
      ReservedCode1: '',
      ContentPropagator: '',
      PropagateID: '',
      ReservedCode2: '',
    })
    const stamped = await stampAiGeneratedPdfJson(pdf, aigcJson)
    expect(await readAiPdfStamp(stamped)).toBe(aigcJson)
  })

  it('applyAiProvenanceToPdfDoc stamps an unsaved live document', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 300])
    applyAiProvenanceToPdfDoc(doc, '{"Label":"AI生成","ContentProducer":"glm"}')
    const bytes = new Uint8Array(await doc.save())
    const json = JSON.parse((await readAiPdfStamp(bytes))!) as Record<string, string>
    expect(json.ContentProducer).toBe('glm')
  })
})
