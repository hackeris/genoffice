/**
 * AI 生成内容隐式标识:保存时把 AIGC 元数据(TC260 七字段 JSON)写入
 * docProps/custom.xml 的 AIGC 属性,与 docx-engine 的 zotero/custom 链路
 * 同构——merge 已有属性、补 Content_Types override 与包级 relationship。
 * 幂等:重复应用不会产生重复 property/override/rel。像素与幻灯片内容
 * 不受影响。
 */
import type { PackageArchive } from './zip'
import { hasContentTypeOverride } from './xml-utils'
import { appendRelationship } from './notes'

const CUSTOM_PROPERTIES_PATH = 'docProps/custom.xml'
const CUSTOM_PROPERTIES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.custom-properties+xml'
const CUSTOM_PROPERTIES_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties'
const AIGC_PROPERTY_NAME = 'AIGC'
const PROPERTY_RE =
  /<(?:[A-Za-z_][\w.-]*:)?property\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?property\s*>/g

function setEntry(archive: PackageArchive, path: string, xml: string): void {
  archive.entries.set(path, Buffer.from(xml, 'utf8'))
}

function attrValue(xml: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(xml)
  return match ? (match[1] ?? match[2] ?? null) : null
}

/** merge-or-create custom.xml,upsert AIGC 属性并保留其他属性与 pid */
function upsertAigcProperty(archive: PackageArchive, aigcJson: string): void {
  const existing = archive.readText(CUSTOM_PROPERTIES_PATH)
  const original =
    existing ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>'
  let maxPid = 1
  for (const property of original.match(PROPERTY_RE) ?? []) {
    const pid = Number(/\bpid\s*=\s*"(\d+)"/.exec(property)?.[1])
    if (Number.isSafeInteger(pid)) maxPid = Math.max(maxPid, pid)
  }
  const withoutOld = original.replace(PROPERTY_RE, (property) => {
    return attrValue(property, 'name') === AIGC_PROPERTY_NAME ? '' : property
  })
  const property =
    `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${maxPid + 1}"` +
    ` name="${AIGC_PROPERTY_NAME}"><vt:lpwstr>${
      aigcJson.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }</vt:lpwstr></property>`
  const selfClosing = /<((?:[A-Za-z_][\w.-]*:)?Properties)\b([^>]*?)\/>/
  const empty = selfClosing.exec(withoutOld)
  if (empty) {
    setEntry(
      archive,
      CUSTOM_PROPERTIES_PATH,
      withoutOld.replace(selfClosing, () => `<${empty[1]}${empty[2]}>${property}</${empty[1]}>`),
    )
    return
  }
  setEntry(
    archive,
    CUSTOM_PROPERTIES_PATH,
    withoutOld.replace(/<\/(?:[A-Za-z_][\w.-]*:)?Properties\s*>/, (close) => `${property}${close}`),
  )
}

/** 保存前调用:把 AIGC 元数据落进包(幂等)。 */
export function applyAiProvenance(archive: PackageArchive, aigcJson: string): void {
  upsertAigcProperty(archive, aigcJson)
  const contentTypes = archive.readText('[Content_Types].xml')
  if (
    contentTypes &&
    !hasContentTypeOverride(contentTypes, CUSTOM_PROPERTIES_PATH)
  ) {
    setEntry(
      archive,
      '[Content_Types].xml',
      contentTypes.replace(
        '</Types>',
        `<Override PartName="/${CUSTOM_PROPERTIES_PATH}" ContentType="${CUSTOM_PROPERTIES_CONTENT_TYPE}"/></Types>`,
      ),
    )
  }
  const rootRels = archive.readText('_rels/.rels')
  if (rootRels && !rootRels.includes(CUSTOM_PROPERTIES_REL_TYPE)) {
    appendRelationship(archive, '', CUSTOM_PROPERTIES_REL_TYPE, CUSTOM_PROPERTIES_PATH)
  }
}
