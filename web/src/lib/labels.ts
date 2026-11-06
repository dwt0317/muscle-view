import type { Lang, Side } from '../data/manifest'
import { pickName } from './i18n'
import type { NodeRef } from './nodes'

export function sideSuffix(side: Side | null, lang: Lang): string {
  if (!side) return ''
  if (lang === 'zh') return side === 'r' ? '（右）' : '（左）'
  return side === 'r' ? ' (R)' : ' (L)'
}

/** Display name of a node in the chosen language, including the side. */
export function nodeLabel(ref: NodeRef, lang: Lang): string {
  const name = (ref.muscle ?? ref.bone ?? ref.landmark)!.name
  return pickName(name, lang) + sideSuffix(ref.side, lang)
}

/** Rough text width in px for label layout (CJK glyphs are about twice as wide as Latin ones). */
export function textWidth(text: string, fontPx = 12): number {
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) > 0x2e80 ? fontPx : fontPx * 0.56
  return Math.ceil(w) + 12
}
