import type { MotionDirection, MotionInfo, RoleName, Side } from '../data/manifest'
import type { Pose } from './kinematics'

/** Pose (degrees per DOF) for a parameter value: linear between keyframes, clamped outside (see pipeline/motions.py). */
export function interpolatePose(m: MotionInfo, value: number): Pose {
  const kf = m.keyframes
  if (value <= kf[0].at) return { ...kf[0].pose }
  const last = kf[kf.length - 1]
  if (value >= last.at) return { ...last.pose }
  let i = 0
  while (i < kf.length - 2 && value >= kf[i + 1].at) i++
  const t = (value - kf[i].at) / (kf[i + 1].at - kf[i].at)
  const out: Record<string, number> = {}
  for (const k of Object.keys(kf[i].pose)) out[k] = kf[i].pose[k] + t * (kf[i + 1].pose[k] - kf[i].pose[k])
  return out
}

export function directionFor(m: MotionInfo, value: number): 'pos' | 'neg' {
  return value < 0 && m.directions.neg ? 'neg' : 'pos'
}

export function direction(m: MotionInfo, value: number): MotionDirection {
  return m.directions[directionFor(m, value)] ?? m.directions.pos
}

/** 'id', 'id@ipsi', 'id@contra' -> the sides it applies to (limb motions: right side only). */
export function resolveEntry(entry: string, limb: MotionInfo['limb'], ipsi: Side | undefined): { id: string; sides: Side[] } {
  const [id, tag] = entry.split('@')
  if (limb === 'right') return { id, sides: ['r'] }
  const ip: Side = ipsi ?? 'r'
  if (tag === 'ipsi') return { id, sides: [ip] }
  if (tag === 'contra') return { id, sides: [ip === 'r' ? 'l' : 'r'] }
  return { id, sides: ['r', 'l'] }
}

export type RoleMap = Map<string, RoleName> // key = `${muscleId}:${side}`

export function roleKey(id: string, side: Side): string {
  return `${id}:${side}`
}

/** role of every (muscle, side) that takes part in the current direction of a motion. */
export function rolesFor(m: MotionInfo, value: number): RoleMap {
  const d = direction(m, value)
  const out: RoleMap = new Map()
  for (const role of ['agonist', 'stabilizer', 'antagonist'] as RoleName[]) {
    for (const entry of d.roles[role] ?? []) {
      const { id, sides } = resolveEntry(entry, m.limb, d.ipsi)
      for (const s of sides) out.set(roleKey(id, s), role)
    }
  }
  return out
}

/** The same muscle ids, grouped by role (side-less), in the order of the motion table, for the sidebar lists. */
export function roleLists(m: MotionInfo, value: number): Record<RoleName, { id: string; tag?: string }[]> {
  const d = direction(m, value)
  const out: Record<RoleName, { id: string; tag?: string }[]> = { agonist: [], stabilizer: [], antagonist: [] }
  for (const role of Object.keys(out) as RoleName[]) {
    out[role] = (d.roles[role] ?? []).map((e) => {
      const [id, tag] = e.split('@')
      return { id, tag }
    })
  }
  return out
}

/** Back-and-forth parameter for the play button: triangle wave through [a, b], `phase` in seconds. */
export function pingPong(a: number, b: number, phase: number, period: number): number {
  const t = (((phase / period) % 1) + 1) % 1
  const k = t < 0.5 ? t * 2 : (1 - t) * 2
  return a + (b - a) * k
}
