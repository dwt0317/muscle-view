import * as THREE from 'three'
import { decodeId, encodeId } from '../lib/pickId'

export interface IdBuffer {
  data: Uint8Array
  w: number
  h: number
  scale: number // buffer px -> CSS px
}

/**
 * GPU colour-id picking. Every pickable mesh gets a constant per-vertex colour that encodes its id; the scene is
 * re-rendered with a flat override material into a tiny render target. Works for skinned meshes (three applies the
 * skeleton for the override material too) and respects the exact same visibility / depth as the visible frame.
 */
export class IdPicker {
  private readonly idToNode = new Map<number, string>()
  private readonly nodeToId = new Map<string, number>()
  private readonly material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
  private readonly target1 = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true })
  private targetFull: THREE.WebGLRenderTarget | null = null
  private meshes = new Set<THREE.Mesh>()

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  /** Give every mesh with userData.pickable a unique id colour. Ids start at 1. */
  assign(root: THREE.Object3D, nodeNameOf: (m: THREE.Mesh) => string | null): void {
    this.idToNode.clear()
    this.nodeToId.clear()
    this.meshes = new Set()
    let next = 1
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const node = nodeNameOf(mesh)
      if (!node) return
      const id = next++
      const [r, g, b] = encodeId(id)
      const n = mesh.geometry.getAttribute('position').count
      const col = new Uint8Array(n * 3)
      for (let i = 0; i < n; i++) col.set([r, g, b], i * 3)
      mesh.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3, true))
      this.idToNode.set(id, node)
      this.nodeToId.set(node, id)
      this.meshes.add(mesh)
    })
  }

  idOf(node: string): number | undefined {
    return this.nodeToId.get(node)
  }
  nodeOf(id: number): string | undefined {
    return this.idToNode.get(id)
  }
  get ids(): ReadonlySet<number> {
    return new Set(this.idToNode.keys())
  }

  private withIdPass<T>(target: THREE.WebGLRenderTarget, fn: () => T): T {
    const r = this.renderer
    const prev = {
      target: r.getRenderTarget(),
      bg: this.scene.background,
      override: this.scene.overrideMaterial,
      clear: r.getClearColor(new THREE.Color()),
      alpha: r.getClearAlpha(),
      view: this.camera.view ? { ...this.camera.view } : null,
      xr: r.xr.enabled,
    }
    const hidden: THREE.Object3D[] = []
    this.scene.traverse((o) => {
      // anything that is not a pickable mesh (skin, markers, helper geometry) must not occlude picking
      const m = o as THREE.Mesh
      const nonPickable = (m.isMesh && !this.meshes.has(m)) || (o as THREE.Line).isLine || (o as THREE.Points).isPoints
      if (nonPickable && o.visible) {
        o.visible = false
        hidden.push(o)
      }
    })
    try {
      r.xr.enabled = false
      this.scene.background = null
      this.scene.overrideMaterial = this.material
      r.setClearColor(0x000000, 0)
      r.setRenderTarget(target)
      r.clear()
      return fn()
    } finally {
      hidden.forEach((o) => (o.visible = true))
      this.scene.overrideMaterial = prev.override
      this.scene.background = prev.bg
      r.setClearColor(prev.clear, prev.alpha)
      r.setRenderTarget(prev.target)
      r.xr.enabled = prev.xr
      if (prev.view && prev.view.enabled) {
        this.camera.setViewOffset(prev.view.fullWidth, prev.view.fullHeight, prev.view.offsetX, prev.view.offsetY, prev.view.width, prev.view.height)
      } else this.camera.clearViewOffset()
    }
  }

  /** Pick at CSS pixel (x, y) relative to the canvas, whose CSS size is (w, h). Returns the node name or null. */
  pickAt(x: number, y: number, w: number, h: number): string | null {
    const px = new Uint8Array(4)
    this.withIdPass(this.target1, () => {
      this.camera.setViewOffset(w, h, Math.floor(x), Math.floor(y), 1, 1)
      this.renderer.render(this.scene, this.camera)
      this.renderer.readRenderTargetPixels(this.target1, 0, 0, 1, 1, px)
    })
    const id = decodeId(px[0], px[1], px[2])
    return id ? this.idToNode.get(id) ?? null : null
  }

  /** Render the whole view into a low-resolution id buffer (for label anchors / occlusion). */
  renderBuffer(cssW: number, cssH: number, maxW = 480): IdBuffer {
    const scale = Math.max(1, cssW / maxW)
    const w = Math.max(1, Math.round(cssW / scale))
    const h = Math.max(1, Math.round(cssH / scale))
    if (!this.targetFull || this.targetFull.width !== w || this.targetFull.height !== h) {
      this.targetFull?.dispose()
      this.targetFull = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true })
    }
    const data = new Uint8Array(w * h * 4)
    const tf = this.targetFull
    this.withIdPass(tf, () => {
      this.camera.clearViewOffset()
      this.renderer.render(this.scene, this.camera)
      this.renderer.readRenderTargetPixels(tf, 0, 0, w, h, data)
    })
    // WebGL rows run bottom-to-top; flip so that y grows downwards like CSS
    const flipped = new Uint8Array(data.length)
    for (let y = 0; y < h; y++) flipped.set(data.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4)
    return { data: flipped, w, h, scale: cssW / w }
  }

  dispose(): void {
    this.material.dispose()
    this.target1.dispose()
    this.targetFull?.dispose()
  }
}
