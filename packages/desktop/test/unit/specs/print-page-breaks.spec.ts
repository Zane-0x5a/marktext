import { describe, expect, it } from 'vitest'
import { applyPageStarts, type PageStart } from '@/printPreview/pageBreaks'

// Browsers keep `0`; jsdom normalizes it to `0px`.
const ZERO = /^0(px)?$/

const parse = (body: string) => {
  const doc = new DOMParser().parseFromString(`<article class="markdown-body">${body}</article>`, 'text/html')
  return doc.querySelector('article')!
}

const start = (path: number[], offset: number | null, extra: Partial<PageStart> = {}): PageStart => ({
  path,
  offset,
  lineBlockDepth: 0,
  justify: false,
  adjoiningMargins: 0,
  ...extra
})

describe('replaying preview page starts as forced breaks', () => {
  it('forces a break before a top-level block and drops its truncated margins', () => {
    const root = parse('<p>one</p><blockquote><p>two</p></blockquote>')
    applyPageStarts(root, [start([1], null, { adjoiningMargins: 2 })])
    const quote = root.children[1] as HTMLElement
    expect(quote.classList.contains('mt-page-start')).toBe(true)
    expect(quote.style.getPropertyValue('margin-block-start')).toMatch(ZERO)
    expect((quote.firstElementChild as HTMLElement).style.getPropertyValue('margin-block-start')).toMatch(ZERO)
  })

  it('splits a paragraph at the first character of the next page', () => {
    const root = parse('<p>first line <strong>bold text</strong> rest</p>')
    // Cut inside the <strong> text node, after "bold ".
    applyPageStarts(root, [start([0, 1, 0], 5, { lineBlockDepth: 1, justify: true })])
    const [before, after] = Array.from(root.children) as HTMLElement[]
    expect(before.textContent).toBe('first line bold ')
    expect(after.textContent).toBe('text rest')
    expect(after.tagName).toBe('P')
    expect(after.classList.contains('mt-page-start')).toBe(true)
    expect(after.style.getPropertyValue('text-indent')).toMatch(ZERO)
    expect(after.style.getPropertyValue('margin-block-start')).toMatch(ZERO)
    expect(before.style.getPropertyValue('margin-block-end')).toMatch(ZERO)
    expect(before.style.getPropertyValue('text-align-last')).toBe('justify')
  })

  it('continues an ordered list item without a second marker and keeps the numbering', () => {
    const root = parse('<ol start="3"><li><p>a</p></li><li><p>b and more</p></li><li><p>c</p></li></ol>')
    // Inside the text of the second item (number 4).
    applyPageStarts(root, [start([0, 1, 0, 0], 2, { lineBlockDepth: 3 })])
    const [first, second] = Array.from(root.children) as HTMLElement[]
    expect(first.textContent).toBe('ab ')
    expect(second.getAttribute('start')).toBe('4')
    const continued = second.firstElementChild as HTMLElement
    expect(continued.style.getPropertyValue('list-style-type')).toBe('none')
    expect(second.children).toHaveLength(2)
    expect(second.lastElementChild!.textContent).toBe('c')
  })

  it('starts the next page with a whole list item', () => {
    const root = parse('<ol><li>a</li><li>b</li><li>c</li></ol>')
    applyPageStarts(root, [start([0, 2], null, { adjoiningMargins: 1 })])
    const [first, second] = Array.from(root.children) as HTMLElement[]
    expect(first.children).toHaveLength(2)
    expect(second.getAttribute('start')).toBe('3')
    const moved = second.firstElementChild as HTMLElement
    expect(moved.textContent).toBe('c')
    expect(moved.style.getPropertyValue('list-style-type')).toBe('')
  })

  it('continues a reversed list counting down, the first half keeping its numbers', () => {
    const root = parse('<ol reversed><li>a</li><li>b</li><li>c</li><li>d</li><li>e</li></ol>')
    applyPageStarts(root, [start([0, 2], null)])
    const [first, second] = Array.from(root.children)
    // 5, 4 | 3, 2, 1
    expect(first.getAttribute('start')).toBe('5')
    expect(second.getAttribute('start')).toBe('3')
    expect(second.hasAttribute('reversed')).toBe(true)

    const counted = parse('<ol reversed start="10"><li>a</li><li>b</li><li>c</li></ol>')
    applyPageStarts(counted, [start([0, 2], null)])
    expect(counted.children[1].getAttribute('start')).toBe('8')
  })

  it('continues the numbering after an item that sets its own value', () => {
    const root = parse('<ol><li>a</li><li value="7">b</li><li>c</li></ol>')
    applyPageStarts(root, [start([0, 2], null)])
    expect(root.children[1].getAttribute('start')).toBe('8')
  })

  it('splits a table between rows into a continuation table', () => {
    const root = parse('<table><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>')
    applyPageStarts(root, [start([0, 0, 1], null, { adjoiningMargins: 1 })])
    const [first, second] = Array.from(root.children)
    expect(first.querySelectorAll('tr')).toHaveLength(1)
    expect(second.tagName).toBe('TABLE')
    expect(second.querySelectorAll('tr')).toHaveLength(1)
    expect(second.textContent).toBe('2')
  })

  it('applies several page starts without disturbing earlier paths', () => {
    const root = parse('<p>aaaa bbbb</p><p>cccc dddd</p><p>eeee</p>')
    applyPageStarts(root, [start([0, 0], 5, { lineBlockDepth: 1 }), start([1, 0], 5, { lineBlockDepth: 1 }), start([2], null)])
    expect(Array.from(root.children, (child) => child.textContent)).toEqual(['aaaa ', 'bbbb', 'cccc ', 'dddd', 'eeee'])
    expect(Array.from(root.children, (child) => child.classList.contains('mt-page-start'))).toEqual([
      false,
      true,
      false,
      true,
      true
    ])
  })
})
