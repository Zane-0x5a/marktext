import { ipcMain, nativeImage } from 'electron'
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
      event.sender.startDrag({ file: pathname, icon: dragIcon })
    } catch (error) {
      log.warn('Could not start file drag:', pathname, error)
    }
  })
}
