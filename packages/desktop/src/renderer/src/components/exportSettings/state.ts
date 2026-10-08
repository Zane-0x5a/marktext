import type { PrintStyleOptions } from '@/printPreview/printCss'

export type BlockSpacing = NonNullable<PrintStyleOptions['blockSpacing']>

/** Every export option the dialog persists (#2287). Lengths are mm, sizes CSS px. */
export interface ExportSettingsState {
  htmlTitle: string
  pageSize: string
  pageSizeWidth: number
  pageSizeHeight: number
  isLandscape: boolean
  pageMarginTop: number
  pageMarginRight: number
  pageMarginBottom: number
  pageMarginLeft: number
  fontSettingsOverwrite: boolean
  fontFamily: string
  fontSize: number
  lineHeight: number
  autoNumberingHeadings: boolean
  showFrontMatter: boolean
  theme: string
  headerTextLeft: string
  headerTextCenter: string
  headerTextRight: string
  footerTextLeft: string
  footerTextCenter: string
  footerTextRight: string
  headerFooterStyled: boolean
  headerFooterFontSize: number
  tocTitle: string
  tocIncludeTopHeading: boolean
  /** Percentages, 100 = the theme's own size. */
  printScale: number
  codeScale: number
  mathScale: number
  blockSpacing: BlockSpacing
  imageMaxWidth: number
  breakBeforeH1: boolean
  breakBeforeH2: boolean
}

export const createExportSettings = (): ExportSettingsState => ({
  htmlTitle: '',
  pageSize: 'A4',
  pageSizeWidth: 210,
  pageSizeHeight: 297,
  isLandscape: false,
  pageMarginTop: 20,
  pageMarginRight: 15,
  pageMarginBottom: 20,
  pageMarginLeft: 15,
  fontSettingsOverwrite: false,
  fontFamily: 'Default',
  fontSize: 14,
  lineHeight: 1.5,
  autoNumberingHeadings: false,
  showFrontMatter: false,
  theme: 'default',
  headerTextLeft: '',
  headerTextCenter: '',
  headerTextRight: '',
  footerTextLeft: '',
  footerTextCenter: '',
  footerTextRight: '',
  headerFooterStyled: false,
  headerFooterFontSize: 11,
  tocTitle: '',
  tocIncludeTopHeading: true,
  printScale: 100,
  codeScale: 100,
  mathScale: 100,
  blockSpacing: 'default',
  imageMaxWidth: 100,
  breakBeforeH1: false,
  breakBeforeH2: false
})

const PARTS = ['Left', 'Center', 'Right'] as const

/**
 * Applies saved settings onto `settings`, ignoring unknown keys and values of
 * the wrong type. Settings saved before running text had its own fields stored
 * a header/footer type (0 none, 1 centre only, 2 three cells) beside texts that
 * stayed saved while hidden; only the shown texts carry over.
 */
export const restoreExportSettings = (settings: ExportSettingsState, saved: Record<string, unknown>): void => {
  for (const key of Object.keys(settings) as Array<keyof ExportSettingsState>) {
    const value = saved[key]
    if (typeof value === typeof settings[key]) (settings as unknown as Record<string, unknown>)[key] = value
  }
  for (const band of ['header', 'footer'] as const) {
    const type = saved[`${band}Type`]
    if (typeof type !== 'number') continue
    for (const part of PARTS) {
      const shown = type === 2 || (type === 1 && part === 'Center')
      if (!shown) settings[`${band}Text${part}`] = ''
    }
  }
}

export const runningTexts = (settings: ExportSettingsState, band: 'header' | 'footer'): [string, string, string] =>
  [settings[`${band}TextLeft`], settings[`${band}TextCenter`], settings[`${band}TextRight`]]

/** The options consumed by `getCssForOptions`, `getPrintLayout` and the preview. */
export const toExportOptions = (settings: ExportSettingsState, type: string): Record<string, unknown> => {
  const options: Record<string, unknown> = {
    type,
    pageSize: settings.pageSize,
    pageSizeWidth: settings.pageSizeWidth,
    pageSizeHeight: settings.pageSizeHeight,
    isLandscape: settings.isLandscape,
    pageMarginTop: settings.pageMarginTop,
    pageMarginRight: settings.pageMarginRight,
    pageMarginBottom: settings.pageMarginBottom,
    pageMarginLeft: settings.pageMarginLeft,
    autoNumberingHeadings: settings.autoNumberingHeadings,
    showFrontMatter: settings.showFrontMatter,
    theme: settings.theme === 'default' ? null : settings.theme,
    tocTitle: settings.tocTitle,
    tocIncludeTopHeading: settings.tocIncludeTopHeading
  }
  if (type === 'styledHtml') options.htmlTitle = settings.htmlTitle
  if (settings.fontSettingsOverwrite) {
    Object.assign(options, {
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      fontFamily: settings.fontFamily === 'Default' ? null : settings.fontFamily
    })
  }
  if (type !== 'styledHtml') {
    Object.assign(options, {
      header: runningTexts(settings, 'header'),
      footer: runningTexts(settings, 'footer'),
      headerFooterStyled: settings.headerFooterStyled,
      headerFooterFontSize: settings.headerFooterFontSize,
      printScale: settings.printScale,
      codeScale: settings.codeScale,
      mathScale: settings.mathScale,
      blockSpacing: settings.blockSpacing,
      imageMaxWidth: settings.imageMaxWidth,
      breakBeforeH1: settings.breakBeforeH1,
      breakBeforeH2: settings.breakBeforeH2
    })
  }
  return options
}
