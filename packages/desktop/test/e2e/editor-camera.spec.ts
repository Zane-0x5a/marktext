import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import {
  enterSourceMode,
  exitSourceMode,
  expectNoRendererErrors,
  launchWithMarkdown
} from './helpers'

const paragraph = 'Fixed layout 中文排版 stays exactly the same while the camera moves. '.repeat(12)
const markdown = `# Document camera\n\n${paragraph}\n\n| Column A | Column B |\n| --- | --- |\n| Fixed table | Unchanged layout |\n\n$$\nE = mc^2\n$$\n\n\`\`\`js\nconst vector = true\n\`\`\`\n\n` +
  Array.from({ length: 160 }, (_, i) => `## Section ${i}\n\n${paragraph}\n\n`).join('')

const readScale = (page: Page, selector = '.editor-component'): Promise<number> =>
  page.locator(selector).evaluate((el) => Number((el as HTMLElement).dataset.editorScale))

const pinch = async(page: Page, factor: number, selector = '.editor-component'): Promise<void> => {
  const viewport = page.locator(selector)
  const box = (await viewport.boundingBox())!
  const before = await readScale(page, selector)
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -Math.log(factor) / 0.01)
  await page.keyboard.up('Control')
  await expect.poll(() => readScale(page, selector)).toBeCloseTo(Math.min(4, Math.max(0.25, before * factor)), 5)
}

const layoutSnapshot = (page: Page) => page.evaluate(() => {
  const root = document.querySelector<HTMLElement>('.editor-component')!
  const scale = Number(root.dataset.editorScale)
  const plane = root.querySelector<HTMLElement>('.editor-camera-plane')!
  const planeRect = plane.getBoundingClientRect()
  return Array.from(root.querySelectorAll<HTMLElement>('.mu-container > *')).map((el) => {
    const rect = el.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(el)
    return {
      width: el.offsetWidth,
      height: el.offsetHeight,
      font: getComputedStyle(el).fontSize,
      x: (rect.x - planeRect.x) / scale,
      y: (rect.y - planeRect.y) / scale,
      lines: Array.from(range.getClientRects()).map((line) => [
        (line.x - planeRect.x) / scale,
        (line.y - planeRect.y) / scale,
        line.width / scale,
        line.height / scale
      ].map((value) => Math.round(value * 1000) / 1000))
    }
  })
})

const expectSameLayout = async(page: Page, before: Awaited<ReturnType<typeof layoutSnapshot>>) => {
  const after = await layoutSnapshot(page)
  expect(after.map(({ width, height, font, lines }) => ({ width, height, font, lines: lines.length })))
    .toEqual(before.map(({ width, height, font, lines }) => ({ width, height, font, lines: lines.length })))
  const errors = after.flatMap((block, i) => [
    Math.abs(block.x - before[i].x),
    Math.abs(block.y - before[i].y),
    ...block.lines.flatMap((line, j) => line.map((value, k) => Math.abs(value - before[i].lines[j][k])))
  ])
  // Client rects use float32 screen coordinates. At large document offsets,
  // inverse-transforming those values loses a fraction of a CSS subpixel.
  expect(Math.max(...errors)).toBeLessThan(0.03)
}

test.describe('Document camera pinch', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeEach(async() => {
    const launched = await launchWithMarkdown(markdown, {
      suppressErrorDialog: true,
      preferences: { showTabBar: true, spellcheckerEnabled: false }
    })
    app = launched.app
    page = launched.page
    await expect(page.locator('.editor-component')).toHaveAttribute('data-editor-scale', '1')
  })

  test.afterEach(async() => {
    if (app) {
      await expectNoRendererErrors(app)
      await app.close()
    }
  })

  test('preserves every block and line, UI size, and the point under the gesture', async() => {
    const before = await layoutSnapshot(page)
    const chromeSize = () => page.locator('.editor-tabs').evaluate((el) => ({
      width: (el as HTMLElement).offsetWidth,
      height: (el as HTMLElement).offsetHeight,
      font: getComputedStyle(el).fontSize
    }))
    const chrome = await chromeSize()
    const windowZoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
    await page.locator('.editor-component').evaluate((el) => { el.scrollTop = 1800 })
    const anchor = await page.locator('.editor-component').evaluate((el) => {
      const viewport = el as HTMLElement
      return { top: viewport.scrollTop, y: viewport.clientHeight * 0.45 }
    })
    await pinch(page, 2)
    await expectSameLayout(page, before)
    expect(await chromeSize()).toEqual(chrome)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(windowZoom)
    const top = await page.locator('.editor-component').evaluate((el) => el.scrollTop)
    expect(Math.abs(top - (anchor.top * 2 + anchor.y))).toBeLessThan(2)
    await pinch(page, 0.2)
    await expectSameLayout(page, before)
    const extents = await page.locator('.editor-component').evaluate((el) => ({
      scroll: el.scrollHeight,
      scaled: el.querySelector<HTMLElement>('.editor-camera-stage')!.offsetHeight
    }))
    expect(Math.abs(extents.scroll - extents.scaled)).toBeLessThan(2)
  })

  test('scrolls normally, reaches the bottom and right edge, and edits at enlarged coordinates', async() => {
    await pinch(page, 2)
    const initialTop = await page.locator('.editor-component').evaluate((el) => el.scrollTop)
    await page.mouse.wheel(0, 400)
    await expect.poll(() => page.locator('.editor-component').evaluate((el) => el.scrollTop)).toBeGreaterThan(initialTop)
    await page.locator('.editor-component').evaluate((el) => {
      el.scrollTop = el.scrollHeight
      el.scrollLeft = el.scrollWidth
    })
    const edges = await page.locator('.editor-component').evaluate((el) => ({
      top: el.scrollTop,
      maxTop: el.scrollHeight - el.clientHeight,
      left: el.scrollLeft,
      maxLeft: el.scrollWidth - el.clientWidth
    }))
    expect(Math.abs(edges.top - edges.maxTop)).toBeLessThan(1)
    expect(Math.abs(edges.left - edges.maxLeft)).toBeLessThan(1)
    await page.locator('.mu-container > h2').last().evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await expect(page.locator('.mu-container > h2').last()).toBeInViewport()
    await page.locator('.editor-component').evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0 })
    await page.locator('.mu-paragraph-content').first().click({ position: { x: 150, y: 12 } })
    await page.keyboard.type('camera-edit-token')
    await expect(page.locator('.mu-container')).toContainText('camera-edit-token')
  })

  test('resets on both directions of a tab switch and cancels an in-flight gesture', async() => {
    await pinch(page, 2)
    const originalId = await page.locator('.tabs-container li.active').getAttribute('data-id')
    await page.locator('.editor-component').evaluate((el) => { el.scrollTop = 6200 })
    await page.waitForTimeout(100)
    await page.locator('.new-file').click()
    await expect(page.locator('.tabs-container li')).toHaveCount(2)
    await expect.poll(() => readScale(page)).toBe(1)
    await pinch(page, 1.5)
    await page.locator(`.tabs-container li[data-id="${originalId}"]`).click()
    await expect.poll(() => readScale(page)).toBe(1)
    await expect.poll(async() => Math.abs(await page.locator('.editor-component').evaluate((el) => el.scrollTop) - 3100)).toBeLessThan(2)
    await page.evaluate(() => {
      const viewport = document.querySelector('.editor-component')!
      const rect = viewport.getBoundingClientRect()
      viewport.dispatchEvent(new WheelEvent('wheel', {
        ctrlKey: true,
        deltaY: -70,
        clientX: rect.x + 200,
        clientY: rect.y + 200,
        bubbles: true,
        cancelable: true
      }))
      document.querySelector<HTMLElement>('.new-file')!.click()
    })
    await expect(page.locator('.tabs-container li')).toHaveCount(3)
    await expect.poll(() => readScale(page)).toBe(1)
  })

  test('keeps source-code wrapping and typography unchanged and resets its tab camera', async() => {
    await enterSourceMode(page, app)
    const before = await page.locator('.CodeMirror').evaluate((el) => ({
      width: (el as HTMLElement).offsetWidth,
      height: (el as HTMLElement).offsetHeight,
      font: getComputedStyle(el).fontSize,
      lines: Array.from(el.querySelectorAll<HTMLElement>('.CodeMirror-line')).map((line) => [line.offsetWidth, line.offsetHeight])
    }))
    await pinch(page, 1.8, '.source-code')
    const after = await page.locator('.CodeMirror').evaluate((el) => ({
      width: (el as HTMLElement).offsetWidth,
      height: (el as HTMLElement).offsetHeight,
      font: getComputedStyle(el).fontSize,
      lines: Array.from(el.querySelectorAll<HTMLElement>('.CodeMirror-line')).map((line) => [line.offsetWidth, line.offsetHeight])
    }))
    expect(after).toEqual(before)
    await page.locator('.new-file').click()
    await expect.poll(() => readScale(page, '.source-code')).toBe(1)
    await exitSourceMode(page, app)
    await expect.poll(() => readScale(page)).toBe(1)
  })

  test('coalesces a gesture burst into one frame without document layout or mutation', async() => {
    const result = await page.evaluate(async() => {
      const root = document.querySelector<HTMLElement>('.editor-component')!
      const content = root.querySelector('.mu-container')!
      let documentMutations = 0
      const observer = new MutationObserver((records) => { documentMutations += records.length })
      observer.observe(content, { subtree: true, childList: true, attributes: true, characterData: true })
      const rect = root.getBoundingClientRect()
      const start = performance.now()
      for (let i = 0; i < 200; i++) {
        root.dispatchEvent(new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: -0.2,
          clientX: rect.x + 300,
          clientY: rect.y + 250,
          bubbles: true,
          cancelable: true
        }))
      }
      const beforeFrame = root.dataset.editorScale
      await new Promise(requestAnimationFrame)
      const elapsed = performance.now() - start
      observer.disconnect()
      return { beforeFrame, scale: Number(root.dataset.editorScale), documentMutations, elapsed }
    })
    expect(result.beforeFrame).toBe('1')
    expect(result.scale).toBeCloseTo(Math.exp(0.4), 5)
    expect(result.documentMutations).toBe(0)
    console.log(`200 pinch events / 160 sections: ${result.elapsed.toFixed(1)} ms including frame wait`)
  })

  test('renders a continuous pinch stream and clamps extreme gestures', async() => {
    const before = await layoutSnapshot(page)
    const session = await page.context().newCDPSession(page)
    await session.send('Performance.enable')
    const metricsBefore = await session.send('Performance.getMetrics')
    const intervals = await page.evaluate(async() => {
      const root = document.querySelector<HTMLElement>('.editor-component')!
      const rect = root.getBoundingClientRect()
      const times: number[] = []
      let previous = performance.now()
      for (let i = 0; i < 60; i++) {
        root.dispatchEvent(new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: i < 30 ? -2 : 2,
          clientX: rect.x + 300,
          clientY: rect.y + 200,
          bubbles: true,
          cancelable: true
        }))
        await new Promise(requestAnimationFrame)
        const now = performance.now()
        times.push(now - previous)
        previous = now
      }
      return times
    })
    const metricsAfter = await session.send('Performance.getMetrics')
    const duration = (name: string) => {
      const after = metricsAfter.metrics.find((metric) => metric.name === name)?.value ?? 0
      const before = metricsBefore.metrics.find((metric) => metric.name === name)?.value ?? 0
      return ((after - before) * 1000 / 60).toFixed(2)
    }
    intervals.sort((a, b) => a - b)
    console.log(`60 frames / 160 sections: median ${intervals[30].toFixed(1)} ms, p95 ${intervals[57].toFixed(1)} ms; layout ${duration('LayoutDuration')} ms/frame, style ${duration('RecalcStyleDuration')} ms/frame`)
    expect(await readScale(page)).toBeCloseTo(1, 5)
    await expectSameLayout(page, before)
    await pinch(page, 100)
    await expectSameLayout(page, before)
    await pinch(page, 0.0001)
    await expectSameLayout(page, before)
  })

  test('anchors the same document point in a right-to-left editor', async() => {
    await page.locator('.editor-wrapper').evaluate((el) => { el.setAttribute('dir', 'rtl') })
    const documentPoint = () => page.locator('.editor-component').evaluate((el) => {
      const viewport = el as HTMLElement
      const rect = viewport.getBoundingClientRect()
      const plane = viewport.querySelector<HTMLElement>('.editor-camera-plane')!.getBoundingClientRect()
      return (rect.x + rect.width * 0.55 - plane.x) / Number(viewport.dataset.editorScale)
    })
    const point = await documentPoint()
    const before = await layoutSnapshot(page)
    await pinch(page, 2)
    expect(Math.abs(await documentPoint() - point)).toBeLessThan(1)
    await expectSameLayout(page, before)
  })
})
