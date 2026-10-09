import { describe, it, expect } from 'vitest'
import { isSameList, type ListItem } from '@/util/listToTree'

const heading = (n: number, over: Record<string, unknown> = {}) => ({
  content: `Heading ${n}`,
  contentHtml: `Heading ${n}`,
  lvl: 2,
  slug: `slug-${n}`,
  githubSlug: `heading-${n}`,
  ...over
})

describe('isSameList (per-keystroke TOC comparison)', () => {
  it('treats equal lists of equal items as the same', () => {
    expect(isSameList([heading(1), heading(2)], [heading(1), heading(2)])).toBe(true)
    expect(isSameList([], [])).toBe(true)
  })

  it('is the same list when the very same array is compared', () => {
    const list = [heading(1)]
    expect(isSameList(list, list)).toBe(true)
  })

  it('detects a different length', () => {
    expect(isSameList([heading(1)], [heading(1), heading(2)])).toBe(false)
    expect(isSameList([], [heading(1)])).toBe(false)
  })

  it.each(['content', 'contentHtml', 'lvl', 'slug', 'githubSlug'])(
    'detects a change in %s',
    (key) => {
      const changed = key === 'lvl' ? 3 : 'changed'
      expect(
        isSameList([heading(1), heading(2)], [heading(1), heading(2, { [key]: changed })])
      ).toBe(false)
    }
  )

  it('detects an item that gained or lost a field', () => {
    const { githubSlug: _omitted, ...withoutGithubSlug } = heading(1)
    expect(isSameList([heading(1)], [withoutGithubSlug])).toBe(false)
    expect(isSameList([withoutGithubSlug], [heading(1)])).toBe(false)
  })

  it('does not confuse a missing field with an undefined one of the same name', () => {
    const { githubSlug: _omitted, ...withoutGithubSlug } = heading(1)
    const left = { ...withoutGithubSlug, other: undefined } as ListItem
    const right = { ...withoutGithubSlug, githubSlug: 'x' }
    expect(isSameList([left], [right])).toBe(false)
  })

  it('compares order-sensitively', () => {
    expect(isSameList([heading(1), heading(2)], [heading(2), heading(1)])).toBe(false)
  })
})
