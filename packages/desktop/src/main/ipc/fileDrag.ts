import { BrowserWindow, ipcMain, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import { statSync } from 'node:fs'
import path from 'node:path'
import log from 'electron-log'

let dragIcon: NativeImage | undefined

export const registerFileDragHandlers = (): void => {
  ipcMain.on('mt::start-file-drag', (event, pathname: unknown) => {
    if (event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) return
    if (
      typeof pathname !== 'string' ||
      !path.isAbsolute(pathname) ||
      pathname.includes('\0')
    ) {
      return
    }

    try {
      // Start while the initiating mouse button is still held; async file/icon
      // lookups can outlive the gesture and silently cancel the native drag.
      if (!statSync(pathname).isFile()) return
      dragIcon ??= nativeImage
        .createFromPath(path.join(__static, 'logo-small.png'))
        .resize({ width: 32, height: 32 })
      if (dragIcon.isEmpty()) return
      // Windows keeps startDrag on the stack until drop or cancellation. macOS
      // returns immediately and exposes no completion callback through this API.
      const window = process.platform === 'win32'
        ? BrowserWindow.fromWebContents(event.sender)
        : null
      const wasVisible = window?.isVisible() ?? false
      try {
        if (wasVisible) window?.hide()
        event.sender.startDrag({ file: pathname, icon: dragIcon })
      } finally {
        if (wasVisible && window && !window.isDestroyed()) window.showInactive()
      }
    } catch (error) {
      log.warn('Could not start file drag:', pathname, error)
    }
  })
}
