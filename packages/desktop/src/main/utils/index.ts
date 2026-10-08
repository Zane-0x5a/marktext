import { app } from 'electron'
import path from 'path'

const ID_PREFIX = 'mt-'
let id = 0

export const getUniqueId = (): string => {
  return `${ID_PREFIX}${id++}`
}

// TODO: Remove this function and load the recommend title from the editor (renderer) when
// requesting the document to save/export.
export const getRecommendTitleFromMarkdownString = (markdown: string): string => {
  // NOTE: We should read the title from the renderer cache because this regex matches in
  // code blocks too.
  const tokens = markdown.match(/#{1,6} {1,}(.*\S.*)(?:\n|$)/g)
  if (!tokens) return ''
  const headers = tokens.map((t) => {
    const matches = t.trim().match(/(#{1,6}) {1,}(.+)/)!
    return {
      level: matches[1]!.length,
      content: matches[2]!.trim()
    }
  })
  return headers.sort((a, b) => a.level - b.level)[0]!.content
}

/**
 * Returns a special directory path for the requested name.
 *
 * NOTE: Do not use "userData" to get the user data path, instead use AppPaths!
 *
 * @param name The special directory name.
 * @returns The resolved special directory path.
 */
export const getPath = (name: Parameters<typeof app.getPath>[0]): string => {
  if (name === 'userData') {
    throw new Error('Do not use "getPath" for user data path!')
  }
  return app.getPath(name)
}

/**
 * Where the save dialog for an exported copy starts: next to the document and
 * named after it, or named by `title` in Documents for an unsaved one.
 */
export const getExportDefaultPath = (
  pathname: string | null | undefined,
  title: string | undefined,
  extension: string
): string => {
  const name = pathname ? path.basename(pathname, path.extname(pathname)) : title
  // A title can carry a slash or another character the OS refuses in a basename.
  const stem = (name || '').replace(/[/\\:*?"<>|]/g, '-').trim() || 'Untitled'
  return path.join(pathname ? path.dirname(pathname) : getPath('documents'), stem + extension)
}

export const hasSameKeys = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  aKeys.sort()
  bKeys.sort()
  return aKeys.every((k, i) => k === bKeys[i])
}

export type LogLevel = 'silly' | 'debug' | 'verbose' | 'info'

export const getLogLevel = (): LogLevel => {
  const verbose = (globalThis as typeof globalThis & { MARKTEXT_DEBUG_VERBOSE?: number })
    .MARKTEXT_DEBUG_VERBOSE
  if (!verbose || typeof verbose !== 'number' || verbose <= 0) {
    return import.meta.env.DEV ? 'debug' : 'info'
  } else if (verbose === 1) {
    return 'verbose'
  } else if (verbose === 2) {
    return 'debug'
  }
  return 'silly' // >= 3
}
