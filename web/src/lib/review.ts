import type { AttachmentTable, Manifest, Side } from '../data/manifest'

export type Verdict = 'ok' | 'issue'

export interface ReviewEntry {
  verdict: Verdict
  note: string
  at: string // ISO timestamp
}

/** Reviews are per muscle (the left side is the mirror image of the right side). */
export type ReviewState = Record<string, ReviewEntry>

export const REVIEW_KEY = 'muscle_view.review.v1'

export function setVerdict(r: ReviewState, muscle: string, verdict: Verdict, note: string, now = new Date()): ReviewState {
  return { ...r, [muscle]: { verdict, note: note.trim(), at: now.toISOString() } }
}

export function clearVerdict(r: ReviewState, muscle: string): ReviewState {
  const { [muscle]: _drop, ...rest } = r
  return rest
}

export interface Progress {
  total: number
  ok: number
  issue: number
  pending: number
}

export function progress(r: ReviewState, ids: string[]): Progress {
  let ok = 0
  let issue = 0
  for (const id of ids) {
    const v = r[id]?.verdict
    if (v === 'ok') ok++
    else if (v === 'issue') issue++
  }
  return { total: ids.length, ok, issue, pending: ids.length - ok - issue }
}

/** Next index (wrapping) after `from` whose muscle has no verdict yet; -1 when all are reviewed. */
export function nextPending(r: ReviewState, ids: string[], from: number): number {
  for (let k = 1; k <= ids.length; k++) {
    const i = (from + k) % ids.length
    if (!r[ids[i]]) return i
  }
  return -1
}

export interface ReviewExport {
  version: 1
  exportedAt: string
  note: string
  items: {
    muscle: string
    verdict: Verdict
    note: string
    reviewedAt: string
    attachments: { role: 'origin' | 'insertion'; bone: string; areaCm2: number; source: string }[]
  }[]
}

export function exportReview(r: ReviewState, m: Pick<Manifest, 'muscles'> & { attachments?: AttachmentTable }, now = new Date()): ReviewExport {
  const items: ReviewExport['items'] = []
  for (const mu of m.muscles) {
    const e = r[mu.id]
    if (!e) continue
    const att = m.attachments?.[mu.id]?.['r' as Side]
    items.push({
      muscle: mu.id,
      verdict: e.verdict,
      note: e.note,
      reviewedAt: e.at,
      attachments: att
        ? (['origin', 'insertion'] as const).flatMap((role) =>
            att[role].map((p) => ({ role, bone: p.bone, areaCm2: p.areaCm2, source: p.source })),
          )
        : [],
    })
  }
  return { version: 1, exportedAt: now.toISOString(), note: 'muscle_view attachment review', items }
}

/** Tolerant parser for stored / imported review data. Unknown muscles and malformed entries are dropped. */
export function parseReview(raw: unknown, validIds?: ReadonlySet<string>): ReviewState {
  const out: ReviewState = {}
  const items = (raw as { items?: unknown })?.items
  if (Array.isArray(items)) {
    for (const it of items as Record<string, unknown>[]) {
      if (typeof it?.muscle !== 'string' || (it.verdict !== 'ok' && it.verdict !== 'issue')) continue
      if (validIds && !validIds.has(it.muscle)) continue
      out[it.muscle] = {
        verdict: it.verdict,
        note: typeof it.note === 'string' ? it.note : '',
        at: typeof it.reviewedAt === 'string' ? it.reviewedAt : new Date(0).toISOString(),
      }
    }
  }
  return out
}

export function loadReview(validIds?: ReadonlySet<string>): ReviewState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(REVIEW_KEY) : null
    return raw ? parseReview(JSON.parse(raw), validIds) : {}
  } catch {
    return {}
  }
}

export function saveReview(r: ReviewState, m: Pick<Manifest, 'muscles'>): void {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(exportReview(r, m)))
  } catch {
    /* storage unavailable */
  }
}
