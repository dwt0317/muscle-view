import { describe, expect, it } from 'vitest'
import { clearVerdict, exportReview, nextPending, parseReview, progress, setVerdict } from './review'

const NOW = new Date('2026-01-02T03:04:05Z')
const manifest = {
  muscles: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  attachments: {
    a: { r: { origin: [{ bone: 'scapula', areaCm2: 30, source: 'algorithm' }], insertion: [{ bone: 'humerus', areaCm2: 5, source: 'za' }], notes: [] } },
  },
} as never

describe('review state', () => {
  it('records and clears verdicts without mutating the input', () => {
    const r0 = {}
    const r1 = setVerdict(r0, 'a', 'ok', '  fine ', NOW)
    expect(r0).toEqual({})
    expect(r1.a).toEqual({ verdict: 'ok', note: 'fine', at: NOW.toISOString() })
    expect(clearVerdict(r1, 'a')).toEqual({})
  })

  it('counts progress', () => {
    let r = setVerdict({}, 'a', 'ok', '', NOW)
    r = setVerdict(r, 'b', 'issue', 'too large', NOW)
    expect(progress(r, ['a', 'b', 'c'])).toEqual({ total: 3, ok: 1, issue: 1, pending: 1 })
  })

  it('finds the next pending muscle, wrapping around', () => {
    const r = setVerdict(setVerdict({}, 'b', 'ok', '', NOW), 'c', 'ok', '', NOW)
    expect(nextPending(r, ['a', 'b', 'c'], 0)).toBe(0) // wraps back to the only pending one
    expect(nextPending(r, ['a', 'b', 'c'], 2)).toBe(0)
    const all = setVerdict(r, 'a', 'issue', '', NOW)
    expect(nextPending(all, ['a', 'b', 'c'], 1)).toBe(-1)
  })
})

describe('review export / import', () => {
  it('exports reviewed muscles in manifest order with their attachment summary', () => {
    let r = setVerdict({}, 'c', 'issue', 'origin too wide', NOW)
    r = setVerdict(r, 'a', 'ok', '', NOW)
    const out = exportReview(r, manifest, NOW)
    expect(out.version).toBe(1)
    expect(out.items.map((i) => i.muscle)).toEqual(['a', 'c'])
    expect(out.items[0].attachments).toEqual([
      { role: 'origin', bone: 'scapula', areaCm2: 30, source: 'algorithm' },
      { role: 'insertion', bone: 'humerus', areaCm2: 5, source: 'za' },
    ])
    expect(out.items[1]).toMatchObject({ verdict: 'issue', note: 'origin too wide', attachments: [] })
  })

  it('round-trips through JSON', () => {
    const r = setVerdict(setVerdict({}, 'a', 'ok', 'x', NOW), 'b', 'issue', 'y', NOW)
    const back = parseReview(JSON.parse(JSON.stringify(exportReview(r, manifest, NOW))))
    expect(back).toEqual(r)
  })

  it('ignores malformed entries and unknown muscles', () => {
    const raw = { items: [{ muscle: 'a', verdict: 'ok' }, { muscle: 'zzz', verdict: 'ok' }, { muscle: 'b', verdict: 'maybe' }, null, 3] }
    expect(Object.keys(parseReview(raw, new Set(['a', 'b'])))).toEqual(['a'])
    expect(parseReview('garbage')).toEqual({})
  })
})
