import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchWithMarkdown, sendIpcToRenderer, expectNoRendererErrors, enterSourceMode } from './helpers'

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
  '1. First ordered item\n2. Second ordered item\n3. Third ordered item\n\n' +
  Array.from(
    { length: 12 },
    (_, i) => `## Section ${i + 1} / 章节\n\n${paragraph.repeat(5)}\n\n- point ${i + 1}a\n- point ${i + 1}b\n\n`
  ).join('')

interface CapturedJob {
  pdf: number[]
  options: Record<string, unknown>
  images: string[]
}

interface PrintState {
  printJobs: CapturedJob[]
  printResult: 'cancel' | 'fail' | 'success'
  failRender: boolean
  renderDelay: number
  pdfCalls: number
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
    const state = global as unknown as PrintState
    state.printJobs = []
    state.printResult = 'cancel'
    state.failRender = false
    state.renderDelay = 0
    state.pdfCalls = 0
    app.on('web-contents-created', (_event, contents) => {
      const originalPdf = contents.printToPDF.bind(contents)
      contents.printToPDF = async(options) => {
        state.pdfCalls++
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

const setState = (app: ElectronApplication, values: Partial<PrintState>) =>
  app.evaluate((_electron, next) => {
    Object.assign(global as unknown as PrintState, next)
  }, values)

const getState = <K extends keyof PrintState>(app: ElectronApplication, key: K): Promise<PrintState[K]> =>
  app.evaluate((_electron, name) => (global as unknown as PrintState)[name], key) as Promise<PrintState[K]>

const waitReady = async(page: Page) => {
  await expect(page.locator('.print-preview[data-ready]')).toHaveCount(1, { timeout: 30000 })
  await expect(page.locator('.preview-canvas.stale')).toHaveCount(0, { timeout: 30000 })
  await expect(page.locator('.preview-message')).toHaveCount(0)
}

const previewPageCount = async(page: Page) => Number(await page.locator('.print-preview').getAttribute('data-pages'))

// The text each preview sheet holds, read from the laid-out iframe.
const previewPages = (page: Page) =>
  page.locator('.preview-frame').evaluate((element) => {
    const doc = (element as HTMLIFrameElement).contentDocument!
    const tops = Array.from(doc.querySelectorAll('.mt-sheet'), (sheet) => sheet.getBoundingClientRect().top)
    const content = doc.querySelector('article.markdown-body')!
    const texts = tops.map(() => '')
    const walker = doc.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    const range = doc.createRange()
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      for (let i = 0; i < node.length; i++) {
        if (!node.data[i].trim()) continue
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const rect = range.getClientRects()[0]
        if (!rect || !rect.width) continue
        const middle = rect.top + rect.height / 2
        let sheet = 0
        while (sheet + 1 < tops.length && tops[sheet + 1] <= middle) sheet++
        texts[sheet] += node.data[i]
      }
    }
    return texts
  })

const savePdf = async(app: ElectronApplication, page: Page, target: string) => {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async() => ({ canceled: false, filePath })
  }, target)
  await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
  await expect
    .poll(async() => fs.existsSync(target) || (await page.locator('.action-message').textContent().catch(() => null)), { timeout: 60000 })
    .toBe(true)
  await expect(page.getByRole('button', { name: 'Save PDF', exact: true })).toBeEnabled({ timeout: 60000 })
  return fs.readFileSync(target)
}

const readPdf = async(data: Buffer) => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(data) }).promise
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
  await doc.loadingTask.destroy()
  return pages
}

// Letters and digits on a printed page that the preview sheet does not hold,
// and vice versa. Only ASCII is compared: PDF text extraction returns some CJK
// characters as radicals (页 as ⻚) that NFKC does not fold back.
const pageDifference = (preview: string, printed: string): number => {
  const counts = new Map<string, number>()
  for (const char of preview.normalize('NFKC').replace(/[^A-Za-z0-9]/g, '')) counts.set(char, (counts.get(char) ?? 0) + 1)
  for (const char of printed.replace(/[^A-Za-z0-9]/g, '')) counts.set(char, (counts.get(char) ?? 0) - 1)
  return [...counts.values()].reduce((sum, value) => sum + Math.abs(value), 0)
}

const expectSamePages = async(page: Page, printed: Awaited<ReturnType<typeof readPdf>>, extra = '') => {
  const preview = await previewPages(page)
  expect(printed.length).toBe(preview.length)
  preview.forEach((text, i) => {
    const difference = pageDifference(text, printed[i].text.replace(extra, ''))
    expect(difference, `page ${i + 1} holds the previewed text`).toBeLessThanOrEqual(4)
  })
}

// Each select's own listbox: another one may still be fading out.
const choose = async(page: Page, select: string, option: RegExp | string) => {
  const listbox = await page.locator(select).getAttribute('aria-controls')
  await page.locator('.print-settings .el-select').filter({ has: page.locator(select) }).click()
  const choice = page.locator(`[id="${listbox}"]`).getByRole('option', { name: option, exact: typeof option === 'string' })
  await expect(choice).toBeVisible()
  await choice.click()
  await expect(page.locator(`[id="${listbox}"]`)).toBeHidden()
}

// Element Plus keeps the native radio and switch inputs invisible.
const pressRadio = (page: Page, name: string) =>
  page.locator('.print-settings .el-radio-button', { hasText: name }).click()
const toggle = (page: Page, id: string) => page.locator(`.print-settings label[for="${id}"]`).click()

test.describe('Paged print preview', () => {
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

  test('saves and prints exactly the previewed pages, at 300 dpi', async() => {
    const pages = await readPdf(await savePdf(app, page, path.join(output, 'preview.pdf')))
    expect(pages.length).toBeGreaterThan(2)
    await expectSamePages(page, pages)
    const text = pages.map((p) => p.text).join('')
    expect(text).toContain('const longLine')
    // CJK and the typeset formula reach the PDF as text.
    expect(text).toContain('中文分')
    expect(text).toContain('dx')
    expect(pages[0].width).toBeCloseTo((210 / 25.4) * 72, 0)
    expect(pages[0].height).toBeCloseTo((297 / 25.4) * 72, 0)

    for (const value of ['0', '999', '']) {
      await page.locator('.page-counter input').fill(value)
      await page.locator('.page-counter input').press('Tab')
      await expect(page.locator('.preview-message')).toHaveCount(0)
    }
    // Zooming only magnifies the sheets: no new layout, so no new PDF.
    const calls = await getState(app, 'pdfCalls')
    await page.getByRole('combobox', { name: 'Preview zoom' }).selectOption('150')
    const zoomed = await readPdf(await savePdf(app, page, path.join(output, 'zoomed.pdf')))
    expect(zoomed).toEqual(pages)
    expect(await getState(app, 'pdfCalls')).toBe(calls)

    await page.getByRole('button', { name: 'Print', exact: true }).click()
    await expect(page.locator('.action-message')).toContainText('canceled', { timeout: 60000 })
    const jobs = await getState(app, 'printJobs')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].options).toMatchObject({
      silent: true,
      scaleFactor: 100,
      pageSize: { width: 210000, height: 297000 },
      margins: { marginType: 'none' }
    })
    // One full-page raster per sheet; no document text is laid out again.
    const printed = await readPdf(Buffer.from(jobs[0].pdf))
    expect(printed.length).toBe(pages.length)
    expect(jobs[0].images).toHaveLength(pages.length)
    expect(printed.every((p) => p.text === '')).toBe(true)
    for (const [number, source] of jobs[0].images.entries()) {
      const staged = fs.readFileSync(fileURLToPath(source))
      expect(staged.subarray(0, 8).toString('hex'), `page ${number + 1}`).toBe('89504e470d0a1a0a')
      // Chromium rounds the page box to whole CSS pixels.
      expect(Math.abs(staged.readUInt32BE(16) - (210 / 25.4) * 300)).toBeLessThan(4)
      expect(Math.abs(staged.readUInt32BE(20) - (297 / 25.4) * 300)).toBeLessThan(4)
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.print-preview')).toHaveCount(0)
    await expect
      .poll(() => jobs[0].images.every((image) => !fs.existsSync(fileURLToPath(image))))
      .toBe(true)
  })

  test('re-lays out the preview live and generates the PDF only once it settles', async() => {
    // The first layout's PDF, generated in the background once it settled.
    await expect.poll(() => getState(app, 'pdfCalls'), { timeout: 15000 }).toBe(1)
    const before = await previewPageCount(page)
    const slider = page.locator('.print-settings .el-slider__button-wrapper').first()
    await slider.focus()
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
    await expect.poll(() => previewPageCount(page)).toBeLessThan(before)
    await waitReady(page)
    // One more PDF for the settled layout, none for the steps on the way.
    await expect.poll(() => getState(app, 'pdfCalls'), { timeout: 15000 }).toBe(2)
    const pages = await readPdf(await savePdf(app, page, path.join(output, 'scaled.pdf')))
    expect(await getState(app, 'pdfCalls')).toBe(2)
    await expectSamePages(page, pages)
  })

  test('changes paper, orientation and margins; the editor camera never changes pagination', async() => {
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
    expect(await readPdf(await savePdf(app, page, path.join(output, 'editor-zoom.pdf')))).toEqual(baseline)

    await choose(page, '#print-paper', /^A5 /)
    await waitReady(page)
    const a5 = await readPdf(await savePdf(app, page, path.join(output, 'a5.pdf')))
    expect(a5[0].width).toBeCloseTo((148 / 25.4) * 72, 0)
    expect(a5.length).toBeGreaterThan(baseline.length)
    await expectSamePages(page, a5)

    await pressRadio(page, 'Landscape')
    await waitReady(page)
    const landscape = await readPdf(await savePdf(app, page, path.join(output, 'landscape.pdf')))
    expect(landscape[0].width).toBeCloseTo((210 / 25.4) * 72, 0)
    expect(landscape[0].height).toBeCloseTo((148 / 25.4) * 72, 0)

    await choose(page, '#print-margins', 'Narrow')
    await waitReady(page)
    const narrow = await readPdf(await savePdf(app, page, path.join(output, 'narrow.pdf')))
    expect(narrow.length).toBeLessThan(landscape.length)
    await expectSamePages(page, narrow)
  })

  test('reports a failed PDF, a canceled save and an offline printer, and reopens cleanly', async() => {
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async() => ({ canceled: true, filePath: '' })
    })
    await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
    await expect(page.locator('.action-message')).toContainText('canceled')
    await setState(app, { printResult: 'fail' })
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    await expect(page.locator('.action-message')).toContainText('Test printer offline', { timeout: 60000 })
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()

    await setState(app, { failRender: true })
    await pressRadio(page, 'Landscape')
    await waitReady(page)
    await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
    await expect(page.locator('.action-message')).toContainText('Injected PDF rendering failure', { timeout: 30000 })
    // The preview itself never depended on the PDF.
    await expect(page.locator('.print-preview[data-ready]')).toHaveCount(1)
    await setState(app, { failRender: false })
    const pages = await readPdf(await savePdf(app, page, path.join(output, 'retry.pdf')))
    await expectSamePages(page, pages)

    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'print')
    await waitReady(page)
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1)
  })

  test('validates custom paper and margins, then submits the selected copies', async() => {
    await choose(page, '#print-paper', 'Custom')
    await page.getByRole('spinbutton', { name: 'Width' }).fill('190')
    await page.getByRole('spinbutton', { name: 'Width' }).press('Tab')
    await page.getByRole('spinbutton', { name: 'Height' }).fill('250')
    await page.getByRole('spinbutton', { name: 'Height' }).press('Tab')
    await waitReady(page)
    await choose(page, '#print-margins', 'Custom')
    for (const side of ['Right (mm)', 'Left (mm)']) {
      await page.getByRole('spinbutton', { name: side }).fill('100')
      await page.getByRole('spinbutton', { name: side }).press('Tab')
    }
    await expect(page.locator('.preview-message')).toContainText('20 mm')
    await expect(page.getByRole('button', { name: 'Save PDF', exact: true })).toBeDisabled()
    for (const side of ['Right (mm)', 'Left (mm)']) {
      await page.getByRole('spinbutton', { name: side }).fill('20')
      await page.getByRole('spinbutton', { name: side }).press('Tab')
    }
    await waitReady(page)
    const custom = await readPdf(await savePdf(app, page, path.join(output, 'custom.pdf')))
    expect(custom[0].width).toBeCloseTo((190 / 25.4) * 72, 0)
    expect(custom[0].height).toBeCloseTo((250 / 25.4) * 72, 0)
    await page.getByRole('spinbutton', { name: 'Copies', exact: true }).fill('2')
    await setState(app, { printResult: 'success' })
    await page.getByRole('button', { name: 'Print', exact: true }).click()
    await expect(page.locator('.print-preview-dialog')).toBeHidden({ timeout: 60000 })
    const jobs = await getState(app, 'printJobs')
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
    await expect(page.getByRole('button', { name: /Preparing/ })).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('.action-message')).toContainText('canceled', { timeout: 30000 })
    expect(await getState(app, 'printJobs')).toHaveLength(0)
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.getPrintersAsync = async() => [] })
    await page.getByRole('button', { name: 'Refresh printers' }).click()
    await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save PDF', exact: true })).toBeEnabled()
  })

  test('prints the running header, page numbers, fonts, theme and contents title it previews', async() => {
    const baseline = await readPdf(await savePdf(app, page, path.join(output, 'baseline.pdf')))
    await toggle(page, 'print-font-overwrite')
    await page.locator('.print-settings .el-slider__button-wrapper').nth(3).focus()
    await page.keyboard.press('End')
    await waitReady(page)
    const larger = await readPdf(await savePdf(app, page, path.join(output, 'font.pdf')))
    expect(larger.length).toBeGreaterThan(baseline.length)
    await expectSamePages(page, larger)

    const headingFont = () =>
      page.locator('.preview-frame').evaluate((frame) => {
        const doc = (frame as HTMLIFrameElement).contentDocument!
        return doc.defaultView!.getComputedStyle(doc.querySelector('article.markdown-body h1')!).fontFamily
      })
    const githubFont = await headingFont()
    await choose(page, '#print-theme', /Academic/)
    await waitReady(page)
    expect(await headingFont()).not.toBe(githubFont)
    await page.getByRole('textbox', { name: 'Header Center' }).fill('Preview header')
    await page.getByRole('button', { name: 'Add page numbers' }).click()
    await page.getByRole('textbox', { name: 'Contents title' }).fill('Preview contents')
    await waitReady(page)
    const sheets = page.locator('.preview-frame')
    const count = await previewPageCount(page)
    expect(await sheets.evaluate((frame) =>
      (frame as HTMLIFrameElement).contentDocument!.querySelector('.mt-sheet:last-child .mt-band.bottom')?.textContent
    )).toBe(`${count} / ${count}`)
    const configured = await readPdf(await savePdf(app, page, path.join(output, 'configured.pdf')))
    expect(configured).toHaveLength(count)
    expect(configured.map((p) => p.text).join('')).toContain('Preview contents')
    expect(configured[0].text).toContain('Preview header')
    expect(configured[0].text).toContain(`1 / ${count}`)
    expect(configured[count - 1].text).toContain('Preview header')
    expect(configured[count - 1].text).toContain(`${count} / ${count}`)
  })

  test('closing during background PDF generation destroys the worker and its temporary document', async() => {
    await setState(app, { renderDelay: 3000 })
    await pressRadio(page, 'Landscape')
    await waitReady(page)
    // The settled preview starts its PDF in a hidden worker window.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((win) => /document-\d+\.html$/.test(win.webContents.getURL()))
    ), { timeout: 15000 }).toBe(true)
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
    await setState(app, { renderDelay: 0 })
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'print')
    await waitReady(page)
  })

  test('prints the current source edits and their TOC without changing source history', async() => {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await enterSourceMode(page, app)
    const source = '# Current source heading\n\n[TOC]\n\n## New source section\n\nLatest unsaved source content.\n'
    const history = await page.locator('.source-code .CodeMirror').evaluate((el, value) => {
      const cm = (el as HTMLElement & {
        CodeMirror?: {
          setValue(value: string): void
          setCursor(line: number, ch: number): void
          historySize(): { undo: number; redo: number }
        }
      }).CodeMirror
      if (!cm) throw new Error('Source editor is missing')
      cm.setValue(value)
      cm.setCursor(6, 5)
      return cm.historySize()
    }, source)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'print')
    await waitReady(page)
    const pages = await readPdf(await savePdf(app, page, path.join(output, 'source.pdf')))
    const text = pages.map(p => p.text).join('')
    expect(text).toContain('Latest unsaved source content.')
    expect(text.match(/New source section/g)).toHaveLength(2)
    expect(text).not.toContain('Print fidelity')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    const after = await page.locator('.source-code .CodeMirror').evaluate((el) => {
      const cm = (el as HTMLElement & {
        CodeMirror?: {
          getValue(): string
          historySize(): { undo: number; redo: number }
        }
      }).CodeMirror
      if (!cm) throw new Error('Source editor is missing')
      return { source: cm.getValue(), history: cm.historySize() }
    })
    expect(after).toEqual({ source, history })
  })
})

test.describe('PDF export through the paged preview', () => {
  test.setTimeout(120000)

  test('exports the shown pages, then closes and announces the file', async() => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-export-e2e-'))
    const { app, page } = await launchWithMarkdown(markdown, {
      suppressErrorDialog: true,
      preferences: { language: 'en', spellcheckerEnabled: false }
    })
    try {
      await sendIpcToRenderer(app, 'mt::show-export-dialog', 'pdf')
      await waitReady(page)
      await expect(page.getByRole('heading', { name: 'Export PDF' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Print', exact: true })).toHaveCount(0)
      const count = await previewPageCount(page)
      const preview = await previewPages(page)
      const target = path.join(output, 'export.pdf')
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async() => ({ canceled: false, filePath })
      }, target)
      await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
      await expect(page.locator('.print-preview-dialog')).toBeHidden({ timeout: 60000 })
      await expect(page.locator('.mt-notification').first()).toBeVisible()
      const pages = await readPdf(fs.readFileSync(target))
      expect(pages).toHaveLength(count)
      preview.forEach((text, i) => {
        expect(pageDifference(text, pages[i].text), `page ${i + 1}`).toBeLessThanOrEqual(4)
      })
      await expectNoRendererErrors(app)
    } finally {
      await app.close()
      fs.rmSync(output, { recursive: true, force: true })
    }
  })
})

const tallImage =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="2400"><rect width="400" height="2400" fill="#3a6ea5"/></svg>'
  ).toString('base64')

const withPreview = async(markdown: string, run: (app: ElectronApplication, page: Page, output: string) => Promise<void>) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-oversized-e2e-'))
  const { app, page } = await launchWithMarkdown(markdown, {
    suppressErrorDialog: true,
    preferences: { language: 'en', spellcheckerEnabled: false }
  })
  try {
    await setupPrintBoundary(app)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'print')
    await waitReady(page)
    await run(app, page, output)
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
    fs.rmSync(output, { recursive: true, force: true })
  }
}

test.describe('Content taller than a page', () => {
  test.setTimeout(120000)

  test('limits a magnified image to one page and prints the previewed pages', async() => {
    const markdown =
      '# Tall image\n\n' + 'Text before the image. '.repeat(60) + `\n\n![Tall image](${tallImage})\n\nAfter the image.\n`
    await withPreview(markdown, async(app, page, output) => {
      await expectSamePages(page, await readPdf(await savePdf(app, page, path.join(output, 'image.pdf'))))
      await page.locator('.print-settings .el-slider__button-wrapper').first().focus()
      await page.keyboard.press('End')
      await waitReady(page)
      await expectSamePages(page, await readPdf(await savePdf(app, page, path.join(output, 'magnified.pdf'))))
    })
  })

  // Print slices such a row on its own. Its pages hold slightly more than the
  // preview's, so the PDF can come out a page shorter; it is saved anyway.
  test('saves a table row taller than a page and reports a different page count', async() => {
    const markdown =
      '# Tall row\n\nIntro paragraph.\n\n| Key | Notes |\n| --- | --- |\n| short | one line |\n' +
      `| tall | ${'A row taller than any page wraps this sentence again and again. '.repeat(260)} |\n` +
      '| after | the row that follows |\n\nClosing paragraph.\n'
    await withPreview(markdown, async(app, page, output) => {
      const shown = await previewPageCount(page)
      const preview = await previewPages(page)
      const pages = await readPdf(await savePdf(app, page, path.join(output, 'row.pdf')))
      expect(pages.length).toBeGreaterThanOrEqual(shown - 1)
      expect(pages.length).toBeLessThanOrEqual(shown)
      // Before the row, the pages are the previewed ones.
      expect(pageDifference(preview[0], pages[0].text)).toBeLessThanOrEqual(4)
      await expect(page.locator('.preview-caption')).toContainText(
        pages.length === shown ? `${shown} pages` : `The PDF has ${pages.length} pages; the preview showed ${shown}.`
      )
    })
  })
})
