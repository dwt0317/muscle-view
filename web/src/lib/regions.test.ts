import { describe, expect, it } from 'vitest'
import manifest from '../../public/data/manifest.json'
import type { Manifest } from '../data/manifest'
import { fitDistance, regionNodes, REGION_VIEW } from './regions'

const m = manifest as unknown as Manifest

describe('region nodes', () => {
  it('collects muscles of both sides and the non-context bones of the region', () => {
    const knee = regionNodes(m, 'knee')
    expect(knee).toContain('m_semitendinosus_r')
    expect(knee).toContain('m_semitendinosus_l')
    expect(knee).toContain('b_patella_r')
    expect(knee).toContain('b_femur_l')
    expect(knee).not.toContain('m_supraspinatus_r')
    expect(knee).not.toContain('b_foot_r') // context bone
  })
  it('a side filter keeps midline bones', () => {
    const lum = regionNodes(m, 'lumbar', 'r')
    expect(lum).toContain('m_quadratus_lumborum_r')
    expect(lum).not.toContain('m_quadratus_lumborum_l')
    expect(lum).toContain('b_vertebra_l3') // midline
  })
  it('every region has muscles and bones, and a camera direction', () => {
    for (const r of ['shoulder', 'hip', 'knee', 'lumbar'] as const) {
      expect(regionNodes(m, r).filter((n) => n.startsWith('m_')).length).toBeGreaterThan(10)
      expect(regionNodes(m, r).filter((n) => n.startsWith('b_')).length).toBeGreaterThan(2)
      expect(Math.hypot(...REGION_VIEW[r].dir)).toBeGreaterThan(0.9)
    }
  })
  it('the lumbar view comes from behind, the others from the front', () => {
    expect(REGION_VIEW.lumbar.dir[2]).toBeLessThan(0)
    for (const r of ['shoulder', 'hip', 'knee'] as const) expect(REGION_VIEW[r].dir[2]).toBeGreaterThan(0)
  })
})

describe('fitDistance', () => {
  it('grows with the size of the box and shrinks for a wide viewport', () => {
    const small = fitDistance([0.2, 0.3, 0.1], 35, 1.5)
    const big = fitDistance([0.4, 0.6, 0.2], 35, 1.5)
    expect(big).toBeGreaterThan(small * 1.8)
    expect(fitDistance([0.5, 0.3, 0.1], 35, 3)).toBeLessThan(fitDistance([0.5, 0.3, 0.1], 35, 1))
  })
})
