import { describe, expect, it } from 'vitest'
import {
  getPageCss,
  getPreviewBreakCss,
  getPrintLayoutCss,
  resolveChromeText,
  type PageChrome
} from '@/printPreview/printCss'
import { createExportSettings, restoreExportSettings, toExportOptions } from '@/components/exportSettings/state'

const chrome = (overrides: Partial<PageChrome> = {}): PageChrome => ({
  header: ['', '', ''],
  footer: ['', '', ''],
  fontSize: 10,
  ruled: false,
  title: 'Notes',
  date: '8 Oct 2026',
  ...overrides
})
const layout = { width: 210, height: 297, top: 20, right: 15, bottom: 20, left: 15 }

describe('print page CSS', () => {
  it('sizes the page and keeps page numbers as counters in margin boxes', () => {
    const css = getPageCss(layout, chrome({ footer: ['{title}', 'Page {page} of {pages}', ''] }), '"Open Sans", sans-serif')
    expect(css).toContain('size: 210mm 297mm;')
    expect(css).toContain('margin: 20mm 15mm 20mm 15mm;')
    expect(css).toContain('@bottom-left { content: "Notes";')
    expect(css).toContain('@bottom-center { content: "Page " counter(page) " of " counter(pages);')
    expect(css).toContain('@bottom-right { content: "";')
    expect(css).not.toContain('@top-')
    expect(css).toContain('font-family: "Open Sans", sans-serif;')
  })

  it('escapes running text so it cannot leave its CSS string or its style element', () => {
    const css = getPageCss(layout, chrome({ header: ['', 'a "quote" \\ } @page { </style>', ''] }), 'serif')
    expect(css).toContain('content: "a \\"quote\\" \\\\ } @page { \\3C /style>";')
    expect(css).not.toContain('</style')
  })

  it('fills placeholders for one preview sheet', () => {
    expect(resolveChromeText('{title} · {page}/{pages} · {date}', chrome(), 3, 9)).toBe('Notes · 3/9 · 8 Oct 2026')
  })

  it('emits only the rules options change, and always prevents repeated table headers', () => {
    const plain = getPrintLayoutCss({}, 900)
    expect(plain).toContain('thead { display: table-row-group; }')
    expect(plain).toContain('max-height: 900px')
    expect(plain).not.toContain('zoom')
    const tuned = getPrintLayoutCss(
      { printScale: 80, codeScale: 90, mathScale: 150, blockSpacing: 'compact', imageMaxWidth: 60 },
      900
    )
    expect(tuned).toContain('.markdown-body { zoom: 0.8; }')
    // The zoom applies to the limit too; drawn, an image is still at most a page tall.
    expect(tuned).toContain('max-height: 1125px')
    expect(tuned).toContain('.markdown-body pre { zoom: 0.9; }')
    expect(tuned).toContain('font-size: 1.815em')
    expect(tuned).toContain('margin-bottom: 0.5em')
    expect(tuned).toContain('max-width: 60% !important')
    expect(getPreviewBreakCss({ breakBeforeH2: true })).toContain('h2 { break-before: column; }')
  })
})

describe('export settings', () => {
  it('keeps only the running text an old header/footer type showed', () => {
    const settings = createExportSettings()
    restoreExportSettings(settings, {
      headerType: 1,
      headerTextLeft: 'hidden',
      headerTextCenter: 'shown',
      footerType: 0,
      footerTextCenter: 'hidden',
      pageMarginTop: 'not a number',
      printScale: 90
    })
    expect([settings.headerTextLeft, settings.headerTextCenter, settings.footerTextCenter]).toEqual(['', 'shown', ''])
    expect(settings.pageMarginTop).toBe(20)
    expect(settings.printScale).toBe(90)
  })

  it('passes print options only to printable exports', () => {
    const settings = createExportSettings()
    settings.footerTextCenter = '{page}'
    expect(toExportOptions(settings, 'print')).toMatchObject({ footer: ['', '{page}', ''], printScale: 100 })
    const html = toExportOptions(settings, 'styledHtml')
    expect(html).not.toHaveProperty('footer')
    expect(html).toHaveProperty('htmlTitle', '')
  })
})
