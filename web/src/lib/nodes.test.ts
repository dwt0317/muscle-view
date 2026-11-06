import { describe, expect, it } from 'vitest'
import type { Manifest } from '../data/manifest'
import { buildNodeIndex } from './nodes'

const l3 = { zh: 'a', en: 'b', la: 'c' }
const l2 = { zh: 'a', en: 'b' }
const manifest = {
  muscles: [{
    id: 'supraspinatus', nodes: { r: 'm_supraspinatus_r', l: 'm_supraspinatus_l' }, regions: ['shoulder'],
    group: 'g', layer: 'deep', kind: 'muscle', name: l3, origin: l2, insertion: l2, function: l2,
    originBones: [], insertionBones: [], tendinous: false, fma: { r: null, l: null },
  }],
  bones: [
    { id: 'scapula', nodes: { r: 'b_scapula_r', l: 'b_scapula_l' }, sided: true, regions: [], name: l3, context: false, body: 'scapula' },
    { id: 'sacrum', nodes: { '': 'b_sacrum' }, sided: false, regions: [], name: l3, context: false, body: 'pelvis' },
  ],
} as unknown as Manifest

describe('buildNodeIndex', () => {
  const idx = buildNodeIndex(manifest)
  it('indexes both sides of muscles and bones', () => {
    expect(idx.get('m_supraspinatus_l')).toMatchObject({ kind: 'muscle', id: 'supraspinatus', side: 'l' })
    expect(idx.get('b_scapula_r')).toMatchObject({ kind: 'bone', id: 'scapula', side: 'r' })
  })
  it('midline bones have no side', () => {
    expect(idx.get('b_sacrum')?.side).toBeNull()
  })
  it('contains exactly the expected nodes', () => {
    expect([...idx.keys()].sort()).toEqual(['b_sacrum', 'b_scapula_l', 'b_scapula_r', 'm_supraspinatus_l', 'm_supraspinatus_r'])
  })
})
