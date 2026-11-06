import { Quaternion, Vector3 } from 'three'
import type { SkeletonDef } from '../data/manifest'

/** Joint angles in degrees, keyed by DOF name (`r_knee_flexion`, `trunk_flexion`, ...). Missing = 0. */
export type Pose = Readonly<Record<string, number>>

const DEG = Math.PI / 180
const AXIS_EPS = 1e-12

function axisAngle(axis: readonly number[], angleRad: number): Quaternion {
  const v = new Vector3(axis[0], axis[1], axis[2])
  if (v.lengthSq() < AXIS_EPS || angleRad === 0) return new Quaternion()
  return new Quaternion().setFromAxisAngle(v.normalize(), angleRad)
}

function findBody(skel: SkeletonDef, id: string) {
  const body = skel.bodies.find((b) => b.id === id)
  if (!body) throw new Error(`unknown body ${id}`)
  return body
}

/** The rotation the pose asks for, before any change of reference frame (mirrors pipeline/skeleton.py own_rotation). */
function ownQuaternion(skel: SkeletonDef, bodyId: string, pose: Pose): Quaternion {
  const body = findBody(skel, bodyId)
  const q = new Quaternion()
  if (body.trunk) {
    // composition order: rotation(y) . lateral(z) . flexion(x)
    for (const name of ['trunk_rotation', 'trunk_lateral', 'trunk_flexion']) {
      const d = skel.trunkDofs.find((t) => t.name === name)
      const share = d?.shares[bodyId]
      if (d && share !== undefined) q.multiply(axisAngle(d.axis, (pose[name] ?? 0) * d.sign * share * DEG))
    }
  }
  for (const d of body.dofs) q.multiply(axisAngle(d.axis, (pose[d.name] ?? 0) * d.sign * d.share * DEG))
  return q
}

/**
 * Local rotation of one body relative to its parent (mirrors pipeline/skeleton.py `body_rotation`).
 * With `frameFrom`, the body's DOFs act in that ancestor's frame, i.e. the rotations of the bodies in between
 * are divided out; this makes shoulder angles humerothoracic.
 */
export function bodyQuaternion(skel: SkeletonDef, bodyId: string, pose: Pose): Quaternion {
  const body = findBody(skel, bodyId)
  const q = ownQuaternion(skel, bodyId, pose)
  if (body.frameFrom) {
    const between: string[] = []
    for (let cur = body.parent; cur && cur !== body.frameFrom; cur = findBody(skel, cur).parent) between.push(cur)
    const comp = new Quaternion()
    for (const id of between.reverse()) comp.multiply(ownQuaternion(skel, id, pose))
    return comp.invert().multiply(q)
  }
  return q
}

export function poseQuaternions(skel: SkeletonDef, pose: Pose): Map<string, Quaternion> {
  return new Map(skel.bodies.map((b) => [b.id, bodyQuaternion(skel, b.id, pose)]))
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
