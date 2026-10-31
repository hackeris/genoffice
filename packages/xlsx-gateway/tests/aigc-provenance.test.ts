import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import {
  createBufferEntrySource,
  planCellEditsToXlsx,
} from '../src/gateway/xlsx-gateway'

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

const WORKSHEET = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1"><v>0</v></c></row>
  </sheetData>
</worksheet>`

async function fixture(extraCustomXml?: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', PACKAGE_RELS)
  zip.file('xl/workbook.xml', WORKBOOK)
  zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS)
  zip.file('xl/worksheets/sheet1.xml', WORKSHEET)
  if (extraCustomXml) zip.file('docProps/custom.xml', extraCustomXml)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

const AIGC_JSON =
  '{"Label":"AI生成","ContentProducer":"glm","ProduceID":"00000000-0000-4000-8000-000000000000",' +
  '"ReservedCode1":"","ContentPropagator":"","PropagateID":"","ReservedCode2":""}'

async function planWithAiProvenance(customXml?: string) {
  const source = await createBufferEntrySource(await fixture(customXml))
  return planCellEditsToXlsx(
    source,
    [
      {
        sheetName: 'Data',
        row: 0,
        column: 0,
        writeValue: true,
        cell: { value: 7 },
      },
    ],
    [], // structuralOps
    [], // chartEdits
    undefined, // sheetPlan
    [], // filterStates
    [], // hyperlinkEdits
    [], // cfStates
    [], // dvStates
    [], // sheetProtections
    null, // definedNamesState
    [], // visualAdditions
    [], // pageSetupStates
    [], // noteStates
    [], // tableAdditions
    [], // pivotAdditions
    [], // pivotCacheRefreshPaths
    [], // pivotRefreshUpdates
    [], // visualEdits
    [], // sparklineAdditions
    [], // formulaValues
    null, // themeState
    null, // workbookProtectionState
    [], // protectedRangeStates
    [], // bulkConstantFills
    [], // tabColorStates
    [], // tableEdits
    AIGC_JSON, // aigcProvenance
  )
}

describe('AIGC provenance (docProps/custom.xml AIGC property)', () => {
  it('adds the part with rels and content-type override', async () => {
    const plan = await planWithAiProvenance()
    const added = plan.added.get('docProps/custom.xml')
    expect(added).toBeDefined()
    const payload = JSON.parse(
      /<vt:lpwstr>([\s\S]*?)<\/vt:lpwstr>/.exec(added!)![1]!,
    ) as Record<string, string>
    expect(payload.Label).toBe('AI生成')
    expect(payload.ContentProducer).toBe('glm')
    expect(Object.keys(payload)).toHaveLength(7)
    const rels = plan.replaced.get('_rels/.rels')
    expect(rels).toContain('relationships/custom-properties')
    expect(rels).toContain('Target="docProps/custom.xml"')
    const contentTypes = plan.replaced.get('[Content_Types].xml')
    expect(contentTypes).toContain('PartName="/docProps/custom.xml"')
  })

  it('merges into an existing part, preserving unrelated properties', async () => {
    const existing =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<property fmtid="x" pid="2" name="Owner"><vt:lpwstr>A&amp;B</vt:lpwstr></property>' +
      '</Properties>'
    const plan = await planWithAiProvenance(existing)
    const replaced = plan.replaced.get('docProps/custom.xml')!
    expect(replaced).toContain('name="Owner"')
    expect(replaced).toContain('name="AIGC"')
    const ownerPid = Number(replaced.match(/pid="(\d+)" name="Owner"/)![1])
    const aigcPid = Number(replaced.match(/pid="(\d+)" name="AIGC"/)![1])
    expect(aigcPid).toBeGreaterThan(ownerPid)
    expect(plan.added.has('docProps/custom.xml')).toBe(false)
  })

  it('injects nothing when the provenance is absent', async () => {
    const source = await createBufferEntrySource(await fixture())
    const plan = await planCellEditsToXlsx(source, [
      {
        sheetName: 'Data',
        row: 0,
        column: 0,
        writeValue: true,
        cell: { value: 7 },
      },
    ])
    expect(plan.added.has('docProps/custom.xml')).toBe(false)
    expect(plan.replaced.has('_rels/.rels')).toBe(false)
  })
})
