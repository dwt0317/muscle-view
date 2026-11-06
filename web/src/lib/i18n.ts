import type { L2, L3, Lang, Side } from '../data/manifest'

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'la', label: 'Latina' },
]

/** Name in the chosen language (falls back to English). */
export function pickName(n: L3, lang: Lang): string {
  return n[lang] || n.en
}

/** The other two names, ordered zh, en, la, for secondary display. */
export function otherNames(n: L3, lang: Lang): string[] {
  return (['zh', 'en', 'la'] as Lang[]).filter((l) => l !== lang).map((l) => n[l]).filter(Boolean)
}

/** Free text (origin / insertion / function) exists in zh and en; Latin mode shows English. */
export function pickText(t: L2, lang: Lang): string {
  return lang === 'zh' ? t.zh : t.en
}

const UI: Record<string, { zh: string; en: string }> = {
  title: { zh: '肌肉三维查看器', en: 'Muscle Viewer' },
  loading: { zh: '加载中…', en: 'Loading…' },
  ready: { zh: '就绪', en: 'Ready' },
  origin: { zh: '起点', en: 'Origin' },
  insertion: { zh: '止点', en: 'Insertion' },
  function: { zh: '功能', en: 'Function' },
  group: { zh: '分组', en: 'Group' },
  layer: { zh: '层次', en: 'Layer' },
  region: { zh: '部位', en: 'Region' },
  side: { zh: '侧别', en: 'Side' },
  right: { zh: '右侧', en: 'Right' },
  left: { zh: '左侧', en: 'Left' },
  midline: { zh: '中线', en: 'Midline' },
  superficial: { zh: '浅层', en: 'Superficial' },
  intermediate: { zh: '中层', en: 'Intermediate' },
  deep: { zh: '深层', en: 'Deep' },
  bone: { zh: '骨骼', en: 'Bone' },
  muscle: { zh: '肌肉', en: 'Muscle' },
  fascia: { zh: '筋膜', en: 'Fascia' },
  nothingSelected: { zh: '点击模型上的肌肉或骨骼查看详情', en: 'Click a muscle or bone for details' },
  close: { zh: '关闭', en: 'Close' },
  fma: { zh: 'FMA 编号', en: 'FMA ID' },
  pendingReview: { zh: '待临床确认', en: 'Pending clinical review' },
  reset: { zh: '重置', en: 'Reset' },
  views: { zh: '视角', en: 'Views' },
  front: { zh: '前', en: 'Front' },
  back: { zh: '后', en: 'Back' },
  leftView: { zh: '左', en: 'Left' },
  rightView: { zh: '右', en: 'Right' },
}

export type UiKey = keyof typeof UI

export function ui(lang: Lang, key: UiKey): string {
  const e = UI[key]
  return lang === 'zh' ? e.zh : e.en
}

export function sideLabel(side: Side | null, lang: Lang): string {
  return ui(lang, side === 'r' ? 'right' : side === 'l' ? 'left' : 'midline')
}
