import { expect, type Page } from '@playwright/test'

export async function openReady(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await expect(page.getByTestId('status')).toHaveText(/就绪|Ready/)
}

/** Run code inside the page with access to the zustand store. */
export function evalStore<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const s = window.__mv.store.getState(); return (${fn})(s) })()`) as Promise<T>
}

export async function setState(page: Page, patch: string): Promise<void> {
  await page.evaluate(`window.__mv.store.setState(${patch})`)
}

/** Client coordinates of the anchor point of a node (needs labels on or the node selected). */
export async function anchorOf(page: Page, node: string): Promise<{ x: number; y: number }> {
  await expect
    .poll(() => evalStore<boolean>(page, `(s) => !!s.anchors[${JSON.stringify(node)}]`), { timeout: 20_000 })
    .toBe(true)
  const a = await evalStore<{ x: number; y: number }>(page, `(s) => s.anchors[${JSON.stringify(node)}]`)
  const box = (await page.locator('canvas').boundingBox())!
  return { x: box.x + a.x, y: box.y + a.y }
}

export async function gotoView(page: Page, view: string): Promise<void> {
  await page.getByTestId(`view-${view}`).click()
  await page.waitForTimeout(1500)
}
