# Paged print preview

Print and File › Export › PDF open the same dialog: settings on the left, the
document laid out as pages on the right. Changing a setting re-lays out the
preview in a fraction of a second; no PDF is generated for it. The PDF is made
from the preview's pages when it is saved or printed.

## Why not preview the PDF

Chromium's `printToPDF` is slow for real notes: a 36-page math document takes
3–4 s per PDF, and even a single page costs about 1.5 s (layout plus CJK font
subsetting). Regenerating it for every setting made the old preview take 8–12 s
per change.

## Layout

`PrintPreviewFrame` (`packages/desktop/src/renderer/src/printPreview/`) loads
the print document into a same-origin iframe (`sandbox="allow-same-origin"`,
no scripts) and lays its content out in CSS columns that are exactly one page's
content box. `column-wrap: wrap` stacks the columns as rows, one per sheet;
page sheets, running headers and footers are drawn behind them. Chromium's own
fragmentation decides every break.

The print styles target print media. The preview rewrites each media query to
what it evaluates to when printing (`print` → `all`, `screen` → `not all`).

Text is laid out at one device pixel per CSS pixel: the stage is zoomed by
`1 / devicePixelRatio` and the dialog magnifies the iframe back. Print layout
does not depend on the screen scale; at a fractional scale such as 175%, glyph
metrics round differently and a narrow table cell can wrap an extra line.

A preview page's content height is 1.2% (at least 6 px) shorter than the
paper's, because print layout can still come out a few pixels taller.

## From preview to print

The print document is not left to paginate on its own. `findPageStarts` reads
where each preview page begins; `applyPageStarts` replays those points on a
fresh parse of the same markup:

- a page that begins with a block gets a forced break before it. After an
  unforced break fragmentation truncates the block's top margins, so they are
  removed; after a forced one (a heading set to start a new page) both
  layouts keep them;
- a page that begins inside a block (a paragraph, a list item, a table) splits
  that block in two at the first line of the page. The halves draw no edge at
  the cut; a continued list item has no second marker and ordered lists keep
  their numbering; a continued paragraph gets no indent, and a justified line
  before the cut stays justified;
- a page that begins inside a box that is never cut (an image, a table row,
  which the print styles keep whole) means that box is taller than a page.
  Print slices it on its own, so that page gets no forced break. Images are
  limited to one page's height, also under the overall scale. A table row can
  still be taller: print fills each of its pages slightly more than the
  preview (the 1.2% above), so the PDF can come out a page shorter.

Table headers do not repeat on every page in either layout
(`thead { display: table-row-group }`): columns never reserve room for them.

Since every page start is forced, a page whose content did not fit in print
would show up as an extra page. The PDF is still saved or printed; the caption
under the preview then shows both page counts.

Save PDF suggests the document's folder and name, like the other exports; an
unsaved document is named after its first heading.

## Settings

Paper (presets or custom), orientation, margins (narrow, normal, wide or
custom), overall scale, code block and formula scale, custom font, size and
line height, block spacing, image width, starting each level-1 or level-2
heading on a new page, heading numbering, front matter, theme, contents title,
and running header and footer text. Header and footer text are `@page` margin
boxes; `{page}`, `{pages}`, `{title}` and `{date}` are replaced in each.

## Generating the PDF

When the preview has been still for about a second, the PDF is generated in the
background in a hidden worker window (`mt::print-preview::render`), so Save PDF
and Print usually start at once. Printing still sends 300 dpi page images of
that PDF, so a printer's font substitution cannot reflow it.

## Validation

```sh
pnpm -C packages/desktop exec playwright test test/e2e/print-preview.spec.ts test/e2e/export-pdf.spec.ts
pnpm -C packages/desktop exec vitest run test/unit/specs/print-page-breaks.spec.ts test/unit/specs/print-preview-css.spec.ts
```

The end-to-end tests compare each saved and printed page with the text of the
preview sheet it came from, across paper sizes, orientations, margins, scale,
fonts, themes, running text and source-mode edits.
