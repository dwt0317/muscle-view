import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { SkeletonDef } from '../data/manifest'
import manifest from '../../public/data/manifest.json'
import golden from './kinematics.golden.json'
import { bodyQuaternion, poseQuaternions } from './kinematics'

// A miniature skeleton, same conventions as anatomy/skeleton.yaml
const skel: SkeletonDef = {
  joints: ['pelvis', 'l5', 'thorax', 'femur.r', 'tibia.r', 'femur.l'],
  bodies: [
    { id: 'pelvis', parent: null, center: [0, 0, 0], trunk: false, dofs: [] },
    { id: 'l5', parent: 'pelvis', center: [0, 0.96, 0], trunk: true, dofs: [] },
    { id: 'thorax', parent: 'l5', center: [0, 1.13, 0], trunk: true, dofs: [] },
    { id: 'femur.r', parent: 'pelvis', center: [-0.08, 0.86, 0], trunk: false, dofs: [
      { name: 'r_hip_flexion', axis: [1, 0, 0], sign: -1, share: 1 },
      { name: 'r_hip_abduction', axis: [0, 0, 1], sign: -1, share: 1 }] },
    { id: 'tibia.r', parent: 'femur.r', center: [-0.07, 0.46, -0.03], trunk: false, dofs: [
      { name: 'r_knee_flexion', axis: [1, 0, 0], sign: 1, share: 1 }] },
    { id: 'femur.l', parent: 'pelvis', center: [0.08, 0.86, 0], trunk: false, dofs: [
      { name: 'l_hip_abduction', axis: [0, 0, -1], sign: -1, share: 1 }] },
  ],
  trunkDofs: [
    { name: 'trunk_flexion', axis: [1, 0, 0], sign: 1, shares: { l5: 0.6, thorax: 0.4 } },
    { name: 'trunk_lateral', axis: [0, 0, 1], sign: 1, shares: { l5: 0.5, thorax: 0.5 } },
    { name: 'trunk_rotation', axis: [0, 1, 0], sign: -1, shares: { l5: 0.5, thorax: 0.5 } },
  ],
}

const rotate = (b: string, pose: Record<string, number>, v: [number, number, number]) =>
  new Vector3(...v).applyQuaternion(bodyQuaternion(skel, b, pose)).toArray()

describe('kinematics conventions', () => {
  it('rest pose is the identity', () => {
    for (const q of poseQuaternions(skel, {}).values()) expect(q.w).toBeCloseTo(1)
  })

  it('knee flexion swings the shank backwards (a point below the knee moves to -Z)', () => {
    const [x, y, z] = rotate('tibia.r', { r_knee_flexion: 90 }, [0, -1, 0])
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(-1)
  })

  it('hip flexion swings the thigh forwards (+Z); abduction moves the right leg to -X', () => {
    expect(rotate('femur.r', { r_hip_flexion: 90 }, [0, -1, 0])[2]).toBeCloseTo(1)
    expect(rotate('femur.r', { r_hip_abduction: 30 }, [0, -1, 0])[0]).toBeLessThan(-0.45)
  })

  it('the left side is the mirror image: the same positive angle abducts towards +X', () => {
    const r = rotate('femur.r', { r_hip_abduction: 30 }, [0, -1, 0])
    const l = rotate('femur.l', { l_hip_abduction: 30 }, [0, -1, 0])
    expect(l[0]).toBeCloseTo(-r[0])
    expect(l[1]).toBeCloseTo(r[1])
  })

  it('trunk flexion moves the upper body forward and is shared between segments', () => {
    const p = { trunk_flexion: 30 }
    const l5 = bodyQuaternion(skel, 'l5', p)
    const th = bodyQuaternion(skel, 'thorax', p)
    expect(new Vector3(0, 1, 0).applyQuaternion(l5).z).toBeGreaterThan(0)
    expect(l5.angleTo(bodyQuaternion(skel, 'pelvis', p))).toBeCloseTo((30 * 0.6 * Math.PI) / 180)
    expect(th.angleTo(bodyQuaternion(skel, 'pelvis', p))).toBeCloseTo((30 * 0.4 * Math.PI) / 180)
  })

  it('trunk lateral flexion is positive to the right (-X) and rotation positive to the right', () => {
    expect(new Vector3(0, 1, 0).applyQuaternion(bodyQuaternion(skel, 'thorax', { trunk_lateral: 20 })).x).toBeLessThan(0)
    expect(new Vector3(0, 0, 1).applyQuaternion(bodyQuaternion(skel, 'thorax', { trunk_rotation: 20 })).x).toBeLessThan(0)
  })

  it('throws for an unknown body', () => {
    expect(() => bodyQuaternion(skel, 'nope', {})).toThrow()
  })
})

describe('agreement with the Python pipeline (golden vectors)', () => {
  const real = manifest.skeleton as unknown as SkeletonDef

  it('has 19 bodies and the exported pose keys', () => {
    expect(real.bodies).toHaveLength(19)
    expect(Object.keys(golden.poses)).toContain('trunk')
  })

  for (const [name, g] of Object.entries(golden.poses)) {
    it(`pose "${name}": every body's local rotation equals the Python result`, () => {
      const q = poseQuaternions(real, g.pose)
      for (const [bid, expected] of Object.entries(g.quaternions as Record<string, number[]>)) {
        const got = q.get(bid)!
        // q and -q are the same rotation
        const sign = got.w * expected[3] + got.x * expected[0] + got.y * expected[1] + got.z * expected[2] < 0 ? -1 : 1
        expect(got.x * sign).toBeCloseTo(expected[0], 5)
        expect(got.y * sign).toBeCloseTo(expected[1], 5)
        expect(got.z * sign).toBeCloseTo(expected[2], 5)
        expect(got.w * sign).toBeCloseTo(expected[3], 5)
      }
    })
  }
})
