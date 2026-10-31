/**
 * AI 生成内容隐式标识的文档级闩锁:AI 运行有改动落进本文档即置位,之后
 * 每次保存都在 PDF 的 catalog Metadata 与 Info 字典携带 AIGC 元数据。不做
 * 自动去戳(撤销全部 AI 内容的判定不可靠,漏判即违规,宁可过宽);换文档
 * /新建空白时清除。
 */
import type { AigcMeta } from '@genoffice/electron-utils/aigc-meta'
import { newAigcMeta } from '@genoffice/electron-utils/aigc-meta'

let latched: AigcMeta | null = null

/** AI 改动落进本文档:置位(已置位则保持原 ProduceID,同文档同编号) */
export function latchAigc(provider: string): void {
  latched ??= newAigcMeta(provider)
}

/** 当前文档的标识元数据;未置位返回 null(保存时不写标识) */
export function currentAigcMeta(): AigcMeta | null {
  return latched
}

/** 换文档/新建空白:上一份文档的标识随之终结 */
export function clearAigcMeta(): void {
  latched = null
}
