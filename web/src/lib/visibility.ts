import type { Layer, Manifest, MuscleInfo, RegionId, Side } from '../data/manifest'

export type SideShow = 'both' | Side

/** Single source of truth for what is shown. Group / layer / region toggles are bulk edits of `muscleOff`. */
export interface VisState {
  muscleOff: ReadonlySet<string> // muscle ids switched off
  side: SideShow
  bones: boolean // all bones
  contextBones: boolean // skull, hand, foot, cervical spine ... (only matters when bones is on)
  region: RegionId | null // when set, only structures belonging to this region are shown
}

export const defaultVis = (): VisState => ({ muscleOff: new Set(), side: 'both', bones: true, contextBones: true, region: null })

export type Tri = 'on' | 'off' | 'mixed'

export function triState(v: VisState, ids: string[]): Tri {
  if (ids.length === 0) return 'off'
  const on = ids.filter((id) => !v.muscleOff.has(id)).length
  return on === ids.length ? 'on' : on === 0 ? 'off' : 'mixed'
}

export function setMusclesOn(v: VisState, ids: string[], on: boolean): VisState {
  const off = new Set(v.muscleOff)
  for (const id of ids) on ? off.delete(id) : off.add(id)
  return { ...v, muscleOff: off }
}

/** Clicking a tri-state box: anything but fully-on becomes fully on, fully-on becomes off. */
export function toggleMuscles(v: VisState, ids: string[]): VisState {
  return setMusclesOn(v, ids, triState(v, ids) !== 'on')
}

export function isolate(v: VisState, m: Manifest, keep: string[]): VisState {
  const k = new Set(keep)
  return { ...v, muscleOff: new Set(m.muscles.map((x) => x.id).filter((id) => !k.has(id))) }
}

export const showAll = (v: VisState): VisState => ({ ...v, muscleOff: new Set() })
export const hideAll = (v: VisState, m: Manifest): VisState => ({ ...v, muscleOff: new Set(m.muscles.map((x) => x.id)) })

export function musclesOfLayer(m: Manifest, layer: Layer): string[] {
  return m.muscles.filter((x) => x.layer === layer).map((x) => x.id)
}

export function musclesOfRegion(m: Manifest, region: RegionId): MuscleInfo[] {
  return m.muscles.filter((x) => x.regions.includes(region))
}

/** region -> group -> muscles, in manifest order. */
export function regionTree(m: Manifest, region: RegionId): { group: string; muscles: MuscleInfo[] }[] {
  const out = new Map<string, MuscleInfo[]>()
  for (const mu of musclesOfRegion(m, region)) {
    if (!out.has(mu.group)) out.set(mu.group, [])
    out.get(mu.group)!.push(mu)
  }
  return [...out].map(([group, muscles]) => ({ group, muscles }))
}

const sideHidden = (v: VisState, side: Side | ''): boolean => v.side !== 'both' && side !== '' && side !== v.side

/** Node names to hide. */
export function computeHidden(m: Manifest, v: VisState): Set<string> {
  const hidden = new Set<string>()
  for (const mu of m.muscles) {
    for (const s of ['r', 'l'] as Side[]) {
      if (v.muscleOff.has(mu.id) || sideHidden(v, s) || (v.region && !mu.regions.includes(v.region))) hidden.add(mu.nodes[s])
    }
  }
  for (const b of m.bones) {
    for (const [s, node] of Object.entries(b.nodes)) {
      if (!v.bones || (b.context && !v.contextBones) || sideHidden(v, s as Side | '') || (v.region && !b.regions.includes(v.region))) {
        hidden.add(node)
      }
    }
  }
  return hidden
}
