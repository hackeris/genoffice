import { describe, expect, it } from 'vitest'
import { aigcCustomXml, aigcMetaJson, newAigcMeta } from '../src/aigc-meta'

describe('aigc-meta', () => {
  it('emits the TC260 field set in guide order', () => {
    const payload = JSON.parse(aigcMetaJson(newAigcMeta('glm'))) as Record<string, string>
    expect(Object.keys(payload)).toEqual([
      'Label',
      'ContentProducer',
      'ProduceID',
      'ReservedCode1',
      'ContentPropagator',
      'PropagateID',
      'ReservedCode2',
    ])
    expect(payload.Label).toBe('AI生成')
    expect(payload.ContentProducer).toBe('glm')
  })

  it('keeps one ProduceID per meta instance, fresh per document', () => {
    const meta = newAigcMeta('glm')
    const first = (JSON.parse(aigcMetaJson(meta)) as Record<string, string>).ProduceID
    const second = (JSON.parse(aigcMetaJson(meta)) as Record<string, string>).ProduceID
    expect(first).toBe(second)
    const other = (JSON.parse(aigcMetaJson(newAigcMeta('glm'))) as Record<string, string>).ProduceID
    expect(other).not.toBe(first)
  })

  it('whitelists the provider id', () => {
    const payload = JSON.parse(aigcMetaJson(newAigcMeta('a<b>&"c"'))) as Record<string, string>
    expect(payload.ContentProducer).toBe('abc')
  })

  it('custom xml carries the AIGC property with escaped JSON text', () => {
    const xml = aigcCustomXml(newAigcMeta('glm'))
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true)
    expect(xml).toContain('name="AIGC"')
    expect(xml).toContain('<vt:lpwstr>{"Label":"AI生成"')
    expect(xml).toContain('"ContentProducer":"glm"')
  })
})
