import { describe, expect, it } from 'vitest'
import { ATTACH_GHOST_OPACITY, COLORS, computeStyle } from './style'
import type { NodeRef } from './nodes'

const muscle = { node: 'm_a_r', kind: 'muscle', id: 'a', side: 'r', muscle: { kind: 'muscle' } } as unknown as NodeRef
const fascia = { node: 'm_f_r', kind: 'muscle', id: 'f', side: 'r', muscle: { kind: 'fascia' } } as unknown as NodeRef
const bone = { node: 'b_x', kind: 'bone', id: 'x', side: null } as unknown as NodeRef
const none = { selected: null, hovered: null, hidden: new Set<string>() }

const landmark = { node: 'lm_asis_r', kind: 'landmark', id: 'asis', side: 'r' } as unknown as NodeRef

describe('computeStyle', () => {
  it('uses a base colour per kind', () => {
    expect(computeStyle(muscle, none).color).toBe(COLORS.muscle)
    expect(computeStyle(fascia, none).color).toBe(COLORS.fascia)
    expect(computeStyle(bone, none).color).toBe(COLORS.bone)
  })
  it('highlights hover and selection, selection wins', () => {
    expect(computeStyle(muscle, { ...none, hovered: 'm_a_r' }).emissive).toBe(COLORS.hover)
    expect(computeStyle(muscle, { ...none, selected: 'm_a_r' }).emissive).toBe(COLORS.select)
    const both = computeStyle(muscle, { ...none, selected: 'm_a_r', hovered: 'm_a_r' })
    expect(both.emissive).toBe(COLORS.select)
  })
  it('does not highlight other nodes', () => {
    expect(computeStyle(bone, { ...none, selected: 'm_a_r' }).emissiveIntensity).toBe(0)
  })
  it('hidden nodes are invisible', () => {
    expect(computeStyle(muscle, { ...none, hidden: new Set(['m_a_r']) }).visible).toBe(false)
    expect(computeStyle(bone, { ...none, hidden: new Set(['m_a_r']) }).visible).toBe(true)
  })
  it('landmark markers are yellow and follow the showLandmarks switch, not the muscle hidden set', () => {
    expect(computeStyle(landmark, none).visible).toBe(false)
    const on = computeStyle(landmark, { ...none, showLandmarks: true, hidden: new Set(['lm_asis_r']) })
    expect(on.visible).toBe(true)
    expect(on.color).toBe(COLORS.landmark)
  })

  it('attachment mode keeps bones, ghosts the selected muscle and hides all other muscles', () => {
    const am = { ...none, attachMode: true, selected: 'm_a_r' }
    expect(computeStyle(bone, am)).toMatchObject({ visible: true, opacity: 1 })
    expect(computeStyle(muscle, am)).toMatchObject({ visible: true, opacity: ATTACH_GHOST_OPACITY })
    expect(computeStyle(fascia, am).visible).toBe(false)
    expect(computeStyle(muscle, { ...none, attachMode: true }).visible).toBe(false)
    expect(computeStyle(muscle, none)).toMatchObject({ visible: true, opacity: 1 })
  })
  it('a motion colours muscles by length change but never bones, fascia or landmarks', () => {
    const strain = new Map([['m_a_r', '#e02a2a'], ['m_f_r', '#2a6ae8'], ['b_x', '#2a6ae8']])
    const st = { ...none, strainColors: strain }
    expect(computeStyle(muscle, st).color).toBe('#e02a2a')
    expect(computeStyle(fascia, st).color).toBe(COLORS.fascia)
    expect(computeStyle(bone, st).color).toBe(COLORS.bone)
    expect(computeStyle(muscle, none).color).toBe(COLORS.muscle)
  })
  it('with a region focus only the landmarks of that region are shown', () => {
    const lm = { node: 'lm_asis_r', kind: 'landmark', id: 'asis', side: 'r', landmark: { regions: ['hip', 'lumbar'] } } as unknown as NodeRef
    expect(computeStyle(lm, { ...none, showLandmarks: true, region: 'hip' }).visible).toBe(true)
    expect(computeStyle(lm, { ...none, showLandmarks: true, region: 'knee' }).visible).toBe(false)
    expect(computeStyle(lm, { ...none, showLandmarks: true, region: null }).visible).toBe(true)
  })
})
