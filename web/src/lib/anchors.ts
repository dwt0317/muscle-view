export interface Anchor {
  x: number // CSS px relative to the canvas
  y: number
  area: number // CSS px^2 of visible surface
}

/**
 * From an RGBA id buffer (24-bit id in RGB, 0 = background) compute, for each id, the visible area and an
 * anchor pixel inside the visible region closest to the centroid (so C-shaped muscles still get a point on them).
 * `scale` converts buffer pixels to CSS pixels. `ids` limits which ids are tracked (undefined = all).
 */
export function computeAnchors(
  data: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  scale: number,
  ids?: ReadonlySet<number>,
): Map<number, Anchor> {
  const sum = new Map<number, [number, number, number]>() // sx, sy, n
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const id = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)
      if (id === 0 || (ids && !ids.has(id))) continue
      const s = sum.get(id)
      if (s) {
        s[0] += x
        s[1] += y
        s[2]++
      } else sum.set(id, [x, y, 1])
    }
  }
  const best = new Map<number, [number, number, number]>() // x, y, dist2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const id = data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)
      const s = sum.get(id)
      if (!s) continue
      const cx = s[0] / s[2]
      const cy = s[1] / s[2]
      const d = (x - cx) ** 2 + (y - cy) ** 2
      const b = best.get(id)
      if (!b || d < b[2]) best.set(id, [x, y, d])
    }
  }
  const out = new Map<number, Anchor>()
  for (const [id, s] of sum) {
    const b = best.get(id)!
    out.set(id, { x: (b[0] + 0.5) * scale, y: (b[1] + 0.5) * scale, area: s[2] * scale * scale })
  }
  return out
}

export interface LabelBox {
  key: string
  x: number
  y: number
  w: number
  h: number
  priority: number
}

/** Greedy non-overlapping label selection: higher priority first; returns the keys that fit. */
export function layoutLabels(items: LabelBox[], bounds: { w: number; h: number }, gap = 2): Set<string> {
  const placed: LabelBox[] = []
  const keep = new Set<string>()
  for (const it of [...items].sort((a, b) => b.priority - a.priority)) {
    const l = it.x - it.w / 2
    const t = it.y - it.h / 2
    if (l < 0 || t < 0 || l + it.w > bounds.w || t + it.h > bounds.h) continue
    const clash = placed.some(
      (p) => !(l + it.w + gap <= p.x - p.w / 2 || l >= p.x + p.w / 2 + gap || t + it.h + gap <= p.y - p.h / 2 || t >= p.y + p.h / 2 + gap),
    )
    if (clash) continue
    placed.push(it)
    keep.add(it.key)
  }
  return keep
}
