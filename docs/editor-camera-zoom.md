# Document camera zoom

Pinch with two fingers over the document to magnify or shrink it. Ctrl + wheel
uses the same path. Ordinary two-finger scrolling remains native. The range is
25–400%; switching files always restores 100%, including when returning to a
previous tab. Zoom also works in source mode.

The document retains its original column width, fonts, line breaks, spacing,
tables and formula layout. A CSS transform changes the document's drawing scale
inside the editor viewport. Text and SVG/formulas are rendered at the current
scale; embedded bitmap images retain their original image resolution. Menus,
tabs, the sidebar, search and floating editor tools retain their normal size.
Zoom does not change Markdown, font preferences or export output.

`EditorCamera` keeps a fixed-width layout plane inside a clipped stage with a
scaled scroll extent. Native scrolling and DOM hit-testing still handle editing
and selection. ResizeObserver tracks document edits and window resizing. Wheel
deltas are continuous and exponential; requestAnimationFrame coalesces input
into one camera update per frame. Scaling only updates the plane's transform,
the stage's extent and the native scroll position. It never rerenders the
document or serializes it. No permanent GPU layer is allocated for the entire
document, and no bitmap snapshot is used for text zoom.

The point under the gesture stays anchored while scroll bounds permit it.
When the drawing is narrower than the viewport it is centered. The viewport
reserves its vertical scrollbar gutter so new scrollbars cannot change wrapping.
Saved scroll positions use document coordinates rather than zoomed pixels.
Tab changes cancel pending animation frames before resetting the camera.
Electron's native visual pinch is disabled to prevent accidental window zoom.
Existing menu/keyboard commands for window zoom keep their existing behavior.

Validation uses the real Electron app:

```sh
pnpm build:unpack
pnpm -C packages/desktop exec playwright test test/e2e/editor-camera.spec.ts
```

The tests compare every document block and its line rectangles through zoom,
exercise enlarged-coordinate text editing, scrolling, source mode, scale limits
and tab-switch races, and report continuous-frame and event-burst measurements
on a 160-section document. Physical touchpad feel depends on the device and OS;
automated input exercises Chromium's Ctrl+wheel pinch event path.
