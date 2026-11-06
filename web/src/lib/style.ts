import type { NodeRef } from './nodes'

export interface StyleState {
  selected: string | null
  hovered: string | null
  hidden: ReadonlySet<string>
  showLandmarks?: boolean
  region?: string | null
  attachMode?: boolean // only bones + the selected muscle's outline stay visible
  strainColors?: ReadonlyMap<string, string> // node name -> colour while a motion is shown (length change)
}

export interface MeshStyle {
  visible: boolean
  color: string
  emissive: string
  emissiveIntensity: number
  opacity: number
}

export const ATTACH_GHOST_OPACITY = 0.3

export const COLORS = {
  muscle: '#b8453f',
  fascia: '#c9a46a',
  bone: '#e9e2cf',
  landmark: '#ffd23f',
  select: '#ff8a1f',
  hover: '#3b9bff',
}

/** Pure per-mesh style resolution; extended by later features (motion colours, attachments, review). */
export function computeStyle(ref: NodeRef, st: StyleState): MeshStyle {
  const base =
    ref.kind === 'bone'
      ? COLORS.bone
      : ref.kind === 'landmark'
        ? COLORS.landmark
        : ref.muscle?.kind === 'fascia'
          ? COLORS.fascia
          : COLORS.muscle
  const style: MeshStyle = {
    visible:
      ref.kind === 'landmark'
        ? !!st.showLandmarks && (!st.region || !!ref.landmark?.regions.includes(st.region as never))
        : !st.hidden.has(ref.node),
    color: base,
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
  }
  const strain = ref.kind === 'muscle' && ref.muscle?.kind === 'muscle' ? st.strainColors?.get(ref.node) : undefined
  if (strain) style.color = strain
  if (st.attachMode && ref.kind === 'muscle') {
    if (st.selected === ref.node) style.opacity = ATTACH_GHOST_OPACITY
    else style.visible = false
  }
  if (st.selected === ref.node) {
    style.emissive = COLORS.select
    style.emissiveIntensity = 0.55
  } else if (st.hovered === ref.node) {
    style.emissive = COLORS.hover
    style.emissiveIntensity = 0.35
  }
  return style
}
