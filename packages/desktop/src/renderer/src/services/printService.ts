import printCss from '../assets/styles/printService.css?inline'
import { PAPER_SIZES, validatePrintLayout, type PrintLayout } from '@shared/types/print'

export interface PreviewRequest {
  options: Record<string, unknown>
  resolve: (html: string) => void
  reject: (error: unknown) => void
}

export const getPrintLayout = (options: Record<string, unknown>): PrintLayout => {
  const paper = PAPER_SIZES[options.pageSize as keyof typeof PAPER_SIZES]
  const size = paper || [Number(options.pageSizeWidth), Number(options.pageSizeHeight)]
  const [width, height] = options.isLandscape ? [size[1], size[0]] : size
  const layout = {
    width,
    height,
    top: Number(options.pageMarginTop),
    right: Number(options.pageMarginRight),
    bottom: Number(options.pageMarginBottom),
    left: Number(options.pageMarginLeft)
  }
  validatePrintLayout(layout)
  return layout
}

/**
 * Standalone print document; no editor transform, zoom, or UI styles travel
 * with it. Page geometry, running text and option styles are added by the
 * paged preview (`@/printPreview`).
 */
export const preparePrintDocument = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.createElement('article')
  body.className = 'print-container'
  body.innerHTML = doc.body.innerHTML
  doc.body.replaceChildren(body)
  const style = doc.createElement('style')
  style.textContent = `${printCss}\n@media print {
    body .print-container { height: auto; }
    html, body { margin: 0 !important; padding: 0 !important; }
    body article.markdown-body { width: 100%; max-width: none; min-width: 0; padding: 0; }
    .markdown-body table { width: 100%; table-layout: fixed; }
    .markdown-body tr, .markdown-body img { break-inside: avoid; }
    .markdown-body img, .markdown-body svg { max-width: 100%; height: auto; }
  }`
  doc.head.appendChild(style)
  for (const script of doc.querySelectorAll('script')) script.remove()
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name)
    }
  }
  return '<!doctype html>\n' + doc.documentElement.outerHTML
}
