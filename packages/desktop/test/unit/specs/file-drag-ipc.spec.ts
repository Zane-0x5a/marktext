import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { handlers, icon, warn } = vi.hoisted(() => {
  const icon = { isEmpty: vi.fn(() => false), resize: vi.fn() }
  icon.resize.mockReturnValue(icon)
  return {
    handlers: new Map<string, (event: unknown, pathname: unknown) => void>(),
    icon,
    warn: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, handler: (event: unknown, pathname: unknown) => void) =>
      handlers.set(channel, handler)
  },
  nativeImage: { createFromPath: () => icon }
}))
vi.mock('electron-log', () => ({ default: { warn } }))

let directory: string
let filename: string
let startDrag: ReturnType<typeof vi.fn>
let event: {
  sender: { isDestroyed: () => boolean; mainFrame: object; startDrag: typeof startDrag }
  senderFrame: object
}

beforeAll(async() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'marktext-drag-'))
  filename = path.join(directory, '中文 note #1.md')
  writeFileSync(filename, '# Saved content\n', 'utf8')
  vi.stubGlobal('__static', directory)
  const { registerFileDragHandlers } = await import('main_renderer/ipc/fileDrag')
  registerFileDragHandlers()
})

afterAll(() => {
  vi.unstubAllGlobals()
  rmSync(directory, { recursive: true, force: true })
})

beforeEach(() => {
  warn.mockClear()
  icon.isEmpty.mockReturnValue(false)
  startDrag = vi.fn()
  const frame = {}
  event = { sender: { isDestroyed: () => false, mainFrame: frame, startDrag }, senderFrame: frame }
})

const drag = (pathname: unknown): void => {
  const handler = handlers.get('mt::start-file-drag')
  if (!handler) throw new Error('File drag handler was not registered')
  handler(event, pathname)
}

describe('Native file drag IPC', () => {
  it('hands the original Unicode path and a non-empty icon to the initiating webContents', () => {
    drag(filename)
    expect(startDrag).toHaveBeenCalledWith({ file: filename, icon })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['', 'relative.md', null, 42, { pathname: 'note.md' }])(
    'ignores invalid paths: %j',
    (pathname) => {
      drag(pathname)
      expect(startDrag).not.toHaveBeenCalled()
    }
  )

  it('refuses directories and missing files without throwing', () => {
    drag(directory)
    expect(() => drag(path.join(directory, 'deleted.md'))).not.toThrow()
    expect(startDrag).not.toHaveBeenCalled()
  })

  it('does not accept a path containing a NUL', () => {
    drag(filename + '\0')
    expect(startDrag).not.toHaveBeenCalled()
  })

  it('rejects requests from subframes or destroyed senders', () => {
    event.senderFrame = {}
    drag(filename)
    event.senderFrame = event.sender.mainFrame
    event.sender.isDestroyed = () => true
    drag(filename)
    expect(startDrag).not.toHaveBeenCalled()
  })

  it('does not start with an empty icon, which macOS rejects', () => {
    icon.isEmpty.mockReturnValue(true)
    drag(filename)
    expect(startDrag).not.toHaveBeenCalled()
  })

  it('contains native drag failures instead of raising an application error', () => {
    startDrag.mockImplementation(() => {
      throw new Error('Native drag unavailable')
    })
    expect(() => drag(filename)).not.toThrow()
    expect(warn).toHaveBeenCalledOnce()
  })
})
