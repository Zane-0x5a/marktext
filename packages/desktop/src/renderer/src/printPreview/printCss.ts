import type { PrintLayout } from '@shared/types/print'

export const mmToPx = (mm: number): number => (mm * 96) / 25.4

/** Print-only options; percentages are 100 at the theme's own size. */
export interface PrintStyleOptions {
  printScale?: number
  codeScale?: number
  mathScale?: number
  blockSpacing?: 'compact' | 'default' | 'relaxed'
  imageMaxWidth?: number
  breakBeforeH1?: boolean
  breakBeforeH2?: boolean
}

/** Running header and footer text, left/center/right. */
export interface PageChrome {
  header: [string, string, string]
  footer: [string, string, string]
  /** CSS px. */
  fontSize: number
  ruled: boolean
  title: string
  date: string
}

const BLOCK_SPACING = { compact: '0.5em', relaxed: '1.5em' } as const
// KaTeX's own `.katex` size relative to the surrounding text.
const KATEX_EM = 1.21

/**
 * Layout rules shared verbatim by the preview and the print document, so both
 * lay out the same boxes. `contentHeight` is the preview's page content height
 * in CSS px; no image may be taller.
 */
export const getPrintLayoutCss = (options: PrintStyleOptions, contentHeight: number): string => {
  const scale = (options.printScale ?? 100) / 100
  const rules: string[] = [
    // A repeated header would take room on the next page that the preview, laid
    // out in columns, never reserves.
    '.markdown-body thead { display: table-row-group; }',
    // Inside the zoomed body, so the limit is divided by the zoom.
    `.markdown-body img { max-width: ${options.imageMaxWidth ?? 100}% !important; max-height: ${contentHeight / scale}px; object-fit: contain; }`
  ]
  if (scale !== 1) rules.push(`.markdown-body { zoom: ${scale}; }`)
  const code = (options.codeScale ?? 100) / 100
  if (code !== 1) rules.push(`.markdown-body pre { zoom: ${code}; }`)
  const math = (options.mathScale ?? 100) / 100
  if (math !== 1) rules.push(`.markdown-body .katex { font-size: ${KATEX_EM * math}em; }`)
  const spacing = options.blockSpacing && options.blockSpacing !== 'default' ? BLOCK_SPACING[options.blockSpacing] : null
  if (spacing) {
    rules.push(
      `.markdown-body :is(p, blockquote, ul, ol, dl, table, pre, details, figure, .katex-display) { margin-bottom: ${spacing}; }`
    )
  }
  return rules.join('\n')
}

/**
 * Breaks the preview forces itself. The print document needs no equivalent:
 * every preview page start becomes a forced break there.
 */
export const getPreviewBreakCss = (options: PrintStyleOptions): string =>
  [
    options.breakBeforeH1 ? '.markdown-body > * ~ h1 { break-before: column; }' : '',
    options.breakBeforeH2 ? '.markdown-body > * ~ h2 { break-before: column; }' : ''
  ].join('\n')

const TOKEN = /\{(page|pages|title|date)\}/g

/** Header/footer text with its placeholders filled in for one page. */
export const resolveChromeText = (text: string, chrome: PageChrome, page: number, pages: number): string =>
  text.replace(TOKEN, (_match, token: string) =>
    token === 'page' ? String(page) : token === 'pages' ? String(pages) : token === 'title' ? chrome.title : chrome.date
  )

// `<` is escaped too: the stylesheet is serialized inside a `<style>` element,
// which a `</style>` in the text would close.
const cssString = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3C ').replace(/\r?\n/g, '\\A ')}"`

// A margin-box `content` value; page numbers stay counters for print to fill in.
const cssContent = (text: string, chrome: PageChrome): string => {
  const parts: string[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    if (match.index! > last) parts.push(cssString(text.slice(last, match.index)))
    const token = match[1]
    parts.push(
      token === 'page' ? 'counter(page)' : token === 'pages' ? 'counter(pages)' : cssString(token === 'title' ? chrome.title : chrome.date)
    )
    last = match.index! + match[0].length
  }
  if (last < text.length) parts.push(cssString(text.slice(last)))
  return parts.length ? parts.join(' ') : '""'
}

export const hasChrome = (texts: readonly string[]): boolean => texts.some((text) => text.trim() !== '')

// Distance between running text and the page content, shared with the preview.
export const CHROME_GAP_MM = 4

/**
 * The print document's page box: size, margins, running header and footer,
 * and the forced breaks replayed from the preview. `fontFamily` is the body
 * font the preview resolved, since margin boxes do not inherit from it.
 */
export const getPageCss = (layout: PrintLayout, chrome: PageChrome, fontFamily: string): string => {
  const boxes: string[] = []
  const band = (texts: readonly string[], edge: 'top' | 'bottom') => {
    if (!hasChrome(texts)) return
    ;(['left', 'center', 'right'] as const).forEach((side, i) => {
      const rule = chrome.ruled ? `border-${edge === 'top' ? 'bottom' : 'top'}: 0.5pt solid #999;` : ''
      boxes.push(`@${edge}-${side} { content: ${cssContent(texts[i], chrome)};
        font-family: ${fontFamily}; font-size: ${chrome.fontSize}px; color: #555; text-align: ${side};
        white-space: pre-wrap; unicode-bidi: plaintext;
        vertical-align: ${edge === 'top' ? 'bottom' : 'top'}; padding-${edge === 'top' ? 'bottom' : 'top'}: ${CHROME_GAP_MM}mm; ${rule} }`)
    })
  }
  band(chrome.header, 'top')
  band(chrome.footer, 'bottom')
  return `@page {
  size: ${layout.width}mm ${layout.height}mm;
  margin: ${layout.top}mm ${layout.right}mm ${layout.bottom}mm ${layout.left}mm;
  ${boxes.join('\n  ')}
}
@media print {
  html, body { margin: 0 !important; padding: 0 !important; }
  .mt-page-start { break-before: page !important; }
}`
}
