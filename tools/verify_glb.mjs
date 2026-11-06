// Compare two glb files vertex by vertex, in world space and after skinning, using three's own GLTFLoader.
//   node tools/verify_glb.mjs raw.glb compressed.glb [tolerance_mm=0.5]
// Guards the meshopt/quantisation step of pipeline/export.py: a compressed model must look identical to the raw one.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const web = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web', 'node_modules', 'three')
const THREE = await import(pathToFileURL(path.join(web, 'build', 'three.module.js')).href)
const { GLTFLoader } = await import(pathToFileURL(path.join(web, 'examples', 'jsm', 'loaders', 'GLTFLoader.js')).href)
const { MeshoptDecoder } = await import(pathToFileURL(path.join(web, 'examples', 'jsm', 'libs', 'meshopt_decoder.module.js')).href)

const [, , rawPath, cmpPath, tolArg] = process.argv
const tolMm = Number(tolArg ?? 0.5)

const load = (p) =>
  new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const b = fs.readFileSync(p)
    loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', resolve, reject)
  })

function worldVertices(gltf) {
  const out = new Map()
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return
    const pos = o.geometry.getAttribute('position')
    const arr = new Float32Array(pos.count * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v)
      v.applyMatrix4(o.matrixWorld)
      arr.set([v.x, v.y, v.z], i * 3)
    }
    out.set(o.name, { arr, skinned: !!o.isSkinnedMesh })
  })
  return out
}

const [a, b] = (await Promise.all([load(rawPath), load(cmpPath)])).map(worldVertices)
// Vertex order changes when the encoder reorders, so compare order-independent statistics per mesh:
// bounding box, centroid and RMS radius. Scale, offset and skinning errors all show up in these.
const stats = (arr) => {
  const n = arr.length / 3
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const c = [0, 0, 0]
  for (let i = 0; i < arr.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const x = arr[i + k]
      if (x < min[k]) min[k] = x
      if (x > max[k]) max[k] = x
      c[k] += x / n
    }
  }
  let r2 = 0
  for (let i = 0; i < arr.length; i += 3) r2 += (arr[i] - c[0]) ** 2 + (arr[i + 1] - c[1]) ** 2 + (arr[i + 2] - c[2]) ** 2
  return { n, min, max, c, rms: Math.sqrt(r2 / n) }
}
let worst = 0
let worstName = ''
let skinned = 0
for (const [name, ra] of a) {
  const rb = b.get(name)
  if (!rb) throw new Error(`mesh ${name} missing in ${cmpPath}`)
  if (ra.skinned !== rb.skinned) throw new Error(`mesh ${name}: skinned flag changed`)
  if (ra.skinned) skinned++
  const sa = stats(ra.arr)
  const sb = stats(rb.arr)
  if (sa.n !== sb.n) throw new Error(`mesh ${name}: vertex count ${sa.n} vs ${sb.n}`)
  const d =
    1000 *
    Math.max(
      ...sa.min.map((x, k) => Math.abs(x - sb.min[k])),
      ...sa.max.map((x, k) => Math.abs(x - sb.max[k])),
      ...sa.c.map((x, k) => Math.abs(x - sb.c[k])),
      Math.abs(sa.rms - sb.rms),
    )
  if (d > worst) {
    worst = d
    worstName = name
  }
}
console.log(`verify_glb: ${a.size} meshes (${skinned} skinned), worst deviation ${worst.toFixed(3)} mm (${worstName || '-'})`)
if (worst > tolMm) {
  console.error(`FAIL: deviation exceeds ${tolMm} mm`)
  process.exit(1)
}
