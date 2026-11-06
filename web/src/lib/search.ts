import type { MuscleInfo } from '../data/manifest'

const norm = (s: string) => s.toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim()

/** Matches in any of the three languages, the id, and the group name (zh/en). */
export function muscleMatches(m: MuscleInfo, query: string, groupNames: { zh: string; en: string } = { zh: '', en: '' }): boolean {
  const q = norm(query)
  if (!q) return true
  const hay = [m.name.zh, m.name.en, m.name.la, m.id.replace(/_/g, ' '), groupNames.zh, groupNames.en].map(norm)
  return hay.some((h) => h.includes(q))
}

export function filterMuscles(all: MuscleInfo[], query: string, groups: Record<string, { zh: string; en: string }>): MuscleInfo[] {
  return all.filter((m) => muscleMatches(m, query, groups[m.group]))
}
