import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchWithMarkdown, sendIpcToRenderer, expectNoRendererErrors } from './helpers'

const image =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><rect width="360" height="120" fill="#21b56f"/><circle cx="60" cy="60" r="40" fill="white"/></svg>'
  ).toString('base64')
const paragraph =
  '中文分页测试：每一次设置变化都应反映在最终页面中。English text with **bold** and *italic*. '
const markdown =
  `# 打印前预览 / Print fidelity\n\n[TOC]\n\n![Local image](${image})\n\n` +
  '| 项目 | 数值 | 说明 |\n| --- | ---: | --- |\n' +
  Array.from({ length: 15 }, (_, i) => `| 行 ${i + 1} | ${i * 12} | ${paragraph} |\n`).join('') +
  '\n```typescript\nconst longLine = "' +
  '代码 should wrap across the printed page. '.repeat(10) +
  '"\n```\n\n' +
  '$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\n' +
  '```mermaid\ngraph LR\n A[编辑文档] --> B[预览分页]\n B --> C[打印页面]\n```\n\n' +
  Array.from(
    { length: 12 },
    (_, i) => `## Section ${i + 1} / 章节\n\n${paragraph.repeat(5)}\n\n`
  ).join('')

interface CapturedJob {
  pdf: number[]
  options: Record<string, unknown>
  images: string[]
}

const setupPrintBoundary = async(app: ElectronApplication) => {
  // Only the hardware boundary is replaced. Chromium still loads the staged
  // pages and generates a real PDF from the exact document sent to print().
  await app.evaluate(({ app, BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0].webContents
    owner.getPrintersAsync = async() => [
      {
        name: 'Preview test device',
        displayName: 'Preview test device',
        isDefault: true,
        description: '',
        status: 0,
        options: {}
      }
    ]
    const state = global as unknown as {
      printJobs: CapturedJob[]
      printResult: 'cancel' | 'fail' | 'success'
      failRender: boolean
      renderDelay: number
    }
    state.printJobs = []
    state.printResult = 'cancel'
    state.failRender = false
    state.renderDelay = 0
    app.on('web-contents-created', (_event, contents) => {
      const originalPdf = contents.printToPDF.bind(contents)
      contents.printToPDF = async(options) => {
        if (state.renderDelay) { await new Promise((resolve) => setTimeout(resolve, state.renderDelay)) }
        if (state.failRender) throw new Error('Injected PDF rendering failure')
        return originalPdf(options)
      }
      contents.print = (options, callback) => {
        ;(async() => {
          const pdf = await originalPdf({
            printBackground: true,
            preferCSSPageSize: true,
            margins: { top: 0, right: 0, bottom: 0, left: 0 }
          })
          const images = (await contents.executeJavaScript(
            'Array.from(document.images, image => image.src)'
          )) as string[]
          state.printJobs.push({
            pdf: Array.from(pdf),
            options: options as Record<string, unknown>,
            images
          })
          callback?.(
            state.printResult === 'success',
            state.printResult === 'cancel' ? 'Print job canceled' : 'Test printer offline'
          )
        })()
      }
    })
  })
}

const waitReady = async(page: Page) => {
  await expect(page.locator('.page-loading')).toHaveCount(0, { timeout: 30000 })
  await expect(page.locator('.preview-message')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save PDF', exact: true })).toBeEnabled({
    timeout: 30000
  })
  await expect
    .poll(() =>
      page.locator('.page-sheet canvas').evaluate((el) => (el as HTMLCanvasElement).width)
    )
    .toBeGreaterThan(100)
}

const savePdf = async(app: ElectronApplication, page: Page, target: string) => {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async() => ({ canceled: false, filePath })
  }, target)
  await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
  await expect.poll(() => fs.existsSync(target)).toBe(true)
  await expect(page.getByRole('button', { name: 'Save PDF', exact: true })).toBeEnabled()
  return fs.readFileSync(target)
}

const readPdf = async(data: Buffer) => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push({
      width: page.view[2],
      height: page.view[3],
      text: content.items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join('')
        .normalize('NFKC'),
      positions: content.items.flatMap((item) => ('transform' in item ? [item.transform] : []))
    })
  }
  await doc.destroy()
  return pages
}

test.describe('Print preview with Chromium pagination', () => {
  test.setTimeout(120000)
  let app: ElectronApplication
  let page: Page
  let output: string
  test.beforeEach(async() => {
    output = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-preview-e2e-'))
    const launched = await launchWithMarkdown(markdown, {
      suppressErrorDialog: true,
      preferences: { language: 'en', spellcheckerEnabled: false }
    })
    app = launched.app
    page = launched.page
    await setupPrintBoundary(app)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'print')
    await waitReady(page)
  })
  test.afterEach(async() => {
    if (app) {
      await expectNoRendererErrors(app)
      await app.close()
    }
    if (output) fs.rmSync(output, { recursive: true, force: true })
  })

  test('previews every real PDF page, saves the same pixels, and prints the same pagination', async() => {
    const data = await savePdf(app, page, path.join(output, 'preview.pdf'))
    const pages = await readPdf(data)
    for (const value of ['0', '999', '']) {
      await page.locator('.page-counter input').fill(value)
      await page.locator('.page-counter input').press('Tab')
      await expect(page.locator('.preview-message')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Save PDF', exact: true })).toBeEnabled()
    }
    expect(pages.length).toBeGreaterThan(2)
    expect(pages.map((p) => p.text).join('')).toContain('中文分')
    expect(pages.map((p) => p.text).join('')).toContain('const longLine')
    expect(pages.map((p) => p.text).join('')).toContain('dx')
    expect(pages[0].width).toBeCloseTo((210 / 25.4) * 72, 0)
    expect(pages[0].height).toBeCloseTo((297 / 25.4) * 72, 0)
    const previewImages: string[] = []
    for (let i = 1; i <= pages.length; i++) {
      await page.locator('.page-counter input').fill(String(i))
      await page.locator('.page-counter input').press('Tab')
      await page.waitForTimeout(100)
      const pixels = await page
        .locator('.page-sheet canvas')
        .evaluate((el) => (el as HTMLCanvasElement).toDataURL())
      previewImages.push(pixels)
    }
    expect(new Set(previewImages).size).toBe(pages.length)
    const before = page.locator('.print-preview').getAttribute('data-revision')
    await page.getByRole('combobox', { name: 'Preview zoom' }).selectOption('150')
    await expect(page.locator('.print-preview')).toHaveAttribute('data-revision', (await before)!)
    const zoomedPdf = await savePdf(app, page, path.join(output, 'zoomed.pdf'))
    expect(zoomedPdf.equals(data)).toBe(true)

    await page.getByRole('button', { name: 'Print', exact: true }).click()
    await expect(page.locator('.action-message')).toContainText('canceled', { timeout: 60000 })
    const jobs = await app.evaluate(
      () => (global as unknown as { printJobs: CapturedJob[] }).printJobs
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({
      silent: true,
      scaleFactor: 100,
      pageSize: { width: 210000, height: 297000 },
      margins: { marginType: 'none' }
    })
    const printed = await readPdf(Buffer.from(jobs[0].pdf))
    expect(printed.length).toBe(pages.length)
    for (const sheet of printed) {
      expect(sheet.width).toBeCloseTo(pages[0].width, 1)
      expect(sheet.height).toBeCloseTo(pages[0].height, 1)
    }
    const { getDocument, OPS, ImageKind, Util } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { loadImage } = await import('@napi-rs/canvas')
    const printedDoc = await getDocument({ data: Uint8Array.from(jobs[0].pdf) }).promise
    const factory = printedDoc.canvasFactory as {
      create(
        width: number,
        height: number
      ): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }
      destroy(target: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }): void
    }
    for (let number = 1; number <= pages.length; number++) {
      const printPage = await printedDoc.getPage(number)
      const staged = fs.readFileSync(fileURLToPath(jobs[0].images[number - 1]))
      expect(staged.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(staged.readUInt32BE(16)).toBeGreaterThan(2400)
      const operators = await printPage.getOperatorList()
      const images = operators.fnArray.flatMap((op, i) =>
        op === OPS.paintImageXObject ? [operators.argsArray[i][0] as string] : []
      )
      expect(images, `Page ${number}: one immutable sheet`).toHaveLength(1)
      let matrix = [1, 0, 0, 1, 0, 0]
      const stack: number[][] = []
      for (let i = 0; i < operators.fnArray.length; i++) {
        const op = operators.fnArray[i]
        if (op === OPS.save) stack.push(matrix.slice())
        if (op === OPS.restore) matrix = stack.pop()!
        if (op === OPS.transform) matrix = Util.transform(matrix, operators.argsArray[i])
        if (op === OPS.paintImageXObject) {
          const corners = [
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1]
          ].map(([x, y]) => [
            matrix[0] * x + matrix[2] * y + matrix[4],
            matrix[1] * x + matrix[3] * y + matrix[5]
          ])
          expect(Math.min(...corners.map((p) => p[0]))).toBeCloseTo(0, 0)
          expect(Math.min(...corners.map((p) => p[1]))).toBeCloseTo(0, 0)
          // Chromium rounds the physical sheet's CSS dimensions to device pixels.
          expect(Math.abs(Math.max(...corners.map((p) => p[0])) - printPage.view[2])).toBeLessThanOrEqual(72 / 96)
          expect(Math.abs(Math.max(...corners.map((p) => p[1])) - printPage.view[3])).toBeLessThanOrEqual(72 / 96)
        }
      }
      const embedded = await new Promise<{
        width: number
        height: number
        kind: number
        data: Uint8Array
      }>((resolve) => {
        printPage.objs.get(images[0], resolve)
      })
      expect(embedded.width).toBe(staged.readUInt32BE(16))
      expect(embedded.height).toBe(staged.readUInt32BE(20))
      expect(embedded.kind).toBe(ImageKind.RGB_24BPP)
      const source = factory.create(embedded.width, embedded.height)
      source.context.drawImage((await loadImage(staged)) as unknown as CanvasImageSource, 0, 0)
      const rgba = source.context.getImageData(0, 0, embedded.width, embedded.height).data
      const rgb = new Uint8Array(embedded.width * embedded.height * 3)
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        rgb[j] = rgba[i]
        rgb[j + 1] = rgba[i + 1]
        rgb[j + 2] = rgba[i + 2]
      }
      expect(
        Buffer.from(embedded.data).equals(Buffer.from(rgb)),
        `Page ${number}: every 300 dpi pixel survives print composition`
      ).toBe(true)
      console.log(
        `Print page ${number}: ${embedded.width} × ${embedded.height}, all pixels identical`
      )
      factory.destroy(source)
    }
    await printedDoc.destroy()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.print-preview')).toHaveCount(0)
    await expect
      .poll(() => jobs[0].images.every((image) => !fs.existsSync(fileURLToPath(image))))
      .toBe(true)
  })

  test('changes paper, orientation and margins; editor camera never changes pagination', async() => {
    const baseline = await readPdf(await savePdf(app, page, path.join(output, 'baseline.pdf')))
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.print-preview-dialog')).toBeHidden()
    const editor = page.locator('.editor-component')
    const box = (await editor.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -Math.log(2) / 0.01)
    await page.keyboard.up('Control')
    await expect
      .poll(async() => Number(await editor.getAttribute('data-editor-scale')))
      .toBeCloseTo(2, 5)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'print')
    await waitReady(page)
    const zoomed = await readPdf(await savePdf(app, page, path.join(output, 'editor-zoom.pdf')))
    expect(zoomed).toEqual(baseline)
    await page.locator('.print-preview-dialog .page-size-select .el-select').click()
    await page.getByRole('option', { name: /^A5 / }).click()
    await waitReady(page)
    const a5 = await readPdf(await savePdf(app, page, path.join(output, 'a5.pdf')))
    expect(a5[0].width).toBeCloseTo((148 / 25.4) * 72, 0)
    expect(a5.length).toBeGreaterThan(baseline.length)
    await page.locator('#pane-page .el-switch').click()
    await waitReady(page)
    const landscape = await readPdf(await savePdf(app, page, path.join(output, 'landscape.pdf')))
    expect(landscape[0].width).toBeCloseTo((210 / 25.4) * 72, 0)
    expect(landscape[0].height).toBeCloseTo((148 / 25.4) * 72, 0)
    const margins = page.locator('#pane-page .row .el-input-number input')
    await margins.nth(2).fill('40')
    await margins.nth(2).press('Tab')
    await waitReady(page)
    const margin = await readPdf(await savePdf(app, page, path.join(output, 'margin.pdf')))
    expect(margin).not.toEqual(landscape)
  })

  test('handles generation failure, save cancellation, printer failure, and reopening', async() => {
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async() => ({ canceled: true, filePath: '' })
    })
    await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
    await expect(page.locator('.action-message')).toContainText('canceled')
    await app.evaluate(() => {
      ;(global as unknown as { printResult: string }).printResult = 'fail'
    })
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    await expect(page.locator('.action-message')).toContainText('Test printer offline', {
      timeout: 60000
    })
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
    await app.evaluate(() => {
      ;(global as unknown as { failRender: boolean }).failRender = true
    })
    await page.locator('#pane-page .el-switch').click()
    await expect(page.locator('.preview-message')).toContainText('Injected PDF rendering failure', {
      timeout: 30000
    })
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled()
    await app.evaluate(() => {
      ;(global as unknown as { failRender: boolean }).failRender = false
    })
    await page.getByRole('button', { name: 'Try again' }).click()
    await waitReady(page)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'print')
    await waitReady(page)
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1)
  })

  test('validates custom paper and margins, then submits the selected copies', async() => {
    await page.locator('.page-size-select .el-select').click()
    await page.getByRole('option', { name: 'Custom', exact: true }).click()
    const values = page.locator('#pane-page .row .el-input-number input')
    for (const [index, value] of [
      [0, '190'],
      [1, '250']
    ] as const) {
      await values.nth(index).fill(value)
      await values.nth(index).press('Tab')
    }
    await waitReady(page)
    await values.nth(4).fill('100')
    await values.nth(4).press('Tab')
    await values.nth(5).fill('100')
    await values.nth(5).press('Tab')
    await expect(page.locator('.preview-message')).toContainText('20 mm')
    await expect(page.getByRole('button', { name: 'Save PDF', exact: true })).toBeDisabled()
    await values.nth(4).fill('20')
    await values.nth(4).press('Tab')
    await values.nth(5).fill('20')
    await values.nth(5).press('Tab')
    await waitReady(page)
    const custom = await readPdf(await savePdf(app, page, path.join(output, 'custom.pdf')))
    expect(custom[0].width).toBeCloseTo((190 / 25.4) * 72, 0)
    expect(custom[0].height).toBeCloseTo((250 / 25.4) * 72, 0)
    await page.getByRole('spinbutton', { name: 'Copies', exact: true }).fill('2')
    await app.evaluate(() => {
      ;(global as unknown as { printResult: string }).printResult = 'success'
    })
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    await expect(page.locator('.print-preview-dialog')).toBeHidden({ timeout: 60000 })
    const jobs = await app.evaluate(
      () => (global as unknown as { printJobs: CapturedJob[] }).printJobs
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({
      deviceName: 'Preview test device',
      copies: 2,
      pageSize: { width: 190000, height: 250000 }
    })
    const printed = await readPdf(Buffer.from(jobs[0].pdf))
    expect(printed.length).toBe(custom.length)
    expect(printed[0].width).toBeCloseTo(custom[0].width, 1)
    expect(printed[0].height).toBeCloseTo(custom[0].height, 1)
    await expect
      .poll(() => jobs[0].images.every((image) => !fs.existsSync(fileURLToPath(image))))
      .toBe(true)
  })

  test('cancels page preparation before any job is submitted', async() => {
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    await expect(page.getByRole('button', { name: /Preparing/ })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.action-message')).toContainText('canceled', { timeout: 30000 })
    expect(
      await app.evaluate(() => (global as unknown as { printJobs: CapturedJob[] }).printJobs)
    ).toHaveLength(0)
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.getPrintersAsync = async() => [] })
    await page.getByRole('button', { name: 'Refresh printers' }).click()
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save PDF', exact: true })).toBeEnabled()
  })

  test('reflects font, theme, header, footer and TOC settings in the saved pages', async() => {
    const baseline = await readPdf(await savePdf(app, page, path.join(output, 'baseline.pdf')))
    await page.locator('#tab-style').click()
    const overwrite = page.locator('#pane-style .el-switch').first()
    if (await overwrite.getAttribute('aria-checked') !== 'true') await overwrite.click()
    await page.locator('#pane-style').getByRole('slider').first().press('End')
    await waitReady(page)
    const larger = await readPdf(await savePdf(app, page, path.join(output, 'font.pdf')))
    expect(Math.max(...larger.flatMap(p => p.positions.map(position => Math.abs(position[0]))))).toBeGreaterThan(
      Math.max(...baseline.flatMap(p => p.positions.map(position => Math.abs(position[0])))) * 1.5
    )
    await page.locator('#tab-theme').click()
    await page.locator('#pane-theme .el-select').click()
    await page.getByRole('option', { name: /Academic/ }).click()
    await waitReady(page)
    const academic = await readPdf(await savePdf(app, page, path.join(output, 'academic.pdf')))
    expect(academic).not.toEqual(larger)
    await page.locator('#tab-header').click()
    for (const index of [0, 1]) {
      const select = page.locator('#pane-header .el-select').nth(index)
      await select.click()
      const optionsId = await select.getByRole('combobox').getAttribute('aria-controls')
      await page.locator(`[id="${optionsId}"]`).getByRole('option', { name: /Single cell/i }).click()
    }
    await page.locator('#pane-header .pref-text-box-item input').nth(0).fill('Preview header')
    await page.locator('#pane-header .pref-text-box-item input').nth(1).fill('Preview footer')
    await page.locator('#tab-toc').click()
    await page.locator('#pane-toc .pref-text-box-item input').fill('Preview contents')
    await waitReady(page)
    const configured = await readPdf(await savePdf(app, page, path.join(output, 'configured.pdf')))
    expect(configured.map(p => p.text).join('')).toContain('Preview contents')
    expect(configured[0].text).toContain('Preview header')
    expect(configured[0].text).toContain('Preview footer')
    expect(configured[configured.length - 1].text).toContain('Preview header')
    expect(configured[configured.length - 1].text).toContain('Preview footer')
  })

  test('closing during generation destroys the worker and its temporary document', async() => {
    await app.evaluate(() => {
      ;(global as unknown as { renderDelay: number }).renderDelay = 2000
    })
    await page.locator('#pane-page .el-switch').click()
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(2)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(win => /document-\d+\.html$/.test(win.webContents.getURL())))).toBe(true)
    const sources = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .map((win) => win.webContents.getURL())
        .filter((url) => /document-\d+\.html$/.test(url))
    )
    expect(sources).toHaveLength(1)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.print-preview-dialog')).toBeHidden()
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1)
    await expect
      .poll(() => sources.every((source) => !fs.existsSync(fileURLToPath(source))))
      .toBe(true)
    await app.evaluate(() => {
      ;(global as unknown as { renderDelay: number }).renderDelay = 0
    })
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'print')
    await waitReady(page)
  })
})
