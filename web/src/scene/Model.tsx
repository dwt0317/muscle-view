import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { dataUrl } from '../data/manifest'
import { poseQuaternions } from '../lib/kinematics'
import { buildNodeIndex, type NodeRef } from '../lib/nodes'
import { computeStyle } from '../lib/style'
import { useStore } from '../store'
import { createMaterials } from './materials'

export const MODEL_URL = dataUrl('model.glb')

export interface ModelRegistry {
  root: THREE.Object3D
  meshes: Map<string, THREE.Mesh> // muscles, bones and landmark markers by node name
  refs: Map<string, NodeRef>
  skin: THREE.Mesh | null
  landmarkPos: Map<string, { bone: THREE.Vector3; skin: THREE.Vector3 }>
  landmarkLines: THREE.LineSegments | null
  patches: Map<string, THREE.Mesh> // attachment decals on the bones (not pickable)
  joints: Map<string, THREE.Object3D> // rigid body id -> joint node
  centers: Map<string, THREE.Vector3> // body id -> joint centre in the rest pose
}

export const registry: { current: ModelRegistry | null } = { current: null }

const ZERO = new THREE.Vector3()
const MARKER_PX = 0.011 // marker radius as a fraction of the camera distance

export function Model() {
  // meshopt decoder is bundled; Draco would be fetched from a CDN, so keep it off.
  const gltf = useGLTF(MODEL_URL, false, true)
  const manifest = useStore((s) => s.manifest)
  const setStatus = useStore((s) => s.setStatus)
  const materials = useMemo(createMaterials, [])
  const disposables = useRef<{ dispose: () => void }[]>([])

  // Wait for the manifest (names / ids) and the geometry, then build the node registry.
  useLayoutEffect(() => {
    if (!manifest) return
    const refs = buildNodeIndex(manifest)
    const meshes = new Map<string, THREE.Mesh>()
    const own = <T extends { dispose: () => void }>(o: T): T => {
      disposables.current.push(o)
      return o
    }
    let skin: THREE.Mesh | null = null
    const joints = new Map<string, THREE.Object3D>()
    const centers = new Map<string, THREE.Vector3>(manifest.skeleton.bodies.map((b) => [b.id, new THREE.Vector3(...b.center)]))
    const patches = new Map<string, THREE.Mesh>()
    const patchMat = {
      origin: own(new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff0000', emissiveIntensity: 0.35, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      insertion: own(new THREE.MeshStandardMaterial({ color: '#3b8bff', emissive: '#0050ff', emissiveIntensity: 0.35, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    }
    gltf.scene.traverse((o) => {
      if (o.userData.kind === 'joint') joints.set(o.userData.body as string, o)
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.frustumCulled = false // skinned meshes move out of their bind-pose bounds
      if (mesh.userData.kind === 'skin') {
        mesh.material = materials.skin
        mesh.visible = false // shown on demand (skin overlay)
        skin = mesh
        return
      }
      if (mesh.userData.kind === 'patch') {
        mesh.material = patchMat[mesh.userData.role as 'origin' | 'insertion']
        mesh.visible = false
        patches.set(mesh.name, mesh)
        return
      }
      const ref = refs.get(mesh.name)
      if (!ref) return
      mesh.material = own((ref.kind === 'bone' ? materials.bone : materials.muscle).clone())
      meshes.set(ref.node, mesh)
    })

    // landmark markers + bone->skin guide lines
    const landmarkPos = new Map<string, { bone: THREE.Vector3; skin: THREE.Vector3 }>()
    const landmarkBody = new Map<string, string>()
    const unitSphere = new THREE.SphereGeometry(1, 14, 10)
    own(unitSphere)
    const lineVerts: number[] = []
    for (const [node, ref] of refs) {
      if (ref.kind !== 'landmark' || !ref.item) continue
      // each marker needs its own geometry: the pick pass stores a per-geometry id colour
      const mesh = new THREE.Mesh(own(unitSphere.clone()), own(new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.4 })))
      mesh.name = node
      mesh.frustumCulled = false
      mesh.visible = false
      mesh.renderOrder = 5
      meshes.set(node, mesh)
      const bone = new THREE.Vector3(...ref.item.bonePos)
      const skinP = new THREE.Vector3(...ref.item.skinPos)
      landmarkPos.set(node, { bone, skin: skinP })
      landmarkBody.set(node, ref.item.body)
      lineVerts.push(...bone.toArray(), ...skinP.toArray())
    }
    // markers ride on their rigid body: parent = joint node, position = world rest position - joint centre
    for (const [node, body] of landmarkBody) {
      const joint = joints.get(body)
      const mesh = meshes.get(node)!
      if (joint) joint.add(mesh)
      else gltf.scene.add(mesh)
    }
    const lineGeo = own(new THREE.BufferGeometry())
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3))
    const lines = new THREE.LineSegments(
      lineGeo,
      own(new THREE.LineBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.8 })),
    )
    lines.frustumCulled = false
    lines.visible = false
    gltf.scene.add(lines)

    registry.current = { root: gltf.scene, meshes, refs, skin, landmarkPos, landmarkLines: lines, patches, joints, centers }
    applyPose(useStore.getState().pose)
    setStatus('ready')
    return () => {
      registry.current = null
      gltf.scene.remove(lines)
      for (const [n, m] of meshes) if (refs.get(n)?.kind === 'landmark') m.parent?.remove(m)
      disposables.current.forEach((d) => d.dispose())
      disposables.current = []
    }
  }, [gltf, manifest, materials, setStatus])

  // Keep mesh styles (visibility, highlight, skin overlay, landmark positions) in sync with the store.
  useEffect(() => {
    const apply = () => {
      const reg = registry.current
      if (!reg) return
      const st = useStore.getState()
      const style = { selected: st.selected, hovered: st.hovered?.node ?? null, hidden: st.hidden, showLandmarks: st.showLandmarks, attachMode: st.attachMode, strainColors: st.strainColors, region: st.vis.region }
      const onSkin = st.skinOpacity > 0
      for (const [node, mesh] of reg.meshes) {
        const ref = reg.refs.get(node)!
        const s = computeStyle(ref, style)
        mesh.visible = s.visible
        const mat = mesh.material as THREE.MeshStandardMaterial
        mat.color.set(s.color)
        mat.emissive.set(s.emissive)
        mat.emissiveIntensity = s.emissiveIntensity
        const translucent = s.opacity < 1
        if (mat.opacity !== s.opacity || mat.transparent !== translucent) {
          mat.opacity = s.opacity
          mat.transparent = translucent
          mat.depthWrite = !translucent
          mat.needsUpdate = true
        }
        if (ref.kind === 'landmark') {
          const p = reg.landmarkPos.get(node)!
          const body = (ref.item as { body: string }).body
          mesh.position.copy(onSkin ? p.skin : p.bone).sub(reg.centers.get(body) ?? ZERO)
        }
      }
      if (reg.skin) {
        reg.skin.visible = onSkin
        const m = reg.skin.material as THREE.MeshStandardMaterial
        m.opacity = st.skinOpacity
        m.transparent = st.skinOpacity < 1
        m.depthWrite = st.skinOpacity >= 1
        m.needsUpdate = true
      }
      const selRef = st.selected ? reg.refs.get(st.selected) : undefined
      for (const patch of reg.patches.values()) {
        patch.visible = selRef?.kind === 'muscle' && patch.userData.muscle === selRef.id && patch.userData.side === selRef.side
      }
      // the bone->skin guide lines are drawn in world space, so they only make sense in the neutral pose
      const neutral = Object.values(st.pose).every((v) => v === 0)
      if (reg.landmarkLines) reg.landmarkLines.visible = st.showLandmarks && onSkin && neutral
    }
    apply()
    return useStore.subscribe((s, p) => {
      if (
        s.selected !== p.selected || s.hovered?.node !== p.hovered?.node || s.hidden !== p.hidden ||
        s.status !== p.status || s.skinOpacity !== p.skinOpacity || s.showLandmarks !== p.showLandmarks || s.attachMode !== p.attachMode || s.pose !== p.pose || s.strainColors !== p.strainColors
      ) apply()
    })
  }, [manifest, gltf])

  const tmp = useMemo(() => new THREE.Vector3(), [])

  // landmark markers keep a constant apparent size while zooming
  useFrame(({ camera }) => {
    const reg = registry.current
    if (!reg || !useStore.getState().showLandmarks) return
    for (const [node, mesh] of reg.meshes) {
      if (reg.refs.get(node)?.kind !== 'landmark') continue
      const d = camera.position.distanceTo(mesh.getWorldPosition(tmp))
      mesh.scale.setScalar(THREE.MathUtils.clamp(d * MARKER_PX, 0.003, 0.03))
    }
  })

  // drive the joint nodes from the pose in the store
  useEffect(() => {
    applyPose(useStore.getState().pose)
    return useStore.subscribe((s, p) => {
      if (s.pose !== p.pose) applyPose(s.pose)
    })
  }, [manifest, gltf])

  return <primitive object={gltf.scene} />
}

/** Set every joint node's local rotation from the pose (translations stay at the rest offsets). */
export function applyPose(pose: Record<string, number>): void {
  const reg = registry.current
  const skel = useStore.getState().manifest?.skeleton
  if (!reg || !skel) return
  for (const [id, q] of poseQuaternions(skel, pose)) reg.joints.get(id)?.quaternion.copy(q)
  reg.root.updateMatrixWorld(true)
}
