import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { computeAnchors } from '../lib/anchors'
import { useStore } from '../store'
import { registry } from './Model'
import { IdPicker } from './picking'

const CLICK_SLOP = 5 // px
const HOVER_INTERVAL = 45 // ms
const ANCHOR_INTERVAL = 140 // ms

export let picker: IdPicker | null = null

/** Wires GPU picking (hover / click) and the screen-space label anchors to the canvas. */
export function Picker() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const status = useStore((s) => s.status)
  const dirty = useRef(true)
  const lastAnchor = useRef(0)
  const lastCam = useRef(new THREE.Matrix4())

  useEffect(() => {
    if (status !== 'ready' || !registry.current) return
    const p = new IdPicker(gl, scene, camera)
    p.assign(registry.current.root, (m) => (registry.current!.refs.has(m.name) ? m.name : null))
    picker = p
    dirty.current = true
    return () => {
      p.dispose()
      picker = null
    }
  }, [status, gl, scene, camera])

  // pointer handling
  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number } | null = null
    let pending: { x: number; y: number } | null = null
    let lastHover = 0
    let raf = 0

    const rel = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
    }
    const doHover = () => {
      raf = 0
      if (!pending || !picker) return
      const now = performance.now()
      if (now - lastHover < HOVER_INTERVAL) {
        raf = requestAnimationFrame(doHover)
        return
      }
      lastHover = now
      const r = el.getBoundingClientRect()
      const node = picker.pickAt(pending.x, pending.y, r.width, r.height)
      const cur = useStore.getState().hovered
      if (node) {
        useStore.getState().setHover({ node, x: pending.x, y: pending.y })
        el.style.cursor = 'pointer'
      } else if (cur) {
        useStore.getState().setHover(null)
        el.style.cursor = ''
      }
      pending = null
    }
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
    }
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0 || e.pointerType === 'touch') return
      const { x, y } = rel(e)
      pending = { x, y }
      if (!raf) raf = requestAnimationFrame(doHover)
    }
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0 || !picker) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > CLICK_SLOP) return
      const { x, y, w, h } = rel(e)
      useStore.getState().select(picker.pickAt(x, y, w, h))
    }
    const onLeave = () => {
      pending = null
      if (useStore.getState().hovered) useStore.getState().setHover(null)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerleave', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [gl])

  // anything that changes what is visible on screen invalidates the label anchors
  useEffect(
    () =>
      useStore.subscribe((s, p) => {
        if (s.hidden !== p.hidden || s.showLabels !== p.showLabels || s.showLandmarks !== p.showLandmarks || s.skinOpacity !== p.skinOpacity || s.attachMode !== p.attachMode || s.pose !== p.pose || s.selected !== p.selected || s.status !== p.status) {
          dirty.current = true
        }
      }),
    [],
  )

  useFrame(() => {
    if (!picker) return
    const cam = camera.matrixWorld
    if (!cam.equals(lastCam.current)) {
      lastCam.current.copy(cam)
      dirty.current = true
    }
    const st = useStore.getState()
    if (!dirty.current) return
    const now = performance.now()
    if (now - lastAnchor.current < ANCHOR_INTERVAL) return
    dirty.current = false
    lastAnchor.current = now
    if (!st.showLabels && !st.showLandmarks && !st.selected) {
      if (Object.keys(st.anchors).length) st.setAnchors({})
      return
    }
    const r = gl.domElement.getBoundingClientRect()
    const buf = picker.renderBuffer(r.width, r.height)
    const found = computeAnchors(buf.data, buf.w, buf.h, buf.scale, picker.ids)
    const out: Record<string, { x: number; y: number; area: number }> = {}
    for (const [id, a] of found) {
      const node = picker.nodeOf(id)
      if (node) out[node] = a
    }
    st.setAnchors(out)
  })

  return null
}
