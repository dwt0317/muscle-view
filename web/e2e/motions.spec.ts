import { expect, test } from '@playwright/test'
import { evalStore, openReady } from './helpers'

const colorOf = (page: import('@playwright/test').Page, node: string) =>
  page.evaluate(`'#' + window.__mv.registry().meshes.get(${JSON.stringify(node)}).material.color.getHexString()`) as Promise<string>

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const isReddish = (hex: string) => {
  const [r, g, b] = channels(hex)
  return r > g + 40 && r > b + 40
}
const isBluish = (hex: string) => {
  const [r, g, b] = channels(hex)
  return b > r + 40 && b > g
}
const isGrey = (hex: string) => {
  const [r, g, b] = channels(hex)
  return Math.max(r, g, b) - Math.min(r, g, b) < 30
}

test('the motion list covers the four regions, 9 motions', async ({ page }) => {
  await openReady(page)
  const options = await page.getByTestId('motion-select').locator('option').allTextContents()
  expect(options).toEqual(expect.arrayContaining(['肩外展', '肩前屈 / 后伸', '肩内旋 / 外旋', '髋屈 / 伸', '髋外展 / 内收', '膝屈 / 伸', '腰前屈 / 后伸', '腰侧屈', '躯干旋转']))
  expect(options.filter((o) => o && !o.startsWith('—'))).toHaveLength(9)
  expect(await page.getByTestId('motion-select').locator('optgroup').evaluateAll((els) => els.map((e) => e.getAttribute('label')))).toEqual(['肩', '髋', '膝', '腰'])
})

test('shoulder abduction: deltoid and supraspinatus turn red, latissimus and pectoralis turn blue; roles are listed', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('motion-select').selectOption('shoulder_abduction')
  await page.getByTestId('motion-slider').fill('90')
  await expect(page.getByTestId('motion-direction')).toHaveText('外展')

  expect(isReddish(await colorOf(page, 'm_deltoid_acromial_r'))).toBe(true)
  expect(isReddish(await colorOf(page, 'm_supraspinatus_r'))).toBe(true)
  expect(isBluish(await colorOf(page, 'm_latissimus_dorsi_r'))).toBe(true)
  expect(isBluish(await colorOf(page, 'm_pectoralis_major_sternocostal_r'))).toBe(true)
  // the left side is not part of the motion
  expect(isGrey(await colorOf(page, 'm_deltoid_acromial_l'))).toBe(true)

  await expect(page.getByTestId('roles-agonist')).toContainText('三角肌肩峰部')
  await expect(page.getByTestId('roles-agonist')).toContainText('冈上肌')
  await expect(page.getByTestId('roles-antagonist')).toContainText('背阔肌')
  await expect(page.getByTestId('roles-stabilizer')).toContainText('前锯肌')
  await expect(page.getByTestId('motion-legend')).toContainText('缩短')
  await expect(page.getByTestId('motion-legend')).toContainText('拉长')

  // scapulohumeral rhythm: at 90 degrees the scapula has rotated about 20 degrees
  const pose = await evalStore<Record<string, number>>(page, '(s) => s.pose')
  expect(pose.r_shoulder_abduction).toBeCloseTo(90)
  expect(pose.r_scapula_upward).toBeCloseTo(20, 0)

  // at rest every muscle goes back to the plain muscle colour
  await page.getByTestId('motion-slider').fill('0')
  expect(isReddish(await colorOf(page, 'm_deltoid_acromial_r'))).toBe(false)
  expect(isBluish(await colorOf(page, 'm_latissimus_dorsi_r'))).toBe(false)
  expect(isGrey(await colorOf(page, 'm_deltoid_acromial_r'))).toBe(true)
})

test('knee flexion: hamstrings shorten, quadriceps lengthen', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('motion-select').selectOption('knee_flexion')
  await page.getByTestId('motion-slider').fill('140')
  expect(isReddish(await colorOf(page, 'm_semitendinosus_r'))).toBe(true)
  expect(isReddish(await colorOf(page, 'm_biceps_femoris_long_r'))).toBe(true)
  expect(isBluish(await colorOf(page, 'm_vastus_medialis_r'))).toBe(true)
  expect(isBluish(await colorOf(page, 'm_rectus_femoris_r'))).toBe(true)
  await expect(page.getByTestId('roles-antagonist')).toContainText('股直肌')
  await expect(page.getByTestId('roles-agonist')).toContainText('半腱肌')
})

test('negative parameter values switch the direction and the roles (shoulder extension, hip extension)', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('motion-select').selectOption('hip_flexion')
  await page.getByTestId('motion-slider').fill('60')
  await expect(page.getByTestId('motion-direction')).toHaveText('屈')
  await expect(page.getByTestId('roles-agonist')).toContainText('髂肌')
  await expect(page.getByTestId('roles-antagonist')).toContainText('臀大肌')

  await page.getByTestId('motion-slider').fill('-15')
  await expect(page.getByTestId('motion-direction')).toHaveText('伸')
  await expect(page.getByTestId('roles-agonist')).toContainText('臀大肌')
  await expect(page.getByTestId('roles-antagonist')).toContainText('髂肌')
})

test('trunk side bend colours the two sides in opposite ways and the roles name the side', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('motion-select').selectOption('trunk_lateral')
  await page.getByTestId('motion-slider').fill('30')
  await expect(page.getByTestId('motion-direction')).toHaveText('向右侧屈')
  expect(isReddish(await colorOf(page, 'm_quadratus_lumborum_r'))).toBe(true)
  expect(isBluish(await colorOf(page, 'm_quadratus_lumborum_l'))).toBe(true)
  await expect(page.getByTestId('role-agonist-quadratus_lumborum-ipsi')).toContainText('同侧')
  await expect(page.getByTestId('role-antagonist-quadratus_lumborum-contra')).toContainText('对侧')

  await page.getByTestId('motion-slider').fill('-30')
  await expect(page.getByTestId('motion-direction')).toHaveText('向左侧屈')
  expect(isReddish(await colorOf(page, 'm_quadratus_lumborum_l'))).toBe(true)
  expect(isBluish(await colorOf(page, 'm_quadratus_lumborum_r'))).toBe(true)
})

test('play sweeps the motion back and forth and pause stops it', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('motion-select').selectOption('knee_flexion')
  await page.getByTestId('motion-play').click()
  const seen: number[] = []
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(450)
    seen.push(await evalStore<number>(page, '(s) => s.motionValue'))
  }
  expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(30) // it moves
  expect(await evalStore<boolean>(page, '(s) => s.playing')).toBe(true)

  await page.getByTestId('motion-play').click() // pause
  const a = await evalStore<number>(page, '(s) => s.motionValue')
  await page.waitForTimeout(500)
  const b = await evalStore<number>(page, '(s) => s.motionValue')
  expect(b).toBe(a)
  expect(await evalStore<boolean>(page, '(s) => s.playing')).toBe(false)

  // dragging the slider while playing takes over
  await page.getByTestId('motion-play').click()
  await page.getByTestId('motion-slider').fill('40')
  expect(await evalStore<boolean>(page, '(s) => s.playing')).toBe(false)
})

test('clicking a role chip selects and shows that muscle; chips follow the language', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('motion-select').selectOption('shoulder_abduction')
  await page.getByTestId('motion-slider').fill('60')
  await page.getByTestId('role-antagonist-latissimus_dorsi').click()
  await expect(page.getByTestId('info-name')).toHaveText('背阔肌（右）'.replace('（右）', ''))
  expect(await evalStore<string>(page, '(s) => s.selected')).toBe('m_latissimus_dorsi_r')

  await page.getByTestId('lang-en').click()
  await expect(page.getByTestId('roles-agonist')).toContainText('Supraspinatus')
  await expect(page.getByTestId('motion-direction')).toHaveText('Abduction')
})

test('a selected muscle keeps its orange highlight on top of the motion colour', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('motion-select').selectOption('shoulder_abduction')
  await page.getByTestId('motion-slider').fill('90')
  await page.getByTestId('role-agonist-deltoid_acromial').click()
  const em = await page.evaluate("window.__mv.registry().meshes.get('m_deltoid_acromial_r').material.emissiveIntensity")
  expect(em).toBeGreaterThan(0.3)
  expect(isReddish(await colorOf(page, 'm_deltoid_acromial_r'))).toBe(true) // still coloured by length
})
