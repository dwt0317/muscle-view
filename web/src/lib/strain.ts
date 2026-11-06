/** Colour of a muscle from its length ratio: shortened -> red, lengthened -> blue, nearly unchanged -> neutral grey. */

export const NEUTRAL_BAND = 0.025 // |ratio - 1| below this is "no change"
export const FULL_SCALE = 0.25 // |ratio - 1| at which the colour is fully saturated

export type Strain = 'shortened' | 'lengthened' | 'neutral'

export function classify(ratio: number): Strain {
  if (ratio < 1 - NEUTRAL_BAND) return 'shortened'
  if (ratio > 1 + NEUTRAL_BAND) return 'lengthened'
  return 'neutral'
}

const GREY: [number, number, number] = [0x9a, 0x9a, 0x9a]
const RED: [number, number, number] = [0xe0, 0x2a, 0x2a]
const BLUE: [number, number, number] = [0x2a, 0x6a, 0xe8]

const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** Intensity 0..1 of the colour for a ratio (0 inside the neutral band). */
export function intensity(ratio: number): number {
  const d = Math.abs(ratio - 1)
  if (d <= NEUTRAL_BAND) return 0
  return Math.min(1, (d - NEUTRAL_BAND) / (FULL_SCALE - NEUTRAL_BAND))
}

export function strainColor(ratio: number): string {
  const k = intensity(ratio)
  const target = ratio < 1 ? RED : BLUE
  return hex(GREY.map((g, i) => g + (target[i] - g) * k))
}

export const LEGEND = [
  { color: hex(RED), key: 'shortened' as const },
  { color: hex(GREY), key: 'neutral' as const },
  { color: hex(BLUE), key: 'lengthened' as const },
]
