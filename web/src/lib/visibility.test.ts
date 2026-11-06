import { describe, expect, it } from 'vitest'
import type { Manifest } from '../data/manifest'
import { filterMuscles, muscleMatches } from './search'
import {
  computeHidden, defaultVis, hideAll, isolate, musclesOfLayer, regionTree, setMusclesOn, showAll, toggleMuscles, triState,
} from './visibility'

const nm = (zh: string, en: string, la: string) => ({ zh, en, la })
const mu = (id: string, layer: string, group: string, regions: string[], name = nm(id, id, id)) => ({
  id, layer, group, regions, name, nodes: { r: `m_${id}_r`, l: `m_${id}_l` },
})
const manifest = {
  groups: { cuff: { zh: '肩袖', en: 'Rotator cuff' }, glut: { zh: '臀肌群', en: 'Gluteal' } },
  muscles: [
    mu('supraspinatus', 'deep', 'cuff', ['shoulder'], nm('冈上肌', 'Supraspinatus', 'M. supraspinatus')),
    mu('infraspinatus', 'deep', 'cuff', ['shoulder']),
    mu('deltoid', 'superficial', 'cuff', ['shoulder']),
    mu('gluteus_medius', 'intermediate', 'glut', ['hip'], nm('臀中肌', 'Gluteus medius', 'M. gluteus medius')),
    mu('rectus_femoris', 'superficial', 'glut', ['hip', 'knee']),
  ],
  bones: [
    { id: 'scapula', nodes: { r: 'b_scapula_r', l: 'b_scapula_l' }, context: false, regions: ['shoulder'] },
    { id: 'sacrum', nodes: { '': 'b_sacrum' }, context: false, regions: ['hip', 'lumbar'] },
    { id: 'skull', nodes: { '': 'b_skull' }, context: true, regions: ['shoulder'] },
  ],
} as unknown as Manifest

describe('visibility', () => {
  it('shows everything by default', () => {
    expect(computeHidden(manifest, defaultVis()).size).toBe(0)
  })

  it('hides both sides of a switched-off muscle', () => {
    const v = setMusclesOn(defaultVis(), ['supraspinatus'], false)
    expect([...computeHidden(manifest, v)].sort()).toEqual(['m_supraspinatus_l', 'm_supraspinatus_r'])
  })

  it('side filter hides the other side of muscles and sided bones, never midline bones', () => {
    const h = computeHidden(manifest, { ...defaultVis(), side: 'r' })
    expect(h.has('m_deltoid_l')).toBe(true)
    expect(h.has('m_deltoid_r')).toBe(false)
    expect(h.has('b_scapula_l')).toBe(true)
    expect(h.has('b_sacrum')).toBe(false)
  })

  it('bone switches', () => {
    expect(computeHidden(manifest, { ...defaultVis(), contextBones: false }).has('b_skull')).toBe(true)
    expect(computeHidden(manifest, { ...defaultVis(), contextBones: false }).has('b_scapula_r')).toBe(false)
    const none = computeHidden(manifest, { ...defaultVis(), bones: false })
    expect(['b_scapula_r', 'b_scapula_l', 'b_sacrum', 'b_skull'].every((n) => none.has(n))).toBe(true)
  })

  it('tri-state follows the members and toggling cycles to fully on, then off', () => {
    const ids = ['supraspinatus', 'infraspinatus']
    let v = defaultVis()
    expect(triState(v, ids)).toBe('on')
    v = setMusclesOn(v, ['infraspinatus'], false)
    expect(triState(v, ids)).toBe('mixed')
    v = toggleMuscles(v, ids)
    expect(triState(v, ids)).toBe('on')
    v = toggleMuscles(v, ids)
    expect(triState(v, ids)).toBe('off')
    expect(triState(v, [])).toBe('off')
  })

  it('isolate keeps only the chosen muscles; showAll / hideAll', () => {
    const v = isolate(defaultVis(), manifest, ['gluteus_medius'])
    const h = computeHidden(manifest, v)
    expect(h.has('m_gluteus_medius_r')).toBe(false)
    expect(h.has('m_supraspinatus_r')).toBe(true)
    expect(v.muscleOff.size).toBe(manifest.muscles.length - 1)
    expect(showAll(v).muscleOff.size).toBe(0)
    expect(hideAll(defaultVis(), manifest).muscleOff.size).toBe(manifest.muscles.length)
  })

  it('layer switches are bulk edits (turning off the superficial layer leaves the cuff)', () => {
    const v = setMusclesOn(defaultVis(), musclesOfLayer(manifest, 'superficial'), false)
    const h = computeHidden(manifest, v)
    expect(h.has('m_deltoid_r')).toBe(true)
    expect(h.has('m_supraspinatus_r')).toBe(false)
    expect(triState(v, musclesOfLayer(manifest, 'superficial'))).toBe('off')
  })

  it('builds the region -> group tree; multi-region muscles appear in each region', () => {
    expect(regionTree(manifest, 'shoulder').map((g) => [g.group, g.muscles.length])).toEqual([['cuff', 3]])
    expect(regionTree(manifest, 'knee')[0].muscles[0].id).toBe('rectus_femoris')
    expect(regionTree(manifest, 'hip')[0].muscles.map((m) => m.id)).toEqual(['gluteus_medius', 'rectus_femoris'])
  })
})

describe('region focus', () => {
  it('hides muscles and bones that do not belong to the region (multi-region muscles stay)', () => {
    const m = {
      ...manifest,
      muscles: manifest.muscles.map((x) => ({ ...x })),
      bones: [
        { id: 'scapula', nodes: { r: 'b_scapula_r', l: 'b_scapula_l' }, context: false, regions: ['shoulder'] },
        { id: 'femur', nodes: { r: 'b_femur_r', l: 'b_femur_l' }, context: false, regions: ['hip', 'knee'] },
      ],
    } as unknown as Manifest
    const h = computeHidden(m, { ...defaultVis(), region: 'knee' })
    expect(h.has('m_rectus_femoris_r')).toBe(false) // hip + knee
    expect(h.has('m_gluteus_medius_r')).toBe(true) // hip only
    expect(h.has('m_supraspinatus_r')).toBe(true)
    expect(h.has('b_femur_r')).toBe(false)
    expect(h.has('b_scapula_r')).toBe(true)
    expect(computeHidden(m, { ...defaultVis(), region: null }).size).toBe(0)
  })
  it('composes with the layer and side switches', () => {
    const v = setMusclesOn({ ...defaultVis(), region: 'shoulder', side: 'r' }, ['deltoid'], false)
    const h = computeHidden(manifest, v)
    expect(h.has('m_deltoid_r')).toBe(true) // switched off
    expect(h.has('m_infraspinatus_l')).toBe(true) // other side
    expect(h.has('m_infraspinatus_r')).toBe(false)
  })
})

describe('search', () => {
  const [supra, , , glut] = manifest.muscles
  it('matches Chinese, English and Latin names, case-insensitively', () => {
    expect(muscleMatches(glut, '臀中')).toBe(true)
    expect(muscleMatches(glut, 'GLUTEUS MED')).toBe(true)
    expect(muscleMatches(glut, 'm. gluteus')).toBe(true)
    expect(muscleMatches(supra, '臀中')).toBe(false)
  })
  it('matches group names and ids; empty query matches everything', () => {
    expect(muscleMatches(supra, '肩袖', manifest.groups.cuff)).toBe(true)
    expect(muscleMatches(supra, 'rotator', manifest.groups.cuff)).toBe(true)
    expect(muscleMatches(supra, '')).toBe(true)
  })
  it('filters the list', () => {
    expect(filterMuscles(manifest.muscles, '臀中', manifest.groups).map((m) => m.id)).toEqual(['gluteus_medius'])
    expect(filterMuscles(manifest.muscles, 'spinatus', manifest.groups).map((m) => m.id)).toEqual(['supraspinatus', 'infraspinatus'])
  })
})
