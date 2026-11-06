import { create } from 'zustand'
import type { Lang, Manifest, RegionId } from './data/manifest'
import type { Anchor } from './lib/anchors'
import { REGION_VIEW, regionNodes } from './lib/regions'
import { computeHidden, defaultVis, setMusclesOn, type VisState } from './lib/visibility'
import { lengthRatios } from './lib/lengths'
import type { Pose } from './lib/kinematics'
import { interpolatePose } from './lib/motions'
import { strainColor } from './lib/strain'
import { loadReview, saveReview, type ReviewState } from './lib/review'
import type { ViewPreset } from './scene/cameraPresets'

export type LoadStatus = 'loading' | 'ready' | 'error'

export interface ViewRequest {
  preset: ViewPreset | 'reset'
  nonce: number
}

export interface FocusRequest {
  nodes: string[] // glTF node names whose union bounding box is framed
  nonce: number
  dir?: [number, number, number] // fixed viewing direction (default: keep the current one)
}

export interface Hover {
  node: string
  x: number // CSS px relative to the canvas
  y: number
}

export interface AppState {
  status: LoadStatus
  error: string | null
  manifest: Manifest | null
  lang: Lang
  viewRequest: ViewRequest | null
  focusRequest: FocusRequest | null

  vis: VisState
  selected: string | null // glTF node name
  hovered: Hover | null
  hidden: ReadonlySet<string> // node names
  showLabels: boolean
  skinOpacity: number // 0 = skin hidden
  showLandmarks: boolean
  pose: Pose
  motionId: string | null
  motionValue: number
  playing: boolean
  strainColors: ReadonlyMap<string, string>
  ratios: ReadonlyMap<string, number>
  attachMode: boolean
  reviewMode: boolean
  reviewIdx: number
  review: ReviewState
  anchors: Record<string, Anchor> // visible-surface anchors by node name (screen space)

  setStatus: (s: LoadStatus, error?: string | null) => void
  setManifest: (m: Manifest) => void
  setLang: (l: Lang) => void
  requestView: (p: ViewPreset | 'reset') => void
  select: (node: string | null) => void
  setHover: (h: Hover | null) => void
  setHidden: (h: ReadonlySet<string>) => void
  setVis: (v: VisState) => void
  focusNodes: (nodes: string[], dir?: [number, number, number]) => void
  focusRegion: (r: RegionId | null) => void
  setShowLabels: (b: boolean) => void
  setSkinOpacity: (o: number) => void
  setShowLandmarks: (b: boolean) => void
  setPose: (p: Pose) => void
  selectMotion: (id: string | null) => void
  setMotionValue: (v: number) => void
  setPlaying: (b: boolean) => void
  setDof: (name: string, deg: number) => void
  setAttachMode: (b: boolean) => void
  setReviewMode: (b: boolean) => void
  reviewGo: (idx: number) => void
  setReview: (r: ReviewState) => void
  setAnchors: (a: Record<string, Anchor>) => void
}

const LANG_KEY = 'muscle_view.lang'

function initialLang(): Lang {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LANG_KEY) : null
    if (v === 'zh' || v === 'en' || v === 'la') return v
  } catch {
    /* storage unavailable */
  }
  return 'zh'
}

export const useStore = create<AppState>((set, get) => ({
  status: 'loading',
  error: null,
  manifest: null,
  lang: initialLang(),
  viewRequest: null,
  focusRequest: null,

  vis: defaultVis(),
  selected: null,
  hovered: null,
  hidden: new Set<string>(),
  showLabels: false,
  skinOpacity: 0,
  showLandmarks: false,
  pose: {},
  motionId: null,
  motionValue: 0,
  playing: false,
  strainColors: new Map(),
  ratios: new Map(),
  attachMode: false,
  reviewMode: false,
  reviewIdx: 0,
  review: {},
  anchors: {},

  setStatus: (status, error = null) => set({ status, error }),
  setManifest: (manifest) =>
    set({
      manifest,
      hidden: computeHidden(manifest, get().vis),
      review: loadReview(new Set(manifest.muscles.map((m) => m.id))),
    }),
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ignore */
    }
    set({ lang })
  },
  requestView: (preset) => set({ viewRequest: { preset, nonce: (get().viewRequest?.nonce ?? 0) + 1 } }),
  select: (selected) => set({ selected }),
  setHover: (hovered) => set({ hovered }),
  setHidden: (hidden) => set({ hidden }),
  setVis: (vis) => {
    const m = get().manifest
    set({ vis, hidden: m ? computeHidden(m, vis) : get().hidden })
  },
  focusNodes: (nodes, dir) => set({ focusRequest: { nodes, dir, nonce: (get().focusRequest?.nonce ?? 0) + 1 } }),
  focusRegion: (region) => {
    const { manifest, vis } = get()
    if (!manifest) return
    get().setVis({ ...vis, region })
    // changing the region starts a fresh view: no selection, and leave the attachment view (it would hide every muscle)
    set({ selected: null, attachMode: false })
    if (region) get().focusNodes(regionNodes(manifest, region, vis.side), REGION_VIEW[region].dir)
    else get().requestView('reset')
  },
  setShowLabels: (showLabels) => set({ showLabels }),
  setSkinOpacity: (o) => set({ skinOpacity: Math.min(1, Math.max(0, Number.isFinite(o) ? o : 0)) }),
  setShowLandmarks: (showLandmarks) => set({ showLandmarks }),
  setPose: (pose) => set({ pose, motionId: null, strainColors: new Map(), ratios: new Map(), playing: false }),
  selectMotion: (id) => {
    const m = get().manifest?.motions.find((x) => x.id === id)
    if (!m) {
      set({ motionId: null, strainColors: new Map(), ratios: new Map(), pose: {}, playing: false })
      return
    }
    set({ motionId: m.id, playing: false })
    get().setMotionValue(m.param.default)
  },
  setMotionValue: (v) => {
    const { manifest, motionId } = get()
    const m = manifest?.motions.find((x) => x.id === motionId)
    if (!manifest || !m) return
    const value = Math.min(m.param.max, Math.max(m.param.min, Number.isFinite(v) ? v : 0))
    const pose = interpolatePose(m, value)
    const ratios = lengthRatios(manifest.skeleton, manifest.lengthPaths, pose)
    const colors = new Map<string, string>()
    for (const mu of manifest.muscles) {
      for (const side of ['r', 'l'] as const) {
        const r = ratios.get(`${mu.id}:${side}`)
        if (r !== undefined) colors.set(mu.nodes[side], strainColor(r))
      }
    }
    set({ motionValue: value, pose, ratios, strainColors: colors })
  },
  setPlaying: (playing) => set({ playing }),
  setDof: (name, deg) =>
    set({ pose: { ...get().pose, [name]: Number.isFinite(deg) ? deg : 0 }, motionId: null, strainColors: new Map(), ratios: new Map(), playing: false }),
  setAttachMode: (attachMode) => set({ attachMode }),
  setReviewMode: (reviewMode) => {
    set({ reviewMode })
    if (reviewMode) get().reviewGo(get().reviewIdx)
  },
  reviewGo: (idx) => {
    const m = get().manifest
    if (!m || m.muscles.length === 0) return
    const i = ((idx % m.muscles.length) + m.muscles.length) % m.muscles.length
    const mu = m.muscles[i]
    const patches = (['origin', 'insertion'] as const).flatMap((r) => m.attachments?.[mu.id]?.r?.[r].map((p) => p.node) ?? [])
    // review one muscle at a time on the right side; make sure it is not switched off
    get().setVis(setMusclesOn({ ...get().vis, side: 'r' }, [mu.id], true))
    set({ reviewIdx: i, selected: mu.nodes.r, attachMode: true })
    get().focusNodes([mu.nodes.r, ...patches])
  },
  setReview: (review) => {
    const m = get().manifest
    set({ review })
    if (m) saveReview(review, m)
  },
  setAnchors: (anchors) => set({ anchors }),
}))
