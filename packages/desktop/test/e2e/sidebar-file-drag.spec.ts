import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { expectNoRendererErrors, launchElectron, waitForMenuReady } from './helpers'

type DragRecord = { file: string; iconEmpty: boolean }

const dragRow = async(page: Page, row: Locator): Promise<void> => {
  const box = await row.boundingBox()
  if (!box) throw new Error('File row is not visible')
  const x = box.x + Math.min(80, box.width / 2)
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  try {
    await page.mouse.move(x + 60, y + 15, { steps: 10 })
  } finally {
    await page.mouse.up()
  }
}

const drags = (app: ElectronApplication): Promise<DragRecord[]> =>
  app.evaluate(() => {
    return (global as unknown as { fileDrags: DragRecord[] }).fileDrags
  })

test.describe('Sidebar file drag', () => {
  let app: ElectronApplication
  let page: Page
  let directory: string
  let filename: string

  test.beforeAll(async() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-drag-e2e-'))
    filename = path.join(directory, '中文 note #1.md')
    fs.writeFileSync(filename, '# On disk\n', 'utf8')
    const launched = await launchElectron([directory], { suppressErrorDialog: true })
    app = launched.app
    page = launched.page
    await expect
      .poll(
        async() => {
          for (const candidate of app.windows()) {
            if (await candidate.locator('.side-bar-file').count()) {
              page = candidate
              return true
            }
          }
          return false
        },
        { timeout: 15000 }
      )
      .toBe(true)
    await waitForMenuReady(app)
    // Stop at the OS boundary so CI can exercise real mouse gestures without
    // requiring a desktop drop target.
    await app.evaluate(({ BrowserWindow }) => {
      const sink: DragRecord[] = []
      ;(global as unknown as { fileDrags: DragRecord[] }).fileDrags = sink
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.startDrag = (item) => {
          sink.push({
            file: item.file,
            iconEmpty: typeof item.icon === 'string' || item.icon.isEmpty()
          })
        }
      }
    })
  })

  test.beforeEach(async() => {
    await app.evaluate(() => {
      ;(global as unknown as { fileDrags: DragRecord[] }).fileDrags.length = 0
    })
  })

  test.afterAll(async() => {
    if (app) await app.close()
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  })

  test('a mouse drag on a project row reaches native file drag without opening the file', async() => {
    const row = page.locator('.side-bar-file[title$="中文 note #1.md"]')
    const openedBefore = await page.locator('.opened-file').count()
    await dragRow(page, row)
    await expect.poll(() => drags(app)).toEqual([{ file: filename, iconEmpty: false }])
    await expect(page.locator('.opened-file')).toHaveCount(openedBefore)
    await expectNoRendererErrors(app)
  })

  test('opened file rows drag the same disk file', async() => {
    await page.locator('.side-bar-file[title$="中文 note #1.md"]').click()
    const row = page.locator('.opened-file').filter({ hasText: '中文 note #1.md' })
    await expect(row).toBeVisible()
    await dragRow(page, row)
    await expect.poll(() => drags(app)).toEqual([{ file: filename, iconEmpty: false }])
  })

  test('renaming disables file drag without losing input focus', async() => {
    const row = page.locator('.side-bar-file[title$="中文 note #1.md"]')
    await row.click()
    await page.keyboard.press('F2')
    const input = row.locator('input.rename')
    await expect(input).toBeFocused()
    await expect(row).toHaveAttribute('draggable', 'false')
    await input.dispatchEvent('dragstart')
    expect(await drags(app)).toEqual([])
    await expect(input).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(row).toHaveAttribute('draggable', 'true')
  })

  test('untitled buffers are not draggable', async() => {
    const window = await app.browserWindow(page)
    const windowId = await window.evaluate(win => win.id)
    await app.evaluate(({ BrowserWindow }, id) => {
      const target = BrowserWindow.fromId(id)
      if (!target) throw new Error('Project window was closed')
      target.webContents.send('mt::new-untitled-tab')
    }, windowId)
    const row = page.locator('.opened-file[title=""]').last()
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('draggable', 'false')
    await dragRow(page, row)
    expect(await drags(app)).toEqual([])
    await expectNoRendererErrors(app)
  })
})
