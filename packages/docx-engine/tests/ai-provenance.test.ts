import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseDocx, saveDocx } from '../src/index'
import { patchAigcCustomPropertiesXml } from '../src/zotero-doc-props'
import { buildDocx } from './helpers/build-docx'

const AIGC_JSON =
  '{"Label":"AI生成","ContentProducer":"glm","ProduceID":"00000000-0000-4000-8000-000000000000",' +
  '"ReservedCode1":"","ContentPropagator":"","PropagateID":"","ReservedCode2":""}'

const originalBlocks = (parsed: Awaited<ReturnType<typeof parseDocx>>) =>
  parsed.blocks
    .filter((block) => !block.hidden)
    .map((block) => ({ kind: 'original' as const, docxIndex: block.docxIndex! }))

async function saveWithAiProvenance(): Promise<Uint8Array> {
  const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>Text</w:t></w:r></w:p>' })
  const parsed = await parseDocx(source)
  return saveDocx(parsed, originalBlocks(parsed), { aiProvenance: AIGC_JSON })
}

describe('AI provenance (docProps/custom.xml AIGC property)', () => {
  it('creates the part with rels and content-type override when latched', async () => {
    const saved = await saveWithAiProvenance()
    const zip = await JSZip.loadAsync(saved)
    const custom = await zip.file('docProps/custom.xml')!.async('string')
    expect(custom).toContain('name="AIGC"')
    expect(custom).toContain('AI生成')
    expect(await zip.file('_rels/.rels')!.async('string')).toContain(
      'relationships/custom-properties',
    )
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain(
      'officedocument.custom-properties+xml',
    )
  })

  it('merges into an existing part, preserving unrelated properties', async () => {
    const existing =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<property fmtid="x" pid="2" name="Owner"><vt:lpwstr>A&amp;B</vt:lpwstr></property>' +
      '</Properties>'
    const source = await buildDocx({
      bodyXml: '<w:p><w:r><w:t>Text</w:t></w:r></w:p>',
      extraParts: [
        {
          path: 'docProps/custom.xml',
          xml: existing,
          contentType: 'application/vnd.openxmlformats-officedocument.custom-properties+xml',
        },
      ],
    })
    const parsed = await parseDocx(source)
    const saved = await saveDocx(parsed, originalBlocks(parsed), { aiProvenance: AIGC_JSON })
    const zip = await JSZip.loadAsync(saved)
    const custom = await zip.file('docProps/custom.xml')!.async('string')
    expect(custom).toContain('name="Owner"')
    expect(custom).toContain('name="AIGC"')
    // the AIGC pid sits above the preserved property's pid
    const ownerPid = Number(custom.match(/pid="(\d+)" name="Owner"/)![1])
    const aigcPid = Number(custom.match(/pid="(\d+)" name="AIGC"/)![1])
    expect(aigcPid).toBeGreaterThan(ownerPid)
  })

  it('composes with zoteroDocumentData when both are requested', async () => {
    const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>Text</w:t></w:r></w:p>' })
    const parsed = await parseDocx(source)
    const saved = await saveDocx(parsed, originalBlocks(parsed), {
      zoteroDocumentData: '{"style":"x"}',
      aiProvenance: AIGC_JSON,
    })
    const zip = await JSZip.loadAsync(saved)
    const custom = await zip.file('docProps/custom.xml')!.async('string')
    expect(custom).toContain('name="ZOTERO_PREF_1"')
    expect(custom).toContain('name="AIGC"')
  })

  it('leaves a plain document without the part', async () => {
    const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>Text</w:t></w:r></w:p>' })
    const parsed = await parseDocx(source)
    const saved = await saveDocx(parsed, originalBlocks(parsed), {})
    const zip = await JSZip.loadAsync(saved)
    expect(zip.file('docProps/custom.xml')).toBeNull()
  })

  it('patchAigcCustomPropertiesXml replaces an existing AIGC property in place', () => {
    const first = patchAigcCustomPropertiesXml(null, '{"Label":"old"}')
    expect(first).toContain('{"Label":"old"}')
    const second = patchAigcCustomPropertiesXml(first, '{"Label":"AI生成"}')
    expect(second).toContain('{"Label":"AI生成"}')
    expect(second).not.toContain('{"Label":"old"}')
    expect(second.match(/name="AIGC"/g)?.length).toBe(1)
  })
})
