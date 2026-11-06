export type Lang = 'zh' | 'en' | 'la'
export type Side = 'r' | 'l'
export type Layer = 'superficial' | 'intermediate' | 'deep'
export type RegionId = 'shoulder' | 'hip' | 'knee' | 'lumbar'

export type L3 = Record<Lang, string>
export type L2 = { zh: string; en: string }

export interface MuscleInfo {
  id: string
  nodes: Record<Side, string>
  regions: RegionId[]
  group: string
  layer: Layer
  kind: 'muscle' | 'fascia'
  name: L3
  origin: L2
  insertion: L2
  function: L2
  originBones: string[]
  insertionBones: string[]
  tendinous: boolean
  fma: Record<Side, string | null>
}

export interface BoneInfo {
  id: string
  nodes: Record<string, string> // 'r' | 'l' | '' (midline)
  sided: boolean
  regions: RegionId[]
  name: L3
  context: boolean
  body: string
}

export interface LandmarkItem {
  body: string // rigid body that carries the marker
  bonePos: [number, number, number]
  skinPos: [number, number, number]
  depthMm: number
  rayHit: boolean
  muscles: string[]
}

export interface LandmarkInfo {
  id: string
  bone: string
  body: string
  sided: boolean
  regions: RegionId[]
  name: L3
  palpation: L2
  items: Record<string, LandmarkItem> // 'r' | 'l' | '' (midline)
}

export interface Manifest {
  version: number
  attribution: string[]
  clinicalNote: L2
  regions: Record<RegionId, L3>
  groups: Record<string, L2>
  muscles: MuscleInfo[]
  bones: BoneInfo[]
  skinNode: string
  landmarks: LandmarkInfo[]
  attachments: AttachmentTable
  skeleton: SkeletonDef
  motions: MotionInfo[]
  lengthPaths: LengthPaths
  // optional sections added by later pipeline stages
  [extra: string]: unknown
}

export const REGION_ORDER: RegionId[] = ['shoulder', 'hip', 'knee', 'lumbar']

export function dataUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/${file}`
}

export async function loadManifest(url = dataUrl('manifest.json')): Promise<Manifest> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`)
  return (await res.json()) as Manifest
}

export interface AttachmentPatch {
  bone: string
  boneSide: Side | null
  areaCm2: number
  center: [number, number, number]
  tauMm: number
  source: 'algorithm' | 'za' | 'point' | string
  node: string // glTF node name of the patch mesh
}

export interface MuscleAttachments {
  origin: AttachmentPatch[]
  insertion: AttachmentPatch[]
  notes: string[]
}

export type AttachmentTable = Record<string, Partial<Record<Side, MuscleAttachments>>>

export interface SkeletonDof {
  name: string
  axis: [number, number, number] // parent-frame axis, already mirrored for the left side
  sign: number
  share: number
}

export interface SkeletonBody {
  id: string
  parent: string | null
  center: [number, number, number] // world position of the joint in the rest pose
  trunk: boolean
  frameFrom?: string | null // DOFs act in this ancestor's frame (humerus: thorax)
  dofs: SkeletonDof[]
}

export interface TrunkDof {
  name: string
  axis: [number, number, number]
  sign: number
  shares: Record<string, number>
}

export interface SkeletonDef {
  joints: string[]
  bodies: SkeletonBody[]
  trunkDofs: TrunkDof[]
}

export type RoleName = 'agonist' | 'stabilizer' | 'antagonist'

export interface MotionDirection {
  label: L2
  ipsi?: Side
  roles: Partial<Record<RoleName, string[]>> // muscle ids, trunk motions may carry @ipsi / @contra
}

export interface MotionInfo {
  id: string
  region: RegionId
  limb: 'right' | 'trunk'
  name: L2
  note: L2
  param: { zh: string; en: string; min: number; max: number; default: number }
  play?: [number, number]
  keyframes: { at: number; pose: Record<string, number> }[]
  directions: { pos: MotionDirection; neg?: MotionDirection }
}

/** length path of every muscle: per side, a list of path points, each a list of [joint, x, y, z, w] terms */
export type LengthPaths = Record<string, Partial<Record<Side, number[][][]>>>
