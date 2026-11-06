import { useMemo, useRef } from 'react'
import { layoutLabels } from '../lib/anchors'
import { buildNodeIndex } from '../lib/nodes'
import { nodeLabel, textWidth } from '../lib/labels'
import { useStore } from '../store'

const MIN_AREA = 90 // css px^2 of visible surface before a label is worth showing

/** Name tags drawn over the canvas: hover tooltip, selected-muscle callout, optional "all labels". */
export function ScreenLabels() {
  const { manifest, anchors, selected, hovered, showLabels, showLandmarks, lang } = useStore()
  const box = useRef<HTMLDivElement>(null)
  const index = useMemo(() => (manifest ? buildNodeIndex(manifest) : null), [manifest])
  if (!index) return null
  const W = box.current?.clientWidth ?? 1200
  const H = box.current?.clientHeight ?? 800

  const items: { key: string; x: number; y: number; w: number; h: number; priority: number; text: string }[] = []
  for (const [node, a] of Object.entries(anchors)) {
    const ref = index.get(node)
    if (!ref) continue
    const isLm = ref.kind === 'landmark'
    if (isLm ? !showLandmarks : !showLabels || ref.kind !== 'muscle' || a.area < MIN_AREA) continue
    const text = nodeLabel(ref, lang)
    // landmarks outrank muscle tags so they never get dropped by overlap
    items.push({ key: node, x: a.x, y: isLm ? a.y - 12 : a.y, w: textWidth(text, 11), h: 16, priority: isLm ? 1e9 : a.area, text })
  }
  const keep = layoutLabels(items, { w: W, h: H })

  let callout: { x: number; y: number; lx: number; ly: number; text: string } | null = null
  const sel = selected ? index.get(selected) : undefined
  const sa = selected ? anchors[selected] : undefined
  if (sel && sa) {
    const text = nodeLabel(sel, lang)
    const w = textWidth(text, 13)
    const right = sa.x < W / 2 // put the tag on the side with more room
    callout = { x: sa.x, y: sa.y, lx: right ? sa.x + 70 : sa.x - 70 - w, ly: Math.max(10, sa.y - 46), text }
  }
  const hov = hovered && hovered.node !== selected ? index.get(hovered.node) : undefined

  return (
    <div className="labels" ref={box} data-testid="labels">
      {items
        .filter((i) => keep.has(i.key) && i.key !== selected)
        .map((i) => (
          <span key={i.key} className={`tag${i.key.startsWith('lm_') ? ' lm' : ''}`} data-testid="label-tag" style={{ left: i.x, top: i.y }}>
            {i.text}
          </span>
        ))}
      {callout && (
        <>
          <svg className="leader">
            <line x1={callout.x} y1={callout.y} x2={callout.lx + (callout.lx > callout.x ? 0 : textWidth(callout.text, 13))} y2={callout.ly + 10} />
            <circle cx={callout.x} cy={callout.y} r={3} />
          </svg>
          <span className="callout" data-testid="callout" style={{ left: callout.lx, top: callout.ly }}>
            {callout.text}
          </span>
        </>
      )}
      {hov && hovered && (
        <span className="hover-tip" data-testid="hover-tip" style={{ left: hovered.x + 14, top: hovered.y + 16 }}>
          {nodeLabel(hov, lang)}
        </span>
      )}
    </div>
  )
}
