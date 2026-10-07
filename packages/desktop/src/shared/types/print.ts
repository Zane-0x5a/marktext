export const PAPER_SIZES = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8]
} as const

/** Shared by page rasterization and IPC resolution validation. */
export const PRINT_DPI = 300

/** All dimensions, including margins, are in millimetres. */
export interface PrintLayout {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

export interface PrintSnapshot {
  revision: number
  pdf: Uint8Array
  layout: PrintLayout
}

export interface PrintDevice {
  name: string
  displayName: string
}

export type PrintOutcome = { status: 'success' | 'canceled' } | { status: 'error'; error: string }

export interface PrintPage {
  number: number
  png: Uint8Array
}

export const validatePrintLayout = (layout: PrintLayout): void => {
  if (
    !layout ||
    Object.values(layout).length !== 6 ||
    ![layout.width, layout.height, layout.top, layout.right, layout.bottom, layout.left].every(
      (value) => typeof value === 'number' && Number.isFinite(value)
    )
  ) {
    throw new Error('Invalid page dimensions')
  }
  if (
    layout.width < 100 ||
    layout.width > 1000 ||
    layout.height < 100 ||
    layout.height > 1000 ||
    [layout.top, layout.right, layout.bottom, layout.left].some((value) => value < 0) ||
    layout.left + layout.right > layout.width - 20 ||
    layout.top + layout.bottom > layout.height - 20
  ) {
    throw new Error('Margins must leave at least 20 mm of printable content')
  }
}
