import { describe, expect, it } from 'vitest'
import manifest from '../../public/data/manifest.json'
import type { LengthPaths, MotionInfo, SkeletonDef } from '../data/manifest'
import { lengthRatios, skinMatrices } from './lengths'
import { direction, directionFor, interpolatePose, pingPong, resolveEntry, roleLists, rolesFor } from './motions'
import golden from './kinematics.golden.json'
import { classify, intensity, strainColor } from './strain'

const motions = manifest.motions as unknown as MotionInfo[]
const skel = manifest.skeleton as unknown as SkeletonDef
const paths = manifest.lengthPaths as unknown as LengthPaths
const motion = (id: string) => motions.find((m) => m.id === id)!

describe('keyframe interpolation', () => {
  it('shoulder abduction follows the scapulohumeral rhythm (1 deg of scapular rotation per 3 deg after 30)', () => {
    const m = motion('shoulder_abduction')
    expect(interpolatePose(m, 0).r_scapula_upward).toBe(0)
    expect(interpolatePose(m, 30).r_scapula_upward).toBe(0)
    for (const a of [60, 90, 150, 180]) expect(interpolatePose(m, a).r_scapula_upward).toBeCloseTo((a - 30) / 3, 0)
    expect(interpolatePose(m, 123).r_shoulder_abduction).toBeCloseTo(123)
  })
  it('is linear between keyframes and clamped outside', () => {
    const m = motion('knee_flexion')
    expect(interpolatePose(m, 70).r_knee_flexion).toBeCloseTo(70)
    expect(interpolatePose(m, -9).r_knee_flexion).toBe(0)
    expect(interpolatePose(m, 999).r_knee_flexion).toBe(140)
  })
  it('handles an inner keyframe for negative parameters (shoulder flexion/extension)', () => {
    const m = motion('shoulder_flexion')
    expect(interpolatePose(m, -30).r_shoulder_flexion).toBeCloseTo(-30)
    expect(interpolatePose(m, 15).r_clavicle_elevation).toBeCloseTo(1.5)
  })
})

describe('directions and roles', () => {
  it('sign of the parameter selects the direction', () => {
    expect(directionFor(motion('shoulder_flexion'), -5)).toBe('neg')
    expect(directionFor(motion('shoulder_flexion'), 5)).toBe('pos')
    expect(directionFor(motion('knee_flexion'), -5)).toBe('pos') // no neg direction
    expect(direction(motion('hip_flexion'), -10).label.zh).toBe('伸')
  })
  it('limb motions only mark right-side muscles', () => {
    const r = rolesFor(motion('shoulder_abduction'), 90)
    expect(r.get('deltoid_acromial:r')).toBe('agonist')
    expect(r.get('latissimus_dorsi:r')).toBe('antagonist')
    expect(r.has('deltoid_acromial:l')).toBe(false)
  })
  it('trunk motions resolve @ipsi / @contra from the direction', () => {
    const right = rolesFor(motion('trunk_lateral'), 20)
    expect(right.get('quadratus_lumborum:r')).toBe('agonist')
    expect(right.get('quadratus_lumborum:l')).toBe('antagonist')
    const left = rolesFor(motion('trunk_lateral'), -20)
    expect(left.get('quadratus_lumborum:l')).toBe('agonist')
    expect(left.get('quadratus_lumborum:r')).toBe('antagonist')
    expect(right.get('multifidus_lumborum:r')).toBe('stabilizer')
    expect(right.get('multifidus_lumborum:l')).toBe('stabilizer')
  })
  it('resolveEntry', () => {
    expect(resolveEntry('x@contra', 'trunk', 'l')).toEqual({ id: 'x', sides: ['r'] })
    expect(resolveEntry('x', 'trunk', undefined).sides).toEqual(['r', 'l'])
    expect(resolveEntry('x', 'right', undefined)).toEqual({ id: 'x', sides: ['r'] })
  })
  it('role lists keep the table order for the sidebar', () => {
    const l = roleLists(motion('shoulder_abduction'), 45)
    expect(l.agonist.map((e) => e.id)).toEqual(['deltoid_acromial', 'supraspinatus'])
    expect(l.antagonist.length).toBeGreaterThan(2)
  })
  it('ping-pong visits both ends', () => {
    expect(pingPong(0, 100, 0, 4)).toBeCloseTo(0)
    expect(pingPong(0, 100, 2, 4)).toBeCloseTo(100)
    expect(pingPong(0, 100, 1, 4)).toBeCloseTo(50)
    expect(pingPong(0, 100, 4, 4)).toBeCloseTo(0)
  })
})

describe('colour mapping', () => {
  it('classifies shortening, lengthening and no change', () => {
    expect(classify(0.8)).toBe('shortened')
    expect(classify(1.2)).toBe('lengthened')
    expect(classify(1.01)).toBe('neutral')
    expect(classify(0.99)).toBe('neutral')
  })
  it('saturates at +-25 % and is grey inside the band', () => {
    expect(intensity(1.0)).toBe(0)
    expect(intensity(1.02)).toBe(0)
    expect(intensity(0.5)).toBe(1)
    expect(intensity(1.25)).toBe(1)
    expect(strainColor(1.0)).toBe('#9a9a9a')
    expect(strainColor(0.7)).toBe('#e02a2a') // red
    expect(strainColor(1.4)).toBe('#2a6ae8') // blue
  })
  it('is monotone: the further from 1 the more saturated', () => {
    const red = (r: number) => parseInt(strainColor(r).slice(1, 3), 16) - parseInt(strainColor(r).slice(5, 7), 16)
    expect(red(0.8)).toBeGreaterThan(red(0.9))
    expect(red(0.9)).toBeGreaterThan(red(0.97))
  })
})

describe('muscle length ratios (viewer implementation vs the anatomy expectations)', () => {
  const at = (id: string, value: number, muscle: string, side = 'r') =>
    lengthRatios(skel, paths, interpolatePose(motion(id), value)).get(`${muscle}:${side}`)!

  it('rest pose gives exactly 1 for every muscle', () => {
    const r = lengthRatios(skel, paths, {})
    expect(r.size).toBe(146)
    for (const v of r.values()) expect(v).toBeCloseTo(1, 9)
  })
  it('skin matrices are the identity at rest', () => {
    for (const m of skinMatrices(skel, {})) expect(m.elements.map((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0))).every((d) => d < 1e-9)).toBe(true)
  })
  it('knee flexion: hamstrings shorten, quadriceps lengthen (the consistency check from the plan)', () => {
    for (const m of ['semitendinosus', 'semimembranosus', 'biceps_femoris_long']) expect(at('knee_flexion', 140, m)).toBeLessThan(0.9)
    for (const m of ['rectus_femoris', 'vastus_lateralis', 'vastus_medialis']) expect(at('knee_flexion', 140, m)).toBeGreaterThan(1.05)
  })
  it('shoulder abduction: deltoid and supraspinatus shorten, latissimus and pectoralis lengthen', () => {
    expect(at('shoulder_abduction', 90, 'deltoid_acromial')).toBeLessThan(0.9)
    expect(at('shoulder_abduction', 90, 'supraspinatus')).toBeLessThan(0.9)
    expect(at('shoulder_abduction', 90, 'latissimus_dorsi')).toBeGreaterThan(1.1)
    expect(at('shoulder_abduction', 90, 'pectoralis_major_sternocostal')).toBeGreaterThan(1.1)
  })
  it('trunk side bend: the bent side shortens, the opposite side lengthens', () => {
    expect(at('trunk_lateral', 30, 'quadratus_lumborum', 'r')).toBeLessThan(0.9)
    expect(at('trunk_lateral', 30, 'quadratus_lumborum', 'l')).toBeGreaterThan(1.1)
  })
  it('limb motions leave the other side alone', () => {
    expect(at('knee_flexion', 140, 'semitendinosus', 'l')).toBeCloseTo(1, 9)
  })
})

describe('agreement with the Python pipeline (golden length ratios)', () => {
  for (const [name, g] of Object.entries(golden.ratios as Record<string, { pose: Record<string, number>; values: Record<string, number> }>)) {
    it(`pose "${name}": all 146 muscle ratios equal the Python result`, () => {
      const got = lengthRatios(skel, paths, g.pose)
      expect(got.size).toBe(Object.keys(g.values).length)
      for (const [key, expected] of Object.entries(g.values)) // the manifest stores path terms rounded to 5 decimals (0.01 mm), so ratios agree to ~1e-4
      expect(Math.abs(got.get(key)! - expected), key).toBeLessThan(2e-4)
    })
  }
})
