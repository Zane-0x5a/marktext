import './editorCamera.css'

const MIN_SCALE = 0.25
const MAX_SCALE = 4

/**
 * A document camera with native scrolling. The layout plane keeps its original
 * width; only its DOM drawing is scaled. The clipped stage supplies the scaled
 * scroll extent, including when the document is smaller than its layout box.
 * The caller owns the document node and must destroy the camera before it.
 */
export class EditorCamera {
  private readonly stage = document.createElement('div')
  private readonly plane = document.createElement('div')
  private readonly observer: ResizeObserver
  private currentScale = 1
  private targetScale = 1
  private frame: number | null = null
  private anchorX = 0
  private anchorY = 0
  private width = 0
  private height = 0
  private contentWidth = 0
  private contentHeight = 0

  constructor(
    private readonly viewport: HTMLElement,
    private readonly content: HTMLElement,
    private readonly onGesture?: () => void
  ) {
    this.stage.className = 'editor-camera-stage'
    this.plane.className = 'editor-camera-plane'
    viewport.classList.add('editor-camera-viewport')
    content.before(this.stage)
    this.stage.append(this.plane)
    this.plane.append(content)
    this.refresh()
    this.observer = new ResizeObserver(() => this.refresh())
    this.observer.observe(viewport)
    this.observer.observe(this.plane)
    viewport.addEventListener('wheel', this.handleWheel, { passive: false, capture: true })
  }

  get scale(): number {
    return this.currentScale
  }

  /** Refresh after a synchronous content replacement, before restoring scroll. */
  refresh(): void {
    const style = getComputedStyle(this.viewport)
    const width = this.viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const height = this.viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    // Hidden editors (source mode) retain their last usable layout dimensions.
    if (width <= 0 || height <= 0) return
    if (width !== this.width || height !== this.height) {
      this.width = width
      this.height = height
      this.plane.style.width = `${width}px`
      this.plane.style.minHeight = `${height}px`
    }
    this.contentWidth = Math.max(width, this.plane.scrollWidth)
    this.contentHeight = this.plane.offsetHeight
    this.draw()
  }

  /** Cancel queued gesture work and return to 100%, retaining logical scroll. */
  reset(): void {
    this.cancelFrame()
    const top = this.viewport.scrollTop / this.currentScale
    this.currentScale = this.targetScale = 1
    this.draw()
    this.viewport.scrollLeft = 0
    this.viewport.scrollTop = top
  }

  destroy(): void {
    this.reset()
    this.observer.disconnect()
    this.viewport.removeEventListener('wheel', this.handleWheel, true)
    this.stage.before(this.content)
    this.stage.remove()
    this.viewport.classList.remove('editor-camera-viewport')
    delete this.viewport.dataset.editorScale
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    // Chromium translates precision-touchpad pinch into Ctrl+wheel. Ordinary
    // two-finger scrolling and all editor pointer/selection events stay native.
    if (!event.ctrlKey) return
    event.preventDefault()
    event.stopPropagation()
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.height : 1
    this.targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE,
      this.targetScale * Math.exp(-event.deltaY * unit * 0.01)))
    this.anchorX = event.clientX
    this.anchorY = event.clientY
    if (this.frame !== null) return
    this.onGesture?.()
    this.frame = requestAnimationFrame(this.applyZoom)
  }

  private readonly applyZoom = (): void => {
    this.frame = null
    if (this.targetScale === this.currentScale) return
    const rect = this.viewport.getBoundingClientRect()
    const style = getComputedStyle(this.viewport)
    const x = this.anchorX - rect.left - this.viewport.clientLeft - parseFloat(style.paddingLeft)
    const y = this.anchorY - rect.top - this.viewport.clientTop - parseFloat(style.paddingTop)
    const offset = this.horizontalOffset()
    const rtl = style.direction === 'rtl'
    const scrollX = this.viewport.scrollLeft + (rtl ? this.viewport.scrollWidth - this.viewport.clientWidth : 0)
    const documentX = (scrollX + x - offset) / this.currentScale
    const documentY = (this.viewport.scrollTop + y) / this.currentScale
    this.currentScale = this.targetScale
    this.draw()
    const nextScrollX = documentX * this.currentScale + this.horizontalOffset() - x
    this.viewport.scrollLeft = nextScrollX - (rtl ? this.viewport.scrollWidth - this.viewport.clientWidth : 0)
    this.viewport.scrollTop = documentY * this.currentScale - y
  }

  private horizontalOffset(): number {
    return Math.max(0, (this.width - this.contentWidth * this.currentScale) / 2)
  }

  private draw(): void {
    this.stage.style.width = `${Math.max(this.width, this.contentWidth * this.currentScale)}px`
    this.stage.style.height = `${this.contentHeight * this.currentScale}px`
    // A 2D transform lets Chromium rasterize text/SVG at the current scale.
    // Promoting the entire document with will-change/translate3d would stretch
    // cached pixels and allocate a potentially enormous layer for long files.
    this.plane.style.transform = `translateX(${this.horizontalOffset()}px) scale(${this.currentScale})`
    this.viewport.dataset.editorScale = String(this.currentScale)
  }

  private cancelFrame(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
  }
}
