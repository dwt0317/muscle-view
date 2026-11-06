import type { BoneInfo, LandmarkInfo, LandmarkItem, Manifest, MuscleInfo, Side } from '../data/manifest'

export interface NodeRef {
  node: string
  kind: 'muscle' | 'bone' | 'landmark'
  id: string
  side: Side | null
  muscle?: MuscleInfo
  bone?: BoneInfo
  landmark?: LandmarkInfo
  item?: LandmarkItem
}

export function landmarkNode(id: string, side: string): string {
  return side ? `lm_${id}_${side}` : `lm_${id}`
}

/** glTF node name (or marker name) -> what it is. */
export function buildNodeIndex(m: Manifest): Map<string, NodeRef> {
  const out = new Map<string, NodeRef>()
  for (const mu of m.muscles) {
    for (const s of ['r', 'l'] as Side[]) {
      out.set(mu.nodes[s], { node: mu.nodes[s], kind: 'muscle', id: mu.id, side: s, muscle: mu })
    }
  }
  for (const b of m.bones) {
    for (const [s, node] of Object.entries(b.nodes)) {
      out.set(node, { node, kind: 'bone', id: b.id, side: (s || null) as Side | null, bone: b })
    }
  }
  for (const lm of m.landmarks ?? []) {
    for (const [s, item] of Object.entries(lm.items)) {
      const node = landmarkNode(lm.id, s)
      out.set(node, { node, kind: 'landmark', id: lm.id, side: (s || null) as Side | null, landmark: lm, item })
    }
  }
  return out
}
