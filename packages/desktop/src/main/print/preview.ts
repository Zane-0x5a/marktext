import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { getExportDefaultPath } from '../utils'
import {
  validatePrintLayout,
  PRINT_DPI,
  type PrintLayout,
  type PrintPage,
  type PrintOutcome
} from '@shared/types/print'

interface Session {
  owner: WebContents
  onOwnerDestroyed: () => void
  directory: string
  revision: number
  pdf?: Buffer
  layout?: PrintLayout
  pages: Set<number>
  worker?: BrowserWindow
  busy: boolean
}

const sessions = new Map<string, Session>()

const dispose = async(id: string): Promise<void> => {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  session.owner.removeListener('destroyed', session.onOwnerDestroyed)
  if (session.worker && !session.worker.isDestroyed()) session.worker.destroy()
  await rm(session.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

const owned = (owner: WebContents, id: string, revision?: number): Session => {
  const session = sessions.get(id)
  if (
    !session ||
    session.owner !== owner ||
    (revision !== undefined && session.revision !== revision)
  ) {
    throw new Error('Print preview expired. Open it again.')
  }
  return session
}

const workerWindow = (): BrowserWindow => {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  return win
}

// The job contains the already paginated PDF's pixels at 300 dpi. No document
// text is reflowed at this boundary, including by a printer's font substitution.
const fixedPageHtml = (session: Session, count: number): string => {
  const { width, height } = session.layout!
  const images = Array.from(
    { length: count },
    (_, index) =>
      `<img class="print-sheet" src="${pathToFileURL(path.join(session.directory, `page-${index + 1}.png`)).href}">`
  ).join('')
  return `<!doctype html><meta charset="utf-8"><style>
    @page { size: ${width}mm ${height}mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    .print-sheet { display: block; width: ${width}mm; height: ${height}mm;
      break-after: page; break-inside: avoid; object-fit: fill; }
    .print-sheet:last-child { break-after: auto; }
  </style>${images}`
}

const waitForResources = async(win: BrowserWindow): Promise<void> => {
  const error = await win.webContents.executeJavaScript(`(async () => {
    try {
    await Promise.race([
      Promise.all([document.fonts.ready, ...Array.from(document.images, image =>
        image.decode().catch(() => { throw new Error('Image could not be loaded: ' + image.getAttribute('src')) })
      )]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Print resources timed out')), 20000))
    ])
    if (Array.from(document.fonts).some(font => font.status === 'error')) {
      throw new Error('A document font could not be loaded')
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return ''
    } catch (error) { return error.message }
  })()`)
  if (error) throw new Error(String(error))
}

/** Chromium owns pagination for PDF export and preview. The caller owns the window. */
export const renderPrintPdf = async(
  win: BrowserWindow,
  source: string,
  html: string
): Promise<Buffer> => {
  const securedHtml = html.replace(
    /<head>/i,
    `<head><meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: file: https: http:; font-src data: file:;">`
  )
  await writeFile(source, securedHtml, 'utf8')
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      win.loadFile(source),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Print document timed out')), 30000)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
  // Fonts inside the hidden print container do not load in screen media.
  // Chromium must lay out print media before fonts.ready can protect the PDF.
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' })
  await waitForResources(win)
  return win.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    generateTaggedPDF: true,
    generateDocumentOutline: true
  })
}

export const registerPrintPreviewHandlers = (): void => {
  ipcMain.handle('mt::print-preview::open', async(event) => {
    for (const [id, session] of sessions) {
      if (session.owner === event.sender) await dispose(id)
    }
    const id = randomUUID()
    const directory = await mkdtemp(path.join(tmpdir(), 'marktext-print-'))
    if (event.sender.isDestroyed()) {
      await rm(directory, { recursive: true, force: true })
      throw new Error('Print window closed')
    }
    const onOwnerDestroyed = () => {
      dispose(id).catch(() => {})
    }
    sessions.set(id, {
      owner: event.sender,
      onOwnerDestroyed,
      directory,
      revision: 0,
      pages: new Set(),
      busy: false
    })
    event.sender.once('destroyed', onOwnerDestroyed)
    return id
  })

  ipcMain.handle(
    'mt::print-preview::render',
    async(event, id: string, html: string, layout: PrintLayout) => {
      const session = owned(event.sender, id)
      if (session.busy) throw new Error('Printing is in progress')
      validatePrintLayout(layout)
      if (typeof html !== 'string' || html.length > 50_000_000) { throw new Error('Invalid print document') }
      const revision = ++session.revision
      session.pdf = undefined
      session.pages.clear()
      if (session.worker && !session.worker.isDestroyed()) session.worker.destroy()
      const win = workerWindow()
      session.worker = win
      try {
        const source = path.join(session.directory, `document-${revision}.html`)
        const pdf = await renderPrintPdf(win, source, html)
        owned(event.sender, id, revision)
        session.pdf = pdf
        session.layout = layout
        return { revision, pdf: new Uint8Array(pdf), layout }
      } finally {
        if (!win.isDestroyed()) win.destroy()
        if (session.worker === win) session.worker = undefined
      }
    }
  )

  ipcMain.handle('mt::print-preview::printers', async(event) => {
    const printers = await event.sender.getPrintersAsync()
    return printers.map(({ name, displayName }) => ({ name, displayName }))
  })

  ipcMain.handle(
    'mt::print-preview::page',
    async(event, id: string, revision: number, page: PrintPage) => {
      const session = owned(event.sender, id, revision)
      if (
        !session.pdf ||
        session.busy ||
        !Number.isInteger(page.number) ||
        page.number < 1 ||
        page.number > 1000
      ) {
        throw new Error('Invalid print page')
      }
      const png = Buffer.from(page.png)
      if (
        png.length < 24 ||
        png.length > 80_000_000 ||
        png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      ) {
        throw new Error('Invalid page image')
      }
      const expectedWidth = Math.ceil((session.layout!.width / 25.4) * PRINT_DPI)
      const expectedHeight = Math.ceil((session.layout!.height / 25.4) * PRINT_DPI)
      if (
        Math.abs(png.readUInt32BE(16) - expectedWidth) > 2 ||
        Math.abs(png.readUInt32BE(20) - expectedHeight) > 2
      ) { throw new Error('Invalid page resolution') }
      await writeFile(path.join(session.directory, `page-${page.number}.png`), png)
      owned(event.sender, id, revision)
      session.pages.add(page.number)
    }
  )

  ipcMain.handle(
    'mt::print-preview::save',
    async(
      event,
      id: string,
      revision: number,
      document: { pathname: string | null; title: string }
    ): Promise<PrintOutcome> => {
      const session = owned(event.sender, id, revision)
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!session.pdf || !win || session.busy) throw new Error('Print preview is not ready')
      const pathname = typeof document?.pathname === 'string' ? document.pathname : null
      const title = typeof document?.title === 'string' ? document.title : ''
      session.busy = true
      try {
        const result = await dialog.showSaveDialog(win, {
          defaultPath: getExportDefaultPath(pathname, title, '.pdf'),
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })
        if (result.canceled || !result.filePath) return { status: 'canceled' }
        owned(event.sender, id, revision)
        await writeFile(result.filePath, session.pdf)
        // Same notice as any other export, with a link to the file.
        event.sender.send('mt::export-success', { type: 'pdf', filePath: result.filePath })
        return { status: 'success' }
      } catch (error) {
        return { status: 'error', error: error instanceof Error ? error.message : String(error) }
      } finally {
        session.busy = false
      }
    }
  )

  ipcMain.handle(
    'mt::print-preview::print',
    async(
      event,
      id: string,
      revision: number,
      deviceName: string,
      copies: number,
      count: number
    ): Promise<PrintOutcome> => {
      const session = owned(event.sender, id, revision)
      if (
        !session.pdf ||
        !session.layout ||
        session.busy ||
        !Number.isInteger(count) ||
        count < 1 ||
        session.pages.size !== count ||
        !Array.from({ length: count }, (_, i) => i + 1).every((i) => session.pages.has(i)) ||
        !Number.isInteger(copies) ||
        copies < 1 ||
        copies > 99
      ) { throw new Error('Print preview is not ready') }
      session.busy = true
      const win = workerWindow()
      session.worker = win
      try {
        const printers = await event.sender.getPrintersAsync()
        owned(event.sender, id, revision)
        if (!printers.some((printer) => printer.name === deviceName)) { throw new Error('Printer is unavailable') }
        const source = path.join(session.directory, 'job.html')
        await writeFile(source, fixedPageHtml(session, count), 'utf8')
        await win.loadFile(source)
        await waitForResources(win)
        owned(event.sender, id, revision)
        const { width, height } = session.layout
        return await new Promise<PrintOutcome>((resolve) => {
          const finish = (result: PrintOutcome) => {
            clearTimeout(timeout)
            resolve(result)
          }
          const timeout = setTimeout(
            () =>
              finish({
                status: 'error',
                error: 'Printer did not respond. Check its queue before retrying.'
              }),
            120000
          )
          win.once('closed', () => finish({ status: 'canceled' }))
          win.webContents.once('render-process-gone', () =>
            finish({ status: 'error', error: 'Print renderer stopped' })
          )
          win.webContents.print(
            {
              silent: true,
              deviceName,
              copies,
              collate: true,
              printBackground: true,
              color: true,
              margins: { marginType: 'none' },
              pageSize: { width: Math.round(width * 1000), height: Math.round(height * 1000) },
              landscape: false,
              scaleFactor: 100
            },
            (success, reason) =>
              finish(
                success
                  ? { status: 'success' }
                  : /cancel/i.test(reason)
                    ? { status: 'canceled' }
                    : { status: 'error', error: reason }
              )
          )
        })
      } catch (error) {
        return { status: 'error', error: error instanceof Error ? error.message : String(error) }
      } finally {
        session.busy = false
        if (!win.isDestroyed()) win.destroy()
        if (session.worker === win) session.worker = undefined
      }
    }
  )

  ipcMain.handle('mt::print-preview::close', async(event, id: string) => {
    owned(event.sender, id)
    await dispose(id)
  })
}
