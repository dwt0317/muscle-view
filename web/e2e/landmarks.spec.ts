import { expect, test } from '@playwright/test'
import { anchorOf, evalStore, openReady } from './helpers'

test('the skin slider shows a translucent skin over the model', async ({ page }) => {
  await openReady(page)
  const canvas = page.locator('canvas')
  await page.waitForTimeout(800)
  const before = await canvas.screenshot()
  expect(await page.evaluate("window.__mv.registry().skin.visible")).toBe(false)

  await page.getByTestId('skin-slider').fill('40')
  await expect(page.getByTestId('skin-value')).toHaveText('40%')
  expect(await evalStore<number>(page, '(s) => s.skinOpacity')).toBeCloseTo(0.4)
  expect(await page.evaluate("window.__mv.registry().skin.visible")).toBe(true)
  expect(await page.evaluate("window.__mv.registry().skin.material.opacity")).toBeCloseTo(0.4)
  await page.waitForTimeout(800)
  const during = await canvas.screenshot()
  expect(Buffer.compare(before, during)).not.toBe(0)

  await page.getByTestId('skin-slider').fill('0')
  expect(await page.evaluate("window.__mv.registry().skin.visible")).toBe(false)
})

test('ASIS landmark: visible through the skin, shows palpation tip and the muscles that attach there', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('skin-slider').fill('40')
  await page.getByTestId('toggle-landmarks').check()

  const p = await anchorOf(page, 'lm_asis_r')
  await page.mouse.move(p.x - 20, p.y - 20)
  await page.mouse.move(p.x, p.y, { steps: 5 })
  await expect(page.getByTestId('hover-tip')).toContainText('髂前上棘')
  await page.mouse.click(p.x, p.y)

  await expect(page.getByTestId('info-name')).toHaveText('髂前上棘（ASIS）')
  await expect(page.getByTestId('info-names')).toContainText('Spina iliaca anterior superior')
  await expect(page.getByTestId('landmark-palpation')).toContainText('髂嵴')
  await expect(page.getByTestId('lm-muscle-sartorius')).toHaveText('缝匠肌')
  await expect(page.getByTestId('lm-muscle-tensor_fasciae_latae')).toHaveText('阔筋膜张肌')

  // language switch translates the tags and the palpation text
  await page.getByTestId('lang-en').click()
  await expect(page.getByTestId('info-name')).toHaveText('Anterior superior iliac spine (ASIS)')
  await expect(page.getByTestId('landmark-palpation')).toContainText('iliac crest')
  await expect(page.getByTestId('lm-muscle-sartorius')).toHaveText('Sartorius')

  // jump from the landmark to an attaching muscle
  await page.getByTestId('lm-muscle-sartorius').click()
  await expect(page.getByTestId('info-name')).toHaveText('Sartorius')
})

test('landmark markers sit on the skin when it is shown and on the bone when it is not', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('toggle-landmarks').check()
  const pos = () =>
    page.evaluate(
      `(() => { const r = window.__mv.registry(); const m = r.meshes.get('lm_greater_trochanter_r'); r.root.updateMatrixWorld(true); return m.getWorldPosition(m.position.clone()).toArray() })()`,
    ) as Promise<number[]>
  const expected = await page.evaluate(`(() => {
    const it = window.__mv.store.getState().manifest.landmarks.find(l => l.id === 'greater_trochanter').items.r
    return { bone: it.bonePos, skin: it.skinPos }
  })()`) as { bone: number[]; skin: number[] }

  const onBone = await pos()
  expect(onBone[0]).toBeCloseTo(expected.bone[0], 3)
  expect(onBone[1]).toBeCloseTo(expected.bone[1], 3)
  await page.getByTestId('skin-slider').fill('30')
  const onSkin = await pos()
  expect(onSkin[0]).toBeCloseTo(expected.skin[0], 3)
  expect(onSkin[1]).toBeCloseTo(expected.skin[1], 3)
  // the skin point is outside the bone point (further from the body axis)
  expect(Math.abs(onSkin[0])).toBeGreaterThan(Math.abs(onBone[0]))
})

test('markers are hidden when the landmark switch is off', async ({ page }) => {
  await openReady(page)
  expect(await page.evaluate("window.__mv.registry().meshes.get('lm_asis_r').visible")).toBe(false)
  await page.getByTestId('toggle-landmarks').check()
  expect(await page.evaluate("window.__mv.registry().meshes.get('lm_asis_r').visible")).toBe(true)
  await page.getByTestId('toggle-landmarks').uncheck()
  expect(await page.evaluate("window.__mv.registry().meshes.get('lm_asis_r').visible")).toBe(false)
})
