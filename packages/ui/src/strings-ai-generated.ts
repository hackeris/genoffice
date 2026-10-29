import type { Lang } from '@genoffice/i18n'

/** Visible compliance wording for AI-generated content. One string per
 * language, shared by the in-reply badge and the floating chip beside
 * AI-written document ranges, so the marking reads identically everywhere. */
export const AI_GENERATED_LABELS: Record<Lang, string> = {
  zh: 'AI生成',
  en: 'AI-generated',
  ja: 'AI生成',
  ko: 'AI 생성',
  fr: 'Généré par IA',
  de: 'KI-generiert',
  es: 'Generado por IA',
  th: 'สร้างโดย AI',
  id: 'Dihasilkan oleh AI',
  ru: 'Сгенерировано ИИ',
  ar: 'تم إنشاؤه بواسطة الذكاء الاصطناعي',
  pt: 'Gerado por IA',
  it: "Generato dall'IA",
  pl: 'Wygenerowano przez AI',
  cs: 'Vygenerováno AI',
  nl: 'AI-gegenereerd',
  ms: 'Dijana oleh AI',
  he: 'נוצר על ידי AI',
  hi: 'AI द्वारा जनित',
  'zh-TW': 'AI生成',
  vi: 'Do AI tạo ra',
}
