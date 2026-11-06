import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { evalStore, openReady, setState } from './helpers'

/** Centroid of a mesh in world space, after skinning, computed inside the page from the real three.js scene. */
const centroid = (page: import('@playwright/test').Page, node: string) =>
  page.evaluate(`(() => {
    const reg = window.__mv.registry()
    const mesh = reg.meshes.get(${JSON.stringify(node)})
    reg.root.updateMatrixWorld(true)
    const pos = mesh.geometry.getAttribute('position')
    const v = mesh.position.clone()
    const sum = [0, 0, 0]
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v)
      v.applyMatrix4(mesh.matrixWorld)
      sum[0] += v.x; sum[1] += v.y; sum[2] += v.z
    }
    return sum.map((s) => s / pos.count)
  })()`) as Promise<number[]>

const golden = JSON.parse(readFileSync(new URL('../src/lib/kinematics.golden.json', import.meta.url), 'utf8'))
type Golden = { pose: Record<string, number>; centroids: Record<string, number[]> }
const poses = golden.poses as unknown as Record<string, Golden>

for (const name of ['rest', 'knee90', 'hip_abd30_flex40', 'shoulder', 'trunk', 'left_mirror']) {
  test(`pose "${name}": the real renderer matches the Python kinematics (rigid bones and skinned muscles)`, async ({ page }) => {
    await openReady(page)
    await setState(page, `{ pose: ${JSON.stringify(poses[name].pose)} }`)
    await page.waitForTimeout(300)
    for (const [node, expected] of Object.entries(poses[name].centroids)) {
      const got = await centroid(page, node)
      const dist = Math.hypot(got[0] - expected[0], got[1] - expected[1], got[2] - expected[2]) * 1000
      expect(dist, `${node} centroid off by ${dist.toFixed(2)} mm`).toBeLessThan(2)
    }
  })
}

test('the knee motion bends the right knee 0 to 140 degrees; muscles follow; stopping restores the rest pose', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('motion-select').selectOption('knee_flexion')
  const slider = page.getByTestId('motion-slider')
  const rest = await centroid(page, 'b_tibia_r')
  const muscleRest = await centroid(page, 'm_semitendinosus_r')

  await slider.fill('90')
  await expect(page.getByTestId('motion-value')).toHaveText('90°')
  expect(await evalStore<number>(page, "(s) => s.pose['r_knee_flexion']")).toBe(90)
  const bent = await centroid(page, 'b_tibia_r')
  expect(bent[1]).toBeGreaterThan(rest[1] + 0.1) // the shank swings up behind the thigh
  expect(bent[2]).toBeLessThan(rest[2] - 0.1) // ... and backwards (posterior = -Z)
  // the skinned hamstring moved (its distal end follows the shank, its proximal end stays on the pelvis)
  const hamstring = await centroid(page, 'm_semitendinosus_r')
  const shift = Math.hypot(...hamstring.map((v, i) => v - muscleRest[i]))
  expect(shift).toBeGreaterThan(0.005)
  expect(shift).toBeLessThan(0.1)
  // the left leg is untouched
  const leftRest = poses.rest.centroids['b_femur_l']
  const left = await centroid(page, 'b_femur_l')
  expect(Math.hypot(...left.map((v, i) => v - leftRest[i]))).toBeLessThan(0.002)

  await slider.fill('140')
  await expect(page.getByTestId('motion-value')).toHaveText('140°')
  const full = await centroid(page, 'b_tibia_r')
  expect(full[1]).toBeGreaterThan(bent[1]) // past 90 degrees the shank keeps rising (z turns back as it passes horizontal)

  await page.getByTestId('motion-reset').click()
  await expect(page.getByTestId('pose-reset')).toBeVisible()
  const back = await centroid(page, 'b_tibia_r')
  expect(Math.hypot(...back.map((v, i) => v - rest[i]))).toBeLessThan(0.001)
})

test('picking still works on the posed (skinned) body', async ({ page }) => {
  await openReady(page)
  await setState(page, "{ pose: { r_knee_flexion: 90 }, showLabels: true }")
  await page.waitForTimeout(500)
  // the moved shank muscles are pickable where they are drawn now: take the anchor of a calf muscle and click it
  await expect.poll(() => evalStore<boolean>(page, "(s) => !!s.anchors['m_gastrocnemius_medial_r']"), { timeout: 20_000 }).toBe(true)
  const a = await evalStore<{ x: number; y: number }>(page, "(s) => s.anchors['m_gastrocnemius_medial_r']")
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.click(box.x + a.x, box.y + a.y)
  await expect(page.getByTestId('info-name')).toHaveText('腓肠肌内侧头')
})

test('the left knee has no slider but the pose can mirror it (left_mirror pose renders without errors)', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await openReady(page)
  await setState(page, `{ pose: ${JSON.stringify(poses.left_mirror.pose)} }`)
  await page.waitForTimeout(500)
  expect(errors).toEqual([])
})
