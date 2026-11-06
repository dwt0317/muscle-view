import { expect, test } from '@playwright/test'
import { evalStore, openReady } from './helpers'

const camera = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __mv: { camera: () => { position: number[]; target: number[] } } }).__mv.camera())

const visibleMuscleNodes = (page: import('@playwright/test').Page) =>
  page.evaluate(`[...window.__mv.registry().meshes].filter(([n, m]) => n.startsWith('m_') && m.visible).map(([n]) => n)`) as Promise<string[]>

test('full workflow: focus the knee -> hide the superficial layers -> pick popliteus -> see its attachments -> play knee flexion', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await openReady(page)

  // 1. focus the knee: the camera flies there and only knee structures stay
  await page.getByTestId('region-btn-knee').click()
  await page.waitForTimeout(1800)
  const cam = await camera(page)
  expect(cam.target[1]).toBeGreaterThan(0.3) // around the knee
  expect(cam.target[1]).toBeLessThan(0.75)
  const dist = Math.hypot(...cam.position.map((p, i) => p - cam.target[i]))
  expect(dist).toBeLessThan(2.6) // zoomed in from the 3.4 m full-body view
  expect(cam.position[2]).toBeGreaterThan(0) // seen from the front
  const shown = await visibleMuscleNodes(page)
  expect(shown).toContain('m_popliteus_r')
  expect(shown).toContain('m_vastus_lateralis_l')
  expect(shown).not.toContain('m_supraspinatus_r')
  expect(shown).not.toContain('m_gluteus_medius_r')
  await expect(page.getByTestId('region-btn-knee')).toHaveClass(/active/)
  // bones of other regions are gone, the femur and tibia stay
  expect(await page.evaluate("window.__mv.registry().meshes.get('b_scapula_r').visible")).toBe(false)
  expect(await page.evaluate("window.__mv.registry().meshes.get('b_tibia_r').visible")).toBe(true)

  // 2. switch the superficial layer off: the deep popliteus stays, the superficial hamstrings go
  await page.getByTestId('layer-superficial').uncheck()
  const shown2 = await visibleMuscleNodes(page)
  expect(shown2).toContain('m_popliteus_r')
  expect(shown2).not.toContain('m_semitendinosus_r')

  // 3. pick popliteus from the tree
  await page.getByTestId('search').fill('腘肌')
  await page.getByTestId('row-popliteus').getByRole('button', { name: '腘肌' }).click()
  await expect(page.getByTestId('info-name')).toHaveText('腘肌')
  await expect(page.getByTestId('att-origin').first()).toContainText('股骨')
  await expect(page.getByTestId('att-insertion').first()).toContainText('胫骨')

  // 4. attachments shown on the bones
  await page.getByTestId('toggle-attach-info').click()
  const patches = await page.evaluate(`[...window.__mv.registry().patches.values()].filter((m) => m.visible).map((m) => m.name).sort()`)
  expect(patches).toEqual(['p_popliteus_r_i_tibia', 'p_popliteus_r_o_femur'])

  // 5. play knee flexion: the shank swings, the popliteus is coloured by its length change
  await page.getByTestId('motion-select').selectOption('knee_flexion')
  await page.getByTestId('motion-slider').fill('0')
  const before = await page.evaluate(`window.__mv.registry().meshes.get('b_tibia_r').getWorldPosition(new (window.__mv.registry().root.position.constructor)()).toArray()`) as number[]
  await page.getByTestId('motion-play').click()
  await page.waitForTimeout(1500)
  expect(await evalStore<number>(page, '(s) => s.motionValue')).toBeGreaterThan(5)
  await page.getByTestId('motion-play').click() // pause
  const angle = await evalStore<number>(page, "(s) => s.pose['r_knee_flexion']")
  expect(angle).toBeGreaterThan(5)
  const after = await page.evaluate(`(() => { const m = window.__mv.registry().meshes.get('b_tibia_r'); const b = new m.geometry.boundingBox.constructor().setFromObject(m); return b.getCenter(new m.position.constructor()).toArray() })()`) as number[]
  expect(Math.hypot(...after.map((v, i) => v - (before[i] ?? 0)))).toBeGreaterThan(0.01)
  const col = await page.evaluate("'#' + window.__mv.registry().meshes.get('m_popliteus_r').material.color.getHexString()")
  expect(col).not.toBe('#b8453f') // coloured by the motion, not the plain muscle colour

  // back to the whole body
  await page.getByTestId('region-btn-all').click()
  await page.waitForTimeout(1500)
  expect(await evalStore<boolean>(page, '(s) => s.attachMode')).toBe(false) // changing the region leaves the attachment view
  const everywhere = await visibleMuscleNodes(page)
  expect(everywhere).toContain('m_supraspinatus_r') // the region filter is gone ...
  expect(everywhere).toContain('m_gluteus_medius_r')
  expect(everywhere).not.toContain('m_deltoid_acromial_r') // ... but the layer switch from step 2 is independent and stays
  expect(errors).toEqual([])
})

test('each region frames its own area; the lumbar view comes from behind; the whole-body button restores everything', async ({ page }) => {
  await openReady(page)
  const expected: Record<string, { yMin: number; yMax: number; zSign: number; hidden: string; shown: string }> = {
    shoulder: { yMin: 1.15, yMax: 1.55, zSign: 1, hidden: 'm_popliteus_r', shown: 'm_supraspinatus_r' },
    hip: { yMin: 0.7, yMax: 1.15, zSign: 1, hidden: 'm_supraspinatus_r', shown: 'm_gluteus_medius_r' },
    knee: { yMin: 0.3, yMax: 0.75, zSign: 1, hidden: 'm_supraspinatus_r', shown: 'm_popliteus_r' },
    lumbar: { yMin: 0.85, yMax: 1.3, zSign: -1, hidden: 'm_popliteus_r', shown: 'm_quadratus_lumborum_r' },
  }
  for (const [r, e] of Object.entries(expected)) {
    await page.getByTestId(`region-btn-${r}`).click()
    await page.waitForTimeout(1700)
    const cam = await camera(page)
    expect(cam.target[1], `${r} target height`).toBeGreaterThan(e.yMin)
    expect(cam.target[1], `${r} target height`).toBeLessThan(e.yMax)
    expect(Math.sign(cam.position[2]), `${r} view side`).toBe(e.zSign)
    const shown = await visibleMuscleNodes(page)
    expect(shown, r).toContain(e.shown)
    expect(shown, r).not.toContain(e.hidden)
  }
  // clicking the active region again (or "whole body") brings everything back
  await page.getByTestId('region-btn-lumbar').click()
  await page.waitForTimeout(1200)
  expect((await visibleMuscleNodes(page)).length).toBe(146)
  expect(await evalStore<string | null>(page, '(s) => s.vis.region')).toBeNull()
})

test('landmarks follow the region focus', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('toggle-landmarks').check()
  await page.getByTestId('region-btn-knee').click()
  const vis = await page.evaluate(`['lm_tibial_tuberosity_r', 'lm_asis_r', 'lm_acromion_r'].map((n) => window.__mv.registry().meshes.get(n).visible)`)
  expect(vis).toEqual([true, false, false])
  await page.getByTestId('region-btn-all').click()
  const all = await page.evaluate(`['lm_tibial_tuberosity_r', 'lm_asis_r', 'lm_acromion_r'].map((n) => window.__mv.registry().meshes.get(n).visible)`)
  expect(all).toEqual([true, true, true])
})

test('the footer carries the licences and the clinical-review notice in every language', async ({ page }) => {
  await openReady(page)
  const footer = page.locator('.footer')
  await expect(footer).toContainText('BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan')
  await expect(footer).toContainText('Z-Anatomy')
  await expect(footer).toContainText('待临床确认')
  await page.getByTestId('lang-en').click()
  await expect(footer).toContainText('pending clinical review')
})
