import { describe, expect, it } from 'vitest'
import { createBlankPptx, openPptx } from '../src/index'
import { applyAiProvenance } from '../src/aigc'

const AIGC_JSON =
  '{"Label":"AI生成","ContentProducer":"glm","ProduceID":"00000000-0000-4000-8000-000000000000",' +
  '"ReservedCode1":"","ContentPropagator":"","PropagateID":"","ReservedCode2":""}'

describe('applyAiProvenance', () => {
  it('adds docProps/custom.xml with content-type override and package rel, idempotently', async () => {
    const opened = await openPptx(await createBlankPptx())
    applyAiProvenance(opened.archive, AIGC_JSON)
    applyAiProvenance(opened.archive, AIGC_JSON)

    const custom = opened.archive.readText('docProps/custom.xml')!
    expect(custom).toContain('name="AIGC"')
    expect(custom).toContain('AI生成')
    expect(custom.match(/name="AIGC"/g)?.length).toBe(1)
    expect(opened.archive.readText('[Content_Types].xml')).toContain(
      'officedocument.custom-properties+xml',
    )
    const rels = opened.archive.readText('_rels/.rels')!
    expect(rels).toContain('relationships/custom-properties')
    expect(rels.match(/relationships\/custom-properties/g)?.length).toBe(1)
  })

  it('preserves unrelated custom properties and merges the AIGC value', async () => {
    const opened = await openPptx(await createBlankPptx())
    opened.archive.entries.set(
      'docProps/custom.xml',
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
          'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
          '<property fmtid="x" pid="2" name="Owner"><vt:lpwstr>A&amp;B</vt:lpwstr></property>' +
          '</Properties>',
        'utf8',
      ),
    )
    applyAiProvenance(opened.archive, AIGC_JSON)
    const custom = opened.archive.readText('docProps/custom.xml')!
    expect(custom).toContain('name="Owner"')
    expect(custom).toContain('"ContentProducer":"glm"')
    const ownerPid = Number(custom.match(/pid="(\d+)" name="Owner"/)![1])
    const aigcPid = Number(custom.match(/pid="(\d+)" name="AIGC"/)![1])
    expect(aigcPid).toBeGreaterThan(ownerPid)
  })
})
