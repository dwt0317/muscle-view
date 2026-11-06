import { CameraControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, type ReactNode, Suspense, useEffect, useRef } from 'react'
import * as THREE from 'three'
import type CameraControlsImpl from 'camera-controls'
import { useStore } from '../store'
import { BODY_CENTER, DEFAULT_DISTANCE, presetPose } from './cameraPresets'
import { fitDistance } from '../lib/regions'
import { Model, registry } from './Model'
import { Picker } from './Picker'

class LoadErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    useStore.getState().setStatus('error', error.message)
  }
  render() {
    return this.state.error ? null : this.props.children
  }
}

/** Two directional lights that follow the camera so the shading never goes dark when orbiting. */
function HeadLights() {
  const key = useRef<THREE.DirectionalLight>(null)
  const fill = useRef<THREE.DirectionalLight>(null)
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    key.current?.position.copy(camera.position).add(new THREE.Vector3(1.5, 2, 1))
    fill.current?.position.copy(camera.position).add(new THREE.Vector3(-2, 0.5, 1.5))
  })
  return (
    <>
      <hemisphereLight args={['#ffffff', '#6b6458', 0.85]} />
      <directionalLight ref={key} intensity={1.6} />
      <directionalLight ref={fill} intensity={0.6} />
    </>
  )
}

function Rig() {
  const controls = useRef<CameraControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const request = useStore((s) => s.viewRequest)
  const focus = useStore((s) => s.focusRequest)

  useEffect(() => {
    const c = controls.current
    if (!c) return
    c.setLookAt(...presetPose('front').position, ...BODY_CENTER, false)
    // test / debug hook: read-only camera state
    ;(window as unknown as { __mv: unknown }).__mv = {
      camera: () => {
        const t = new THREE.Vector3()
        c.getTarget(t)
        return { position: camera.position.toArray(), target: t.toArray() }
      },
      store: useStore,
      registry: () => registry.current,
    }
  }, [camera])

  useEffect(() => {
    const c = controls.current
    if (!c || !request) return
    const preset = request.preset === 'reset' ? 'front' : request.preset
    const pose = presetPose(preset)
    c.setLookAt(...pose.position, ...pose.target, true)
  }, [request])

  // frame the union bounding box of some nodes, keeping the current viewing direction
  useEffect(() => {
    const c = controls.current
    const reg = registry.current
    if (!c || !reg || !focus) return
    const box = new THREE.Box3()
    for (const n of focus.nodes) {
      const mesh = reg.meshes.get(n) ?? reg.patches.get(n)
      if (mesh) box.expandByObject(mesh)
    }
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const persp = camera as THREE.PerspectiveCamera
    const dist = THREE.MathUtils.clamp(fitDistance([size.x, size.y, size.z], persp.fov, persp.aspect, 1.15), 0.7, 4)
    const dir = focus.dir
      ? new THREE.Vector3(...focus.dir).normalize()
      : camera.position.clone().sub(c.getTarget(new THREE.Vector3())).normalize()
    const pos = center.clone().addScaledVector(dir, dist)
    c.setLookAt(pos.x, pos.y, pos.z, center.x, center.y, center.z, true)
  }, [focus, camera])

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={0.35}
      maxDistance={7}
      dollySpeed={0.6}
      smoothTime={0.12}
      draggingSmoothTime={0.06}
    />
  )
}

export function Viewer() {
  return (
    <Canvas
      camera={{ fov: 35, near: 0.05, far: 50, position: [0, BODY_CENTER[1], DEFAULT_DISTANCE] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#1d2127']} />
      <HeadLights />
      <Rig />
      <LoadErrorBoundary>
        <Suspense fallback={null}>
          <Model />
          <Picker />
        </Suspense>
      </LoadErrorBoundary>
    </Canvas>
  )
}
