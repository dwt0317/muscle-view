import { expect, test } from '@playwright/test'
import { evalStore, openReady } from './helpers'

const patchState = (page: import('@playwright/test').Page) =>
  page.evaluate(`(() => {
    const r = window.__mv.registry()
    const vis = [...r.patches.values()].filter((m) => m.visible)
    return vis.map((m) => ({ name: m.name, role: m.userData.role, color: m.material.color.getHexString() }))
  })()`) as Promise<{ name: string; role: string; color: string }[]>

const visibleMuscles = (page: import('@playwright/test').Page) =>
  page.evaluate(`(() => {
    const r = window.__mv.registry()
    return [...r.meshes].filter(([n, m]) => n.startsWith('m_') && m.visible).map(([n, m]) => ({ n, o: m.material.opacity }))
  })()`) as Promise<{ n: string; o: number }[]>

test('selecting supraspinatus lists its attachments; attachment mode shows red origin and blue insertion on the bones', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('search').fill('冈上肌')
  await page.getByTestId('row-supraspinatus').getByRole('button', { name: '冈上肌' }).click()
  await expect(page.getByTestId('info-name')).toHaveText('冈上肌')

  // text summary
  await expect(page.getByTestId('att-origin').first()).toContainText('肩胛骨')
  await expect(page.getByTestId('att-insertion').first()).toContainText('肱骨')
  await expect(page.getByTestId('att-origin').first()).toContainText('cm²')

  // patches exist for the selected muscle/side only
  const patches = await patchState(page)
  expect(patches.map((p) => p.name).sort()).toEqual(['p_supraspinatus_r_i_humerus', 'p_supraspinatus_r_o_scapula'])
  expect(patches.find((p) => p.role === 'origin')!.color).toBe('ff3b3b')
  expect(patches.find((p) => p.role === 'insertion')!.color).toBe('3b8bff')

  // before attachment mode all muscles are still drawn; afterwards only a ghost of the selected one remains
  expect((await visibleMuscles(page)).length).toBeGreaterThan(100)
  await page.getByTestId('toggle-attach-info').click()
  const after = await visibleMuscles(page)
  expect(after).toHaveLength(1)
  expect(after[0].n).toBe('m_supraspinatus_r')
  expect(after[0].o).toBeLessThan(0.5)
  expect(await evalStore<boolean>(page, '(s) => s.attachMode')).toBe(true)
  await expect(page.getByTestId('toggle-attach')).toBeChecked()

  // bones stay visible
  expect(await page.evaluate("window.__mv.registry().meshes.get('b_scapula_r').visible")).toBe(true)

  // switching to another muscle moves the patches
  await page.getByTestId('search').fill('臀中')
  await page.getByTestId('row-gluteus_medius').getByRole('button', { name: '臀中肌' }).click()
  const p2 = (await patchState(page)).map((p) => p.name).sort()
  expect(p2).toEqual(['p_gluteus_medius_r_i_femur', 'p_gluteus_medius_r_o_hip_bone'])
  expect((await visibleMuscles(page)).map((m) => m.n)).toEqual(['m_gluteus_medius_r'])

  // leaving the mode brings everything back; deselecting hides the patches
  await page.getByTestId('toggle-attach').uncheck()
  expect((await visibleMuscles(page)).length).toBeGreaterThan(100)
  await page.getByRole('button', { name: '关闭' }).first().click()
  expect(await patchState(page)).toEqual([])
})

test('the attachment list follows the language and marks the data source', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('search').fill('gluteus medius')
  await page.getByTestId('lang-en').click()
  await page.getByTestId('row-gluteus_medius').getByRole('button').nth(0).click()
  await expect(page.getByTestId('att-origin').first()).toContainText('Hip bone')
  await expect(page.getByTestId('att-origin').first()).toContainText('hand-drawn') // adopted from Z-Anatomy decals
})

test('review mode: step through muscles, mark them, export review.json and keep the verdicts after a reload', async ({ page }) => {
  await openReady(page)
  await page.getByTestId('toggle-review').check()
  await expect(page.getByTestId('review-panel')).toBeVisible()
  await expect(page.getByTestId('review-current')).toContainText('1/73')
  const first = await evalStore<string>(page, '(s) => s.selected')
  expect(first).toMatch(/^m_.*_r$/)
  expect(await evalStore<boolean>(page, '(s) => s.attachMode')).toBe(true)
  expect((await patchState(page)).length).toBeGreaterThan(0)

  await page.getByTestId('review-ok').click() // approves #1 and jumps to the next pending muscle
  await expect(page.getByTestId('review-current')).toContainText('2/73')
  await page.getByTestId('review-note').fill('起点范围偏大')
  await page.getByTestId('review-issue').click()
  await expect(page.getByTestId('review-progress')).toContainText('2/73')
  await expect(page.getByTestId('review-progress')).toContainText('✓1')
  await expect(page.getByTestId('review-progress')).toContainText('✗1')

  // go back and check state label
  await page.getByTestId('review-prev').click()
  await page.getByTestId('review-prev').click()
  await expect(page.getByTestId('review-state')).toContainText('已通过')
  await page.getByTestId('review-next').click()
  await expect(page.getByTestId('review-state')).toContainText('有问题')
  await expect(page.getByTestId('review-note')).toHaveValue('起点范围偏大')

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('review-export').click()])
  expect(download.suggestedFilename()).toBe('review.json')
  const body = JSON.parse(await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8'))
  expect(body.version).toBe(1)
  expect(body.items).toHaveLength(2)
  expect(body.items.map((i: { verdict: string }) => i.verdict)).toEqual(['ok', 'issue'])
  expect(body.items[1].note).toBe('起点范围偏大')
  expect(body.items[0].attachments.length).toBeGreaterThan(0)

  // persisted in localStorage
  await page.reload()
  await expect(page.getByTestId('status')).toHaveText('就绪')
  await page.getByTestId('toggle-review').check()
  await expect(page.getByTestId('review-progress')).toContainText('2/73')
})
