/**
 * AIGC 隐式标识元数据(TC260 实践指南《文件元数据隐式标识》字段集)与
 * OOXML docProps/custom.xml 载体。图片容器见 image-aigc.ts;文档容器
 * (docx/pptx/xlsx)由保存方把 aigcCustomXml() 的产物作为
 * docProps/custom.xml part 注入(引擎只接受字符串,不反向依赖本包)。
 *
 * 盖戳是闩锁式:AI 内容被接受进文档即置位(记录 provider 与本文档的
 * ProduceID),之后每次保存都携带,不做自动去戳。
 *
 * 本模块会被渲染层 bundle 引用,不要引入 node 内置模块;UUID 用全局
 * crypto(WebCrypto,Electron 渲染层与 Node ≥19 均可用)。
 */

export interface AigcMeta {
  /** 生成服务提供者 id('glm' 等;白名单外字符剔除) */
  readonly provider: string
  /** 本文档的内容编号(首次置位时生成,保存间复用) */
  readonly produceId: string
}

export function newAigcMeta(provider: string): AigcMeta {
  return { provider, produceId: crypto.randomUUID() }
}

/** TC260 七字段对象(键序即实践指南序);provider 限安全字符集 */
export function aigcJsonFields(provider: string, produceId: string): Record<string, string> {
  return {
    Label: 'AI生成',
    ContentProducer: provider.replace(/[^A-Za-z0-9_-]/g, ''),
    ProduceID: produceId,
    ReservedCode1: '',
    ContentPropagator: '',
    PropagateID: '',
    ReservedCode2: '',
  }
}

/** TC260 七字段 JSON(图片容器与文档容器共用同一取值) */
export function aigcMetaJson(meta: AigcMeta): string {
  return JSON.stringify(aigcJsonFields(meta.provider, meta.produceId))
}

const TC260_AIGC_NS = 'http://www.tc260.org.cn/ns/AIGC/1.0/'

/**
 * XMP 元数据包(TC260 命名空间,tc260:AIGC 属性承载七字段 JSON,JSON 内
 * 只含双引号,故属性用单引号定界)。JPEG APP1 与 PDF catalog Metadata
 * 共用同一包。
 */
export function aigcXmpPacketFromJson(aigcJson: string): string {
  return (
    `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:tc260="${TC260_AIGC_NS}" tc260:AIGC='${aigcJson}'/>` +
    `</rdf:RDF></x:xmpmeta><?xpacket end=" w"?>`
  )
}

/** docProps/custom.xml part 内容:单属性 AIGC(vt:lpwstr),JSON 做文本位转义 */
export function aigcCustomXml(meta: AigcMeta): string {
  const value = aigcMetaJson(meta)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="AIGC">` +
    `<vt:lpwstr>${value}</vt:lpwstr></property></Properties>`
  )
}
