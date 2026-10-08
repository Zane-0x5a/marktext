// Page breaks measured in the live preview and replayed on the print document.
//
// The preview lays the document out in CSS columns that are exactly one page's
// content box, so Chromium's own fragmentation decides every break. Print
// layout fragments independently and can differ by a few pixels, so the print
// document is not left to break on its own: each preview page start becomes a
// forced break, and a box that continues across pages is split into two boxes
// at the first line of the next page.

/** Where a page after the first begins, as child indexes from the content root. */
export interface PageStart {
  path: number[]
  /** Character offset into the text node at `path`; null means before the node. */
  offset: number | null
  /** Path length of the block whose lines are cut; 0 when the cut is between boxes. */
  lineBlockDepth: number
  /** That block is justified, so its last line on the page must stay justified. */
  justify: boolean
  /**
   * Boxes on the first-child chain of the element starting the page whose top
   * margins adjoin the break. Fragmentation truncates them; a forced break would not.
   */
  adjoiningMargins: number
}

const BLOCK_DISPLAYS =
  /^(block|list-item|table|flow-root|flex|grid|table-row-group|table-header-group|table-footer-group|table-row|table-caption)$/
const ATOMIC_INLINE = /^inline-(block|flex|grid|table)$/
const REPLACED = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'IFRAME', 'INPUT', 'MATH'])

type PageOf = (rect: DOMRect) => number

// The preview's nodes belong to its iframe's realm, where `instanceof Element` is false.
const isElement = (node: Node | null | undefined): node is Element => node?.nodeType === Node.ELEMENT_NODE

const style = (element: Element): CSSStyleDeclaration =>
  element.ownerDocument.defaultView!.getComputedStyle(element)

const nodeRects = (node: Node): DOMRect[] => {
  if (isElement(node)) return Array.from(node.getClientRects())
  const range = node.ownerDocument!.createRange()
  range.selectNodeContents(node)
  return Array.from(range.getClientRects())
}

const pages = (node: Node, pageOf: PageOf): [number, number] => {
  const rects = nodeRects(node).filter((rect) => rect.width || rect.height)
  return rects.length ? [pageOf(rects[0]), pageOf(rects[rects.length - 1])] : [-1, -1]
}

const isBlock = (element: Element): boolean => BLOCK_DISPLAYS.test(style(element).display)

const isAtomic = (element: Element): boolean =>
  REPLACED.has(element.tagName.toUpperCase()) || ATOMIC_INLINE.test(style(element).display)

// Laid-out content of a container, skipping whitespace-only text between blocks.
const contentNodes = (container: Element): Node[] =>
  Array.from(container.childNodes).filter(
    (node) =>
      isElement(node) ||
      (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '')
  )

const pathOf = (root: Element, node: Node): number[] => {
  const path: number[] = []
  for (let current = node; current !== root; current = current.parentNode!) {
    path.unshift(Array.prototype.indexOf.call(current.parentNode!.childNodes, current))
  }
  return path
}

// First character of `text` drawn on `page` or later.
const splitText = (text: Text, page: number, pageOf: PageOf): number | null => {
  const range = text.ownerDocument.createRange()
  const pageAt = (index: number): number => {
    for (let i = index; i < text.length; i++) {
      range.setStart(text, i)
      range.setEnd(text, i + 1)
      const rect = Array.from(range.getClientRects()).find((r) => r.width || r.height)
      if (rect) return pageOf(rect)
    }
    return Infinity
  }
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (pageAt(middle) >= page) high = middle
    else low = middle + 1
  }
  return low < text.length ? low : null
}

interface Point {
  node: Node
  offset: number | null
}

// The page boundary falls inside a box that is never cut, so it is taller than
// a page: print slices it where the preview did, without a forced break.
const UNCUT = 'uncut'

/** Where `page` begins among `nodes`, searching from index `from`; `index` is the node it lies in. */
const locate = (
  nodes: Node[],
  page: number,
  pageOf: PageOf,
  from = 0
): { index: number; point: Point | typeof UNCUT } | null => {
  for (let index = from; index < nodes.length; index++) {
    const node = nodes[index]
    const [first, last] = pages(node, pageOf)
    if (first >= page) return { index, point: { node, offset: null } }
    if (last < page) continue
    // The page boundary falls inside this node.
    if (node.nodeType === Node.TEXT_NODE) {
      const offset = splitText(node as Text, page, pageOf)
      if (offset !== null) return { index, point: { node, offset } }
      continue
    }
    const element = node as Element
    // Atomic boxes and table rows (`break-inside: avoid`) are not cut.
    if (isAtomic(element) || element.tagName === 'TR') return { index, point: UNCUT }
    const inner = locate(contentNodes(element), page, pageOf)
    if (inner) return { index, point: inner.point }
  }
  return null
}

const countAdjoiningMargins = (element: Element): number => {
  let count = 0
  for (let current: Element | null = element; current && isBlock(current); current = current.firstElementChild) {
    count++
    const computed = style(current)
    if (parseFloat(computed.paddingBlockStart) || parseFloat(computed.borderBlockStartWidth)) break
  }
  return count
}

const FORCED_BREAK = /^(always|page|column|left|right|recto|verso)$/

/**
 * Where pages 2…`count` begin. `pageOf` maps a client rect to its 0-based page.
 * The content must stay laid out and unchanged until the result is used.
 */
export const findPageStarts = (root: Element, count: number, pageOf: PageOf): PageStart[] => {
  const starts: PageStart[] = []
  const blocks = contentNodes(root)
  let from = 0
  for (let page = 1; page < count; page++) {
    // Pages begin in document order, so each search resumes in the block the previous page began in.
    const found = locate(blocks, page, pageOf, from)
    if (!found) break
    from = found.index
    if (found.point === UNCUT) continue
    const point = found.point
    const path = pathOf(root, point.node)
    let lineBlock: Element | null = null
    if (point.offset !== null || !isElement(point.node) || !isBlock(point.node)) {
      lineBlock = point.node.parentElement
      while (lineBlock && lineBlock !== root && !isBlock(lineBlock)) lineBlock = lineBlock.parentElement
    }
    // Margins after a forced break are kept, in the preview and in print alike.
    const truncates = isElement(point.node) && !lineBlock && !FORCED_BREAK.test(style(point.node).breakBefore)
    starts.push({
      path,
      offset: point.offset,
      lineBlockDepth: lineBlock && lineBlock !== root ? pathOf(root, lineBlock).length : 0,
      justify: !!lineBlock && style(lineBlock).textAlign === 'justify',
      adjoiningMargins: truncates ? countAdjoiningMargins(point.node as Element) : 0
    })
  }
  return starts
}

const resolve = (root: Element, path: number[]): Node => {
  let node: Node = root
  for (const index of path) node = node.childNodes[index]
  return node
}

const important = (element: Element, styles: Record<string, string>): void => {
  for (const [name, value] of Object.entries(styles)) {
    ;(element as HTMLElement).style.setProperty(name, value, 'important')
  }
}

const sliced = (side: 'start' | 'end') => ({
  [`margin-block-${side}`]: '0',
  [`padding-block-${side}`]: '0',
  [`border-block-${side}-width`]: '0'
})

const truncateMargins = (element: Element, count: number): void => {
  let current: Element | null = element
  for (let i = 0; i < count && current; i++, current = current.firstElementChild) {
    important(current, { 'margin-block-start': '0' })
  }
}

const listItems = (list: Element): Element[] => Array.from(list.children).filter((child) => child.tagName === 'LI')

const listIndex = (item: Element): number => listItems(item.parentElement!).indexOf(item)

// HTML's rules for parsing integers, as for `start` and `value`.
const integerAttribute = (element: Element, name: string): number | null => {
  const number = parseInt(element.getAttribute(name) ?? '', 10)
  return Number.isNaN(number) ? null : number
}

// The number an ordered list shows for its item at `index` (one past the end
// is the number the next item would get), following `reversed` and `value`.
const itemNumber = (list: Element, index: number): number => {
  const items = listItems(list)
  const step = list.hasAttribute('reversed') ? -1 : 1
  let number = integerAttribute(list, 'start') ?? (step < 0 ? items.length : 1)
  for (let i = 0; i <= index; i++) {
    const value = items[i] ? integerAttribute(items[i], 'value') : null
    if (value !== null) number = value
    if (i < index) number += step
  }
  return number
}

/**
 * Turns every preview page start into a forced page break in `root`: a fresh
 * parse of the same content the preview laid out, so paths resolve identically.
 */
export const applyPageStarts = (root: Element, starts: PageStart[]): void => {
  // Later starts first: a split never moves content before its own point.
  for (const start of [...starts].reverse()) {
    const node = resolve(root, start.path)
    const top = resolve(root, start.path.slice(0, 1))
    if (!node || !isElement(top)) continue
    if (node === top) {
      top.classList.add('mt-page-start')
      truncateMargins(top, start.adjoiningMargins)
      continue
    }

    // Ancestors cut in two, outermost first; each continues on the next page.
    const cut: Element[] = []
    for (let current = node.parentElement; current && current !== root; current = current.parentElement) {
      cut.unshift(current)
    }
    // Ordered lists keep their numbering: the continued item keeps its number.
    const listStarts = cut.map((element, depth) => {
      if (element.tagName !== 'OL') return null
      const child = cut[depth + 1] ?? node
      const index = isElement(child) && child.tagName === 'LI' ? listIndex(child) : listItems(element).length
      // A reversed list counts down from its own length unless it says otherwise,
      // and the first half is shorter.
      if (element.hasAttribute('reversed') && integerAttribute(element, 'start') === null) {
        element.setAttribute('start', String(listItems(element).length))
      }
      return itemNumber(element, index)
    })

    const range = root.ownerDocument.createRange()
    if (start.offset === null) range.setStartBefore(node)
    else range.setStart(node, start.offset)
    range.setEndAfter(top)
    top.after(range.extractContents())

    // Walk both halves of every cut ancestor; the cut runs along the last child
    // of the first half and the first child of the second.
    const originals: Element[] = []
    const copies: Element[] = []
    let original: Element | null = top
    let copy: Element | null = top.nextElementSibling
    for (let depth = 0; depth < cut.length && original && copy; depth++) {
      originals.push(original)
      copies.push(copy)
      original = original.lastElementChild
      copy = copy.firstElementChild
    }
    copies[0].classList.add('mt-page-start')
    originals.forEach((element) => important(element, sliced('end')))
    copies.forEach((element, depth) => {
      // Sliced boxes draw no edge at the cut, and its margin adjoins the break.
      important(element, sliced('start'))
      if (element.tagName === 'LI') important(element, { 'list-style-type': 'none' })
      const listStart = listStarts[depth]
      if (listStart !== null) element.setAttribute('start', String(listStart))
    })
    if (start.lineBlockDepth) {
      const depth = start.lineBlockDepth - 1
      if (copies[depth]) important(copies[depth], { 'text-indent': '0' })
      if (start.justify && originals[depth]) important(originals[depth], { 'text-align-last': 'justify' })
    } else if (isElement(node)) {
      truncateMargins(node, start.adjoiningMargins)
    }
  }
}
