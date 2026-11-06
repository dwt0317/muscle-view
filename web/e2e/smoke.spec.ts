import { expect, test } from '@playwright/test'

interface Mv {
  camera: () => { position: number[]; target: number[] }
}
const cam = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __mv: Mv }).__mv.camera())

test('loads the model without console errors and renders a canvas', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/')
  await expect(page.getByTestId('status')).toHaveText('就绪')
  const canvas = page.locator('canvas')
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  expect(box!.width).toBeGreaterThan(400)
  expect(box!.height).toBeGreaterThan(400)
  // the footer shows the licence attribution once the manifest has loaded
  await expect(page.locator('.footer')).toContainText('BodyParts3D')
  await expect(page.locator('.footer')).toContainText('Z-Anatomy')
  expect(errors).toEqual([])
})

test('the canvas actually draws the body (non-background pixels in the centre)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('status')).toHaveText('就绪')
  await page.waitForTimeout(1500)
  const shot = await page.locator('canvas').screenshot()
  expect(shot.length).toBeGreaterThan(20_000) // an empty dark canvas compresses to a few KB
})

test('dragging rotates the camera around the body', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('status')).toHaveText('就绪')
  await page.waitForTimeout(500)
  const before = await cam(page)
  const box = (await page.locator('canvas').boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 220, cy, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(600)
  const after = await cam(page)
  // the camera moved sideways (x changed) while the orbit target stayed put
  expect(Math.abs(after.position[0] - before.position[0])).toBeGreaterThan(0.5)
  expect(after.target[1]).toBeCloseTo(before.target[1], 1)
  const dist = (c: { position: number[]; target: number[] }) =>
    Math.hypot(...c.position.map((p, i) => p - c.target[i]))
  expect(dist(after)).toBeCloseTo(dist(before), 1)
})

test('preset view buttons move the camera to the expected side', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('status')).toHaveText('就绪')
  const go = async (id: string) => {
    await page.getByTestId(`view-${id}`).click()
    await page.waitForTimeout(1200)
    return cam(page)
  }
  const back = await go('back')
  expect(back.position[2]).toBeLessThan(-3)
  const right = await go('right') // the patient's right = -X
  expect(right.position[0]).toBeLessThan(-3)
  const left = await go('left')
  expect(left.position[0]).toBeGreaterThan(3)
  const reset = await go('reset')
  expect(reset.position[2]).toBeGreaterThan(3)
  expect(Math.abs(reset.position[0])).toBeLessThan(0.05)
})
