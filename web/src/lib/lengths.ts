import { Matrix4, Vector3 } from 'three'
import type { LengthPaths, SkeletonDef, Side } from '../data/manifest'
import { poseQuaternions, type Pose } from './kinematics'

/** Skin matrices S_b = W_b(pose) . T(-c_b): rest world position of a point on body b -> posed position.
 *  Same maths as pipeline/skeleton.py `skin_matrices`. */
export function skinMatrices(skel: SkeletonDef, pose: Pose): Matrix4[] {
  const quats = poseQuaternions(skel, pose)
  const byId = new Map(skel.bodies.map((b) => [b.id, b]))
  const world = new Map<string, Matrix4>()
  const out: Matrix4[] = []
  for (const id of skel.joints) {
    const b = byId.get(id)!
    const local = new Matrix4().makeRotationFromQuaternion(quats.get(id)!)
    if (b.parent === null) local.setPosition(b.center[0], b.center[1], b.center[2])
    else {
      const p = byId.get(b.parent)!
      local.setPosition(b.center[0] - p.center[0], b.center[1] - p.center[1], b.center[2] - p.center[2])
    }
    const w = b.parent === null ? local : new Matrix4().multiplyMatrices(world.get(b.parent)!, local)
    world.set(id, w)
    out.push(new Matrix4().multiplyMatrices(w, new Matrix4().makeTranslation(-b.center[0], -b.center[1], -b.center[2])))
  }
  return out
}

/** A path point is a list of terms [joint, x, y, z, w]; its posed position is  sum_j S_j . (x, y, z, w)  (homogeneous). */
export function pathPoints(path: number[][][], mats: Matrix4[]): Vector3[] {
  return path.map((terms) => {
    const p = new Vector3()
    for (const [j, x, y, z, w] of terms) {
      const e = mats[j].elements // column-major
      p.x += e[0] * x + e[4] * y + e[8] * z + e[12] * w
      p.y += e[1] * x + e[5] * y + e[9] * z + e[13] * w
      p.z += e[2] * x + e[6] * y + e[10] * z + e[14] * w
    }
    return p
  })
}

export function pathLength(path: number[][][], mats: Matrix4[]): number {
  const pts = pathPoints(path, mats)
  let len = 0
  for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1])
  return len
}

/** Length(pose) / Length(rest) for every muscle path. Muscles with no path are absent from the result. */
export function lengthRatios(skel: SkeletonDef, paths: LengthPaths, pose: Pose): Map<string, number> {
  const rest = skinMatrices(skel, {})
  const cur = skinMatrices(skel, pose)
  const out = new Map<string, number>()
  for (const [id, sides] of Object.entries(paths)) {
    for (const side of ['r', 'l'] as Side[]) {
      const path = sides[side]
      if (!path) continue
      const l0 = pathLength(path, rest)
      if (l0 > 1e-9) out.set(`${id}:${side}`, pathLength(path, cur) / l0)
    }
  }
  return out
}
