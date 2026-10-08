# Document virtualization

Opening or switching to a long document used to lay out and paint every block
before the first frame. A 37 KB math note with about 1,000 inline formulas
builds roughly 70,000 elements; switching to it took 2–3.5 s, most of it style
recalculation and layout of content far off screen.

`DocumentVirtualizer` (`packages/desktop/src/renderer/src/util/`) lets Chromium
skip off-screen top-level blocks with `content-visibility: auto`, so a switch
only lays out what is visible. It turns on when a document has at least 4,000
elements; smaller documents render as before.

## Which blocks are skipped

`content-visibility: auto` implies layout, style and paint containment. Layout
containment stops child margins from collapsing through a block, which moves
it. Only blocks whose content is inline, or already isolated from their edges,
are contained: paragraphs, headings, code blocks, front matter, thematic
breaks, tables, math and diagram blocks. Lists, quotes, footnotes and HTML
blocks always render. `overflow-clip-margin: 100vw` keeps the heading copy
link, code language input and other controls drawn outside a block visible.
The block being edited (`.mu-active`) is never contained: paint containment
would draw the next block over popups it shows below itself, such as the inline
math preview.

A block that has never been drawn uses an estimated height (`3em`); once drawn,
`contain-intrinsic-size: auto` remembers its real height.

## Keeping the reading position

The editor disables native scroll anchoring (`overflow-anchor: none`), so the
virtualizer compensates itself: a ResizeObserver watches top-level blocks, and
when blocks entirely above the viewport change height (an estimate replaced by
the real size, an image loading) it adjusts `scrollTop` before that frame is
painted. A skipped block across the viewport's top edge drew nothing there, so
its first real height is compensated too: what is shown starts below it.
Chromium reports such a block as shown only after the resize it causes, so the
`contentvisibilityautostatechange` events still mark it skipped at that point.
Heights are recorded when the content is replaced, so blocks drawn in the first
frame also count as a change. Removed blocks are no longer observed.

Each tab of a virtualized document stores a scroll anchor next to its
`scrollTop`: the top-level block at the viewport top and the offset into it, in
document pixels. Restoring scrolls that block back into place, which stays
exact while blocks above it are still estimates. The anchor block is drawn, and
its height recorded, before it is positioned: the offset was measured against
its real height. Other documents restore the pixel offset. Either position is
applied again as the document grows while it is still out of reach (a diagram
above it still shows its placeholder), until something else scrolls the
editor. A smooth scroll still running in the previous document is stopped.

When most blocks are re-created at once (a preference that re-renders the
document, a whole-document undo, replacing everything), the new blocks above
the viewport start as estimates again. The virtualizer then restores the
anchor of the last scroll position.

Smooth scrolls to outline headings, search results and in-document anchors
recompute their target every frame (`animatedScrollTo` accepts a function) and
re-apply it until it holds, since blocks passed on the way take their real
height. A target re-rendered meanwhile (search highlights are, on every find)
keeps its last position, and a new scroll on the editor supersedes a running one.

## Rendering work

Two engine costs were also removed from every content replacement:

- Every content block scanned the whole document for link reference
  definitions, deep-cloning the document state each time. The labels are now
  collected once per `JSONState.revision`.
- Display math is cached as KaTeX HTML, like inline math already was.

Tab switching also no longer toggles `visibility`/`pointer-events` on the
scroller: both are inherited, and each toggle restyled the whole document.

## Validation

```sh
pnpm -C packages/desktop exec playwright test test/e2e/document-virtualization.spec.ts
```

The test checks that every block's geometry matches an unvirtualized layout;
that a tab switch restores the exact reading position before blocks are
measured, also deep inside a tall block; that scrolling up through unmeasured
blocks keeps the visible text still; that replacing a block while typing or
re-rendering every block for a preference does not move the view; that the
inline math preview is drawn above the next block; that a far outline jump
right after a switch lands the heading at its usual offset, and a switch during
it leaves the other tab where it was; and that a short document returns to a
position below a diagram that first draws a placeholder.
