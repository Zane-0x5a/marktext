import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import * as fs from 'node:fs'
import { launchWithMarkdown, waitForMenuReady, sendIpcToRenderer } from './helpers'

// #2423 — arrowheads vanished from sequence diagrams in exported PDFs.
//
// The diagram renderer hardcodes marker ids, and `url(#id)` binds to the first
// match in tree order. When the print document shared a DOM with the editor,
// the reference bound to the editor's copy of the same diagram, which print
// layout had removed, so it painted nothing. The paged preview lays the print
// document out in its own frame, which is also what is printed.
//
// The invariant is therefore: every `url(#…)` reference inside the print
// container must resolve to an element inside that same container.

const DOC =
  '```sequence\n' +
  'Alice->Bob: Hello Bob, how are you?\n' +
  'Bob-->Alice: I am good thanks!\n' +
  '```\n'

interface ReferenceReport {
  references: string[]
  unresolved: string[]
}

const stubSaveDialog = async(app: ElectronApplication, targetPath: string): Promise<void> => {
  await app.evaluate(async({ dialog }, savePath) => {
    ;(dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async() => ({
      canceled: false,
      filePath: savePath
    })
  }, targetPath)
}

// The preview frame holds the print document the PDF is made from.
const referenceReport = (page: Page): Promise<ReferenceReport> =>
  page.locator('.preview-frame').evaluate((frame) => {
    const doc = (frame as HTMLIFrameElement).contentDocument!
    const container = doc.querySelector('article.print-container')!
    const references = new Set<string>()
    for (const element of Array.from(container.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        for (const match of attribute.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) {
          references.add(match[1])
        }
      }
    }
    const unresolved = [...references].filter((id) => {
      const target = doc.getElementById(id)
      return !target || !container.contains(target)
    })
    return { references: [...references], unresolved }
  })

const pollForFile = async(filePath: string, timeoutMs = 60000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`PDF was not written within ${timeoutMs}ms: ${filePath}`)
}

test.describe('sequence diagram arrowheads survive PDF export (#2423)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    test.setTimeout(120000)
    const launched = await launchWithMarkdown(DOC)
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
    // The vendored js-sequence-diagrams renderer draws from a font-load
    // callback, so the editor's own copy needs a moment to appear.
    await page.waitForTimeout(5000)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('every url(#…) reference in the print container resolves inside it', async() => {
    test.setTimeout(120000)
    const target = `/tmp/marktext-e2e-2423-${Date.now()}.pdf`
    fs.rmSync(target, { force: true })

    await stubSaveDialog(app, target)
    await sendIpcToRenderer(app, 'mt::show-export-dialog', 'pdf')
    await page.locator('.print-preview[data-ready]').waitFor({ state: 'visible', timeout: 30000 })

    const report = await referenceReport(page)
    expect(
      report.references.length,
      'the sequence diagram should reference its arrowhead markers'
    ).toBeGreaterThan(0)
    expect(report.unresolved).toEqual([])

    await page.locator('.print-preview .button-primary').click()
    await pollForFile(target)
    fs.rmSync(target, { force: true })
  })
})
