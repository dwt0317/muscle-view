import { expect, test } from '@playwright/test'
import { anchorOf, evalStore, gotoView, openReady, setState } from './helpers'

const hasAnchor = (page: import('@playwright/test').Page, node: string) =>
  evalStore<boolean>(page, `(s) => !!s.anchors[${JSON.stringify(node)}]`)

test('turning off the superficial layer reveals the rotator cuff', async ({ page }) => {
  await openReady(page)
  await gotoView(page, 'back')
  await setState(page, '{ showLabels: true }')
  await anchorOf(page, 'm_deltoid_spinal_r')
  expect(await hasAnchor(page, 'm_supraspinatus_r')).toBe(false) // buried under trapezius / deltoid

  await page.getByTestId('layer-superficial').uncheck()
  await page.getByTestId('layer-intermediate').uncheck()
  await anchorOf(page, 'm_supraspinatus_r')
  await expect.poll(() => hasAnchor(page, 'm_deltoid_spinal_r')).toBe(false)
  expect(await hasAnchor(page, 'm_infraspinatus_r')).toBe(true)
  expect(await evalStore<boolean>(page, "(s) => s.hidden.has('m_deltoid_spinal_r')")).toBe(true)
  expect(await evalStore<boolean>(page, "(s) => s.hidden.has('m_supraspinatus_r')")).toBe(false)
  await expect(page.getByTestId('layer-superficial')).not.toBeChecked()
  await expect(page.getByTestId('layer-deep')).toBeChecked()
})

test('searching 臀中 finds gluteus medius, selecting it frames the hip', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('search').fill('臀中')
  await expect(page.getByTestId('row-gluteus_medius')).toBeVisible()
  await expect(page.getByTestId('row-supraspinatus')).toHaveCount(0)
  await page.getByTestId('row-gluteus_medius').getByRole('button', { name: '臀中肌' }).click()
  await expect(page.getByTestId('info-name')).toHaveText('臀中肌')
  await page.waitForTimeout(1500)
  const cam = await page.evaluate(() => (window as unknown as { __mv: { camera: () => { target: number[]; position: number[] } } }).__mv.camera())
  expect(cam.target[1]).toBeGreaterThan(0.75) // hip height
  expect(cam.target[1]).toBeLessThan(1.05)
  expect(Math.hypot(cam.position[0] - cam.target[0], cam.position[2] - cam.target[2])).toBeLessThan(2.5) // zoomed in
  await expect(page.getByTestId('row-gluteus_medius')).toHaveClass(/selected/)
})

test('searching in English and Latin works too', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('search').fill('gluteus')
  await expect(page.getByTestId('row-gluteus_maximus')).toBeVisible()
  await expect(page.getByTestId('row-gluteus_minimus')).toBeVisible()
  await page.getByTestId('search').fill('M. popliteus')
  await expect(page.getByTestId('row-popliteus')).toBeVisible()
  await page.getByTestId('search').fill('zzzz')
  await expect(page.getByText('没有匹配的肌肉')).toBeVisible()
})

test('isolate keeps only the selected muscle on screen; show all restores', async ({ page }) => {
  await openReady(page)
  await setState(page, '{ showLabels: true }')
  const p = await anchorOf(page, 'm_rectus_femoris_r')
  await page.mouse.click(p.x, p.y)
  await expect(page.getByTestId('info-name')).toHaveText('股直肌')
  await page.getByTestId('isolate-selected').click()
  // only the (both-sided) rectus femoris pair remains among the muscles
  await expect
    .poll(() => evalStore<string[]>(page, "(s) => Object.keys(s.anchors).filter((n) => n.startsWith('m_'))"))
    .toEqual(expect.arrayContaining(['m_rectus_femoris_r', 'm_rectus_femoris_l']))
  const muscles = await evalStore<string[]>(page, "(s) => Object.keys(s.anchors).filter((n) => n.startsWith('m_'))")
  expect(muscles.sort()).toEqual(['m_rectus_femoris_l', 'm_rectus_femoris_r'])
  await page.getByTestId('show-all').click()
  await expect.poll(() => evalStore<number>(page, "(s) => Object.keys(s.anchors).filter((n) => n.startsWith('m_')).length")).toBeGreaterThan(20)
})

test('bone, side and group switches', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('toggle-bones').uncheck()
  expect(await evalStore<boolean>(page, "(s) => s.hidden.has('b_femur_r') && s.hidden.has('b_sacrum')")).toBe(true)
  await page.getByTestId('toggle-bones').check()
  await page.getByTestId('toggle-context-bones').uncheck()
  expect(await evalStore<boolean>(page, "(s) => s.hidden.has('b_skull') && !s.hidden.has('b_femur_r')")).toBe(true)

  await page.getByTestId('side-r').click()
  expect(await evalStore<boolean>(page, "(s) => s.hidden.has('m_deltoid_acromial_l') && !s.hidden.has('m_deltoid_acromial_r')")).toBe(true)
  await page.getByTestId('side-both').click()

  // group checkbox switches a whole group
  await page.getByTestId('chk-group-rotator_cuff').first().uncheck()
  expect(
    await evalStore<boolean>(
      page,
      "(s) => ['supraspinatus','infraspinatus','teres_minor','subscapularis'].every((id) => s.hidden.has('m_' + id + '_r') && s.hidden.has('m_' + id + '_l'))",
    ),
  ).toBe(true)
  await expect(page.getByTestId('chk-supraspinatus').first()).not.toBeChecked()
  await page.getByTestId('chk-supraspinatus').first().check()
  await expect(page.getByTestId('chk-group-rotator_cuff').first()).toHaveJSProperty('indeterminate', true)
})
