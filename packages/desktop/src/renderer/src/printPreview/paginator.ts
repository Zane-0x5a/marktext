import type { PrintLayout } from '@shared/types/print'
import { applyPageStarts, findPageStarts } from './pageBreaks'
import {
  CHROME_GAP_MM,
  getPageCss,
  getPreviewBreakCss,
  getPrintLayoutCss,
  hasChrome,
  mmToPx,
  resolveChromeText,
  type PageChrome,
  type PrintStyleOptions
} from './printCss'

/** Space between sheets in the preview, CSS px. */
export const SHEET_GAP = 20
// Print layout can still come out a few pixels taller than the preview's.
// Preview pages hold slightly less than the paper, so each fits on one sheet.
const SAFETY_RATIO = 0.012
const MIN_SAFETY = 6
// An image that never finishes loading must not hold the preview: after this
// long it is laid out with what has arrived. Printing waits for it again and
// reports it if it still does not load.
const RESOURCE_TIMEOUT_MS = 10000

export interface PreviewSettings {
  layout: PrintLayout
  /** Theme, font and heading rules from `getCssForOptions`. */
  css: string
  style: PrintStyleOptions
  chrome: PageChrome
}

export interface PreviewGeometry {
  pageCount: number
  /** Unscaled size of the whole stack of sheets, CSS px. */
  width: number
  height: number
  /** Distance from one sheet's top to the next, CSS px. */
  pitch: number
  /**
   * The frame draws the sheets at this fraction of their size (one device
   * pixel per CSS px, the density print lays text out at); the caller sizes
   * the iframe accordingly and magnifies it back.
   */
  density: number
}

const STAGE_CSS = `
html, body { margin: 0 !important; padding: 0 !important; background: transparent !important;
  overflow: hidden !important; width: auto !important; height: auto !important; position: static !important; }
/* The print styles hide every other child of body. */
.mt-stage { position: relative; display: block !important; }
.mt-sheet { position: absolute; left: 0; background: #fff; overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.16), 0 6px 20px rgba(0, 0, 0, 0.08); }
/* Physical left/center/right like the print margin boxes, also in RTL documents. */
.mt-band { position: absolute; display: grid; grid-template-columns: 1fr auto 1fr; column-gap: 12px;
  direction: ltr; color: #555; line-height: 1.3; white-space: pre-wrap; overflow-wrap: anywhere; box-sizing: border-box; }
.mt-band > * { unicode-bidi: plaintext; }
.mt-band.top { align-items: end; }
.mt-band.bottom { align-items: start; }
.mt-band.ruled.top { border-bottom: 0.5pt solid #999; }
.mt-band.ruled.bottom { border-top: 0.5pt solid #999; }
.mt-band > :nth-child(1) { text-align: left; }
.mt-band > :nth-child(2) { text-align: center; }
.mt-band > :nth-child(3) { text-align: right; }
`

// The print document is styled for print media; the preview is screen media.
// Rewrite each media query to what it would evaluate to when printing.
const asPrinted = (query: string): string => {
  const match = /^\s*(only\s+)?(not\s+)?(print|screen|all)\b(.*)$/i.exec(query)
  if (!match) return query
  const [, , not, type, rest] = match
  const typeMatches = type.toLowerCase() !== 'screen'
  if (not) return typeMatches ? `not all${rest}` : 'all'
  return typeMatches ? `all${rest}` : 'not all'
}

const rewriteMedia = (rules: CSSRuleList): void => {
  for (const rule of Array.from(rules)) {
    // Rules come from the iframe's realm, so no `instanceof` checks.
    if ('cssRules' in rule && 'media' in rule) {
      const media = (rule as CSSMediaRule).media
      media.mediaText = Array.from(media).map(asPrinted).join(', ')
    }
    if ('cssRules' in rule) rewriteMedia((rule as CSSGroupingRule).cssRules)
  }
}

/**
 * The paged preview: the print document laid out in an iframe, its content in
 * CSS columns that are exactly one page's content box, stacked as sheets.
 * The iframe is as tall as all sheets; the caller scrolls and scales it.
 */
export class PrintPreviewFrame {
  private doc: Document | null = null
  private sheets: HTMLElement | null = null
  private flow: HTMLElement | null = null
  private content: HTMLElement | null = null
  private optionsStyle: HTMLStyleElement | null = null
  private layoutStyle: HTMLStyleElement | null = null
  private geometryStyle: HTMLStyleElement | null = null
  private geometry: PreviewGeometry = { pageCount: 1, width: 0, height: 0, pitch: 1, density: 1 }
  private settings: PreviewSettings | null = null
  private columnHeight = 0
  private source = ''

  constructor(private readonly iframe: HTMLIFrameElement) {}

  /** Loads a print document produced by `preparePrintDocument`. */
  async load(html: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.iframe.removeEventListener('load', done)
        resolve()
      }
      const timer = setTimeout(done, RESOURCE_TIMEOUT_MS)
      this.iframe.addEventListener('load', done)
      this.iframe.srcdoc = html
    })
    const doc = this.iframe.contentDocument
    const flow = doc?.querySelector<HTMLElement>('article.print-container')
    const content = flow?.querySelector<HTMLElement>('article.markdown-body')
    if (!doc || !flow || !content) throw new Error('Print document has no content')
    this.source = html
    this.doc = doc
    this.flow = flow
    this.content = content
    const style = (id: string) => {
      const element = doc.createElement('style')
      element.id = id
      doc.head.append(element)
      return element
    }
    style('mt-stage').textContent = STAGE_CSS
    this.optionsStyle = style('mt-options')
    this.layoutStyle = style('mt-layout')
    this.geometryStyle = style('mt-geometry')
    for (const sheet of Array.from(doc.styleSheets)) rewriteMedia(sheet.cssRules)
    const stage = doc.createElement('div')
    stage.className = 'mt-stage'
    this.sheets = doc.createElement('div')
    flow.before(stage)
    stage.append(this.sheets, flow)
    await this.resourcesReady()
  }

  private async resourcesReady(): Promise<void> {
    const doc = this.doc!
    const ready = Promise.all([
      doc.fonts.ready,
      ...Array.from(doc.images, (image) => image.decode().catch(() => {}))
    ])
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, RESOURCE_TIMEOUT_MS)
      ready.then(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Lays the document out for `settings` and redraws the sheets. */
  async update(settings: PreviewSettings): Promise<PreviewGeometry> {
    const doc = this.doc
    if (!doc || !this.flow) throw new Error('Print preview is not loaded')
    // A frame that is not rendered has no viewport and would lay out one empty page.
    if (!doc.defaultView?.innerWidth) throw new Error('Print preview frame is not rendered')
    this.settings = settings
    const { layout } = settings
    const width = mmToPx(layout.width)
    const height = mmToPx(layout.height)
    const contentHeight = mmToPx(layout.height - layout.top - layout.bottom)
    const columnHeight = contentHeight - Math.max(MIN_SAFETY, contentHeight * SAFETY_RATIO)
    const pitch = height + SHEET_GAP
    this.columnHeight = columnHeight
    // At a fractional screen scale glyph metrics round differently from print,
    // enough for a narrow table cell to wrap an extra line.
    const density = 1 / (doc.defaultView!.devicePixelRatio || 1)
    this.optionsStyle!.textContent = settings.css
    rewriteMedia(this.optionsStyle!.sheet!.cssRules)
    this.layoutStyle!.textContent =
      getPrintLayoutCss(settings.style, columnHeight) + '\n' + getPreviewBreakCss(settings.style)
    this.geometryStyle!.textContent = `
      .mt-stage { zoom: ${density}; }
      body article.print-container { display: block !important; position: absolute !important;
        left: ${mmToPx(layout.left)}px; top: ${mmToPx(layout.top)}px; margin: 0 !important;
        box-sizing: content-box !important; width: ${mmToPx(layout.width - layout.left - layout.right)}px !important;
        height: auto !important; columns: 1; column-gap: 0; column-fill: auto; column-wrap: wrap;
        column-height: ${columnHeight}px; row-gap: ${pitch - columnHeight}px; }`
    await this.resourcesReady()
    const flowHeight = this.flow.getBoundingClientRect().height / density
    const pageCount = Math.max(1, Math.round((flowHeight + pitch - columnHeight) / pitch))
    this.geometry = { pageCount, width, height: pageCount * pitch - SHEET_GAP, pitch, density }
    this.drawSheets()
    return this.geometry
  }

  private drawSheets(): void {
    const doc = this.doc!
    const { layout, chrome } = this.settings!
    const { pageCount, pitch } = this.geometry
    const fontFamily = this.fontFamily()
    const band = (texts: readonly string[], edge: 'top' | 'bottom', page: number): HTMLElement | null => {
      if (!hasChrome(texts)) return null
      const element = doc.createElement('div')
      element.className = `mt-band ${edge}${chrome.ruled ? ' ruled' : ''}`
      Object.assign(element.style, {
        left: `${mmToPx(layout.left)}px`,
        right: `${mmToPx(layout.right)}px`,
        [edge]: '0',
        height: `${mmToPx(edge === 'top' ? layout.top : layout.bottom)}px`,
        [edge === 'top' ? 'paddingBottom' : 'paddingTop']: `${mmToPx(CHROME_GAP_MM)}px`,
        fontSize: `${chrome.fontSize}px`,
        fontFamily
      })
      for (const text of texts) {
        const cell = doc.createElement('span')
        cell.textContent = resolveChromeText(text, chrome, page, pageCount)
        element.append(cell)
      }
      return element
    }
    const sheet = (index: number): HTMLElement => {
      const element = doc.createElement('div')
      element.className = 'mt-sheet'
      Object.assign(element.style, {
        top: `${index * pitch}px`,
        width: `${mmToPx(layout.width)}px`,
        height: `${mmToPx(layout.height)}px`
      })
      for (const part of [band(chrome.header, 'top', index + 1), band(chrome.footer, 'bottom', index + 1)]) {
        if (part) element.append(part)
      }
      return element
    }
    this.sheets!.replaceChildren(...Array.from({ length: pageCount }, (_, index) => sheet(index)))
    const stage = this.sheets!.parentElement!
    stage.style.width = `${this.geometry.width}px`
    stage.style.height = `${this.geometry.height}px`
  }

  private fontFamily(): string {
    return this.doc!.defaultView!.getComputedStyle(this.content!).fontFamily
  }

  /**
   * The print document for the current layout: the original markup with each
   * preview page start replayed as a forced page break.
   */
  buildPrintDocument(): string {
    if (!this.doc || !this.flow || !this.content || !this.settings) throw new Error('Print preview is not ready')
    const { pitch, pageCount, density } = this.geometry
    const flowTop = this.flow.getBoundingClientRect().top
    // Client rects are in the stage's zoomed space. A glyph's box can rise
    // above its line, but its middle stays in its column.
    const pageOf = (rect: DOMRect) => Math.floor((rect.top + rect.height / 2 - flowTop) / (pitch * density))
    const starts = findPageStarts(this.content, pageCount, pageOf)
    const output = new DOMParser().parseFromString(this.source, 'text/html')
    const root = output.querySelector('article.print-container article.markdown-body')
    if (!root) throw new Error('Print document has no content')
    applyPageStarts(root, starts)
    const { css, style, layout, chrome } = this.settings
    const extra = output.createElement('style')
    extra.textContent = [
      css,
      getPrintLayoutCss(style, this.columnHeight),
      getPageCss(layout, chrome, this.fontFamily())
    ].join('\n')
    output.head.append(extra)
    return '<!doctype html>\n' + output.documentElement.outerHTML
  }
}
