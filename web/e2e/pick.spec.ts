import { expect, test } from '@playwright/test'
import { anchorOf, evalStore, gotoView, openReady, setState } from './helpers'

test('clicking a muscle selects it and shows its three-language names', async ({ page }) => {
  await openReady(page)
  await setState(page, '{ showLabels: true }')
  const p = await anchorOf(page, 'm_deltoid_acromial_r')
  await page.mouse.click(p.x, p.y)

  await expect(page.getByTestId('info-name')).toHaveText('三角肌肩峰部（中束）')
  await expect(page.getByTestId('info-side')).toHaveText('右侧')
  await expect(page.getByTestId('info-names')).toContainText('Deltoid, acromial part')
  await expect(page.getByTestId('info-names')).toContainText('M. deltoideus, pars acromialis')
  await expect(page.getByTestId('info-origin')).toContainText('肩峰')
  await expect(page.getByTestId('callout')).toContainText('三角肌肩峰部')
  expect(await evalStore<string>(page, '(s) => s.selected')).toBe('m_deltoid_acromial_r')
})

test('switching the language changes the displayed names', async ({ page }) => {
  await openReady(page)
  await setState(page, "{ showLabels: true }")
  const p = await anchorOf(page, 'm_pectoralis_major_sternocostal_l')
  await page.mouse.click(p.x, p.y)
  await expect(page.getByTestId('info-name')).toHaveText('胸大肌胸肋部')

  await page.getByTestId('lang-en').click()
  await expect(page.getByTestId('info-name')).toHaveText('Pectoralis major, sternocostal head')
  await expect(page.getByTestId('info-side')).toHaveText('Left')
  await expect(page.getByTestId('info-origin')).toContainText('Anterior sternum')
  await expect(page.getByTestId('callout')).toHaveText('Pectoralis major, sternocostal head (L)')

  await page.getByTestId('lang-la').click()
  await expect(page.getByTestId('info-name')).toHaveText('M. pectoralis major, pars sternocostalis')
  await expect(page.getByTestId('callout')).toContainText('(L)')

  await page.getByTestId('lang-zh').click()
  await expect(page.getByTestId('info-name')).toHaveText('胸大肌胸肋部')
})

test('clicking empty space clears the selection; hover shows a tooltip', async ({ page }) => {
  await openReady(page)
  await setState(page, '{ showLabels: true }')
  const p = await anchorOf(page, 'm_rectus_femoris_r')
  await page.mouse.move(p.x - 30, p.y)
  await page.mouse.move(p.x, p.y, { steps: 4 })
  await expect(page.getByTestId('hover-tip')).toBeVisible()
  await page.mouse.click(p.x, p.y)
  await expect(page.getByTestId('info-panel')).toBeVisible()

  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.click(box.x + 30, box.y + box.height - 30)
  await expect(page.getByTestId('info-empty')).toBeVisible()
  expect(await evalStore<string | null>(page, '(s) => s.selected')).toBeNull()
})

test('a deep muscle can be picked once the layers above it are hidden', async ({ page }) => {
  await openReady(page)
  await gotoView(page, 'back')
  // hide every superficial/intermediate muscle through the store (the UI for this arrives in a later task)
  await page.evaluate(`(() => {
    const st = window.__mv.store.getState()
    const hide = new Set()
    for (const m of st.manifest.muscles) if (m.layer !== 'deep') { hide.add(m.nodes.r); hide.add(m.nodes.l) }
    window.__mv.store.setState({ hidden: hide, showLabels: true })
  })()`)
  const p = await anchorOf(page, 'm_supraspinatus_r')
  await page.mouse.click(p.x, p.y)
  await expect(page.getByTestId('info-name')).toHaveText('冈上肌')
  await page.getByTestId('lang-la').click()
  await expect(page.getByTestId('info-name')).toHaveText('M. supraspinatus')
  await expect(page.getByTestId('info-names')).toContainText('Supraspinatus')
})

test('bones are pickable and show their names', async ({ page }) => {
  await openReady(page)
  await gotoView(page, 'front')
  await page.evaluate(`(() => {
    const st = window.__mv.store.getState()
    const hide = new Set()
    for (const m of st.manifest.muscles) { hide.add(m.nodes.r); hide.add(m.nodes.l) }
    window.__mv.store.setState({ hidden: hide, showLabels: true })
  })()`)
  // bones are not labelled, so ask the picker for the pixel of the right femur through the anchors of a hidden muscle's neighbour
  // simplest: click where the femur must be (mid-thigh, patient's right = screen left of centre)
  const box = (await page.locator('canvas').boundingBox())!
  await page.waitForTimeout(500)
  let found = false
  for (const dx of [-0.075, -0.07, -0.08, -0.065, -0.085]) {
    // body height 1.75 m spans about 72 % of the canvas height; femur mid-shaft is at z=0.65 m
    await page.mouse.click(box.x + box.width / 2 + dx * (box.height / 3.4) * 2.6, box.y + box.height * 0.5 + (0.95 - 0.62) * (box.height / 3.4) * 2.6 * 0.42)
    if (await page.getByTestId('info-name').isVisible()) {
      const t = await page.getByTestId('info-name').innerText()
      if (t === '股骨') { found = true; break }
    }
  }
  expect(found).toBe(true)
})
