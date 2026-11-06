import type { Manifest, RegionId } from '../data/manifest'
import type { Vec3 } from '../scene/cameraPresets'

/** Where the camera looks from when a region is focused, in body terms (unit-ish vector, +Z front, -X patient's right). */
export const REGION_VIEW: Record<RegionId, { dir: Vec3; label: { zh: string; en: string } }> = {
  shoulder: { dir: [-0.55, 0.12, 0.83], label: { zh: '肩', en: 'Shoulder' } }, // front, from the patient's right
  hip: { dir: [-0.78, 0.1, 0.62], label: { zh: '髋', en: 'Hip' } },
  knee: { dir: [-0.5, 0.05, 0.86], label: { zh: '膝', en: 'Knee' } },
  lumbar: { dir: [-0.35, 0.08, -0.94], label: { zh: '腰', en: 'Lumbar' } }, // from behind
}

/** Nodes (muscles + bones) belonging to a region on the given side (or both). */
export function regionNodes(m: Manifest, region: RegionId, side: 'r' | 'l' | 'both' = 'both'): string[] {
  const out: string[] = []
  for (const mu of m.muscles) {
    if (!mu.regions.includes(region)) continue
    for (const s of ['r', 'l'] as const) if (side === 'both' || side === s) out.push(mu.nodes[s])
  }
  for (const b of m.bones) {
    if (!b.regions.includes(region) || b.context) continue
    for (const [s, n] of Object.entries(b.nodes)) if (side === 'both' || s === '' || s === side) out.push(n)
  }
  return out
}

export interface Framing {
  target: Vec3
  distance: number
}

/** Camera distance that fits a box of the given size in a vertical field of view (degrees), with some margin. */
export function fitDistance(size: Vec3, fovDeg: number, aspect: number, margin = 1.25): number {
  const half = (fovDeg * Math.PI) / 360
  const needY = size[1] / 2 / Math.tan(half)
  const needX = size[0] / 2 / (Math.tan(half) * aspect)
  const needZ = size[2] / 2
  return Math.max(needY, needX) * margin + needZ
}
