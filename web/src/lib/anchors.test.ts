import { describe, expect, it } from 'vitest'
import { computeAnchors, layoutLabels } from './anchors'
import { encodeId } from './pickId'

function buffer(w: number, h: number, paint: (x: number, y: number) => number) {
  const d = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = encodeId(paint(x, y))
      const o = (y * w + x) * 4
      d[o] = r
      d[o + 1] = g
      d[o + 2] = b
      d[o + 3] = 255
    }
  return d
}

describe('computeAnchors', () => {
  it('finds area and centre of each visible id', () => {
    const d = buffer(10, 10, (x, y) => (x >= 2 && x < 6 && y >= 2 && y < 6 ? 5 : x >= 7 && y >= 7 ? 300 : 0))
    const a = computeAnchors(d, 10, 10, 2)
    expect(a.get(5)!.area).toBe(16 * 4)
    expect(a.get(5)!.x).toBeGreaterThanOrEqual(4)
    expect(a.get(5)!.x).toBeLessThanOrEqual(12)
    expect(a.get(300)!.area).toBe(9 * 4)
    expect(a.has(0)).toBe(false)
  })
  it('keeps the anchor on the region even when the centroid is outside it (C shape)', () => {
    // C: columns 0..1 full height, plus rows 0..1 and 8..9 across
    const d = buffer(10, 10, (x, y) => (x < 2 || y < 2 || y > 7 ? 7 : 0))
    const a = computeAnchors(d, 10, 10, 1).get(7)!
    const px = Math.floor(a.x)
    const py = Math.floor(a.y)
    expect(px < 2 || py < 2 || py > 7).toBe(true)
  })
  it('can restrict to a set of ids', () => {
    const d = buffer(4, 4, (x) => (x < 2 ? 1 : 2))
    expect([...computeAnchors(d, 4, 4, 1, new Set([2])).keys()]).toEqual([2])
  })
})

describe('layoutLabels', () => {
  const b = { w: 200, h: 100 }
  it('drops lower-priority labels that overlap', () => {
    const keep = layoutLabels(
      [
        { key: 'a', x: 50, y: 50, w: 40, h: 14, priority: 1 },
        { key: 'b', x: 60, y: 52, w: 40, h: 14, priority: 5 },
        { key: 'c', x: 150, y: 50, w: 40, h: 14, priority: 0 },
      ],
      b,
    )
    expect([...keep].sort()).toEqual(['b', 'c'])
  })
  it('drops labels that fall outside the canvas', () => {
    expect(layoutLabels([{ key: 'a', x: 5, y: 50, w: 40, h: 14, priority: 1 }], b).size).toBe(0)
  })
})
