<template>
  <section
    class="print-preview"
    :aria-label="t('printPreview.title')"
    :data-pages="pageCount || undefined"
    :data-ready="ready || undefined"
  >
    <div class="preview-toolbar">
      <div class="page-navigation">
        <button
          :aria-label="t('printPreview.previous')"
          :disabled="!ready || currentPage <= 1"
          @click="goToPage(currentPage - 1)"
        >
          <el-icon><ArrowLeft /></el-icon>
        </button>
        <label class="page-counter">
          <span class="sr-only">{{ t('printPreview.page') }}</span>
          <input
            :value="currentPage"
            type="number"
            min="1"
            :max="pageCount"
            :disabled="!ready"
            @change="enterPage($event.target as HTMLInputElement)"
          >
          <span>/ {{ pageCount || '—' }}</span>
        </label>
        <button
          :aria-label="t('printPreview.next')"
          :disabled="!ready || currentPage >= pageCount"
          @click="goToPage(currentPage + 1)"
        >
          <el-icon><ArrowRight /></el-icon>
        </button>
      </div>
      <span
        class="preview-status"
        role="status"
        aria-live="polite"
      >{{ statusText }}</span>
      <label class="preview-zoom">
        <span class="sr-only">{{ t('printPreview.zoom') }}</span>
        <select
          v-model="zoom"
          :aria-label="t('printPreview.zoom')"
        >
          <option value="width">{{ t('printPreview.fitWidth') }}</option>
          <option value="page">{{ t('printPreview.fit') }}</option>
          <option
            v-for="value in [50, 75, 100, 125, 150, 200]"
            :key="value"
            :value="String(value)"
          >
            {{ value }}%
          </option>
        </select>
      </label>
    </div>
    <div
      ref="viewport"
      class="preview-viewport"
      :aria-busy="!ready"
      tabindex="0"
      @scroll.passive="trackPage"
      @keydown.left.prevent="goToPage(currentPage - 1)"
      @keydown.right.prevent="goToPage(currentPage + 1)"
      @keydown.page-up.prevent="goToPage(currentPage - 1)"
      @keydown.page-down.prevent="goToPage(currentPage + 1)"
    >
      <div
        v-if="error"
        class="preview-message"
        role="alert"
      >
        <el-icon><Warning /></el-icon>
        <h4>{{ t('printPreview.failed') }}</h4>
        <p>{{ error }}</p>
        <button @click="reload">
          {{ t('printPreview.retry') }}
        </button>
      </div>
      <!-- Never display:none: an iframe that is not rendered has no viewport,
           and laying the document out there finds a single empty page. -->
      <div
        class="preview-canvas"
        :class="{ stale: updating, concealed: !geometry || !!error }"
        :style="canvasStyle"
      >
        <iframe
          ref="frame"
          class="preview-frame"
          sandbox="allow-same-origin"
          tabindex="-1"
          :title="t('printPreview.title')"
          :style="frameStyle"
        />
      </div>
      <div
        v-if="!geometry && !error"
        class="preview-loading"
      >
        {{ t('printPreview.generating') }}
      </div>
    </div>
    <div class="preview-caption">
      <span>{{ layoutCaption }}</span>
      <span v-if="pageCount">{{ pageSummary }}</span>
    </div>
    <template v-if="mode === 'print'">
      <div class="print-destination">
        <label>
          <span>{{ t('printPreview.printer') }}</span>
          <select
            v-model="device"
            :disabled="working"
            :aria-label="t('printPreview.printer')"
          >
            <option
              v-if="!printers.length"
              value=""
            >{{ t('printPreview.noPrinter') }}</option>
            <option
              v-for="printer in printers"
              :key="printer.name"
              :value="printer.name"
            >
              {{ printer.displayName || printer.name }}
            </option>
          </select>
        </label>
        <label class="copies">
          <span>{{ t('printPreview.copies') }}</span>
          <input
            v-model.number="copies"
            type="number"
            min="1"
            max="99"
            :disabled="working"
            :aria-label="t('printPreview.copies')"
          >
        </label>
        <button
          class="refresh-printers"
          :disabled="working"
          :aria-label="t('printPreview.refreshPrinters')"
          @click="loadPrinters"
        >
          <el-icon><Refresh /></el-icon>
        </button>
      </div>
      <p class="print-note">
        {{ t('printPreview.note') }}
      </p>
    </template>
    <p
      v-if="actionMessage"
      class="action-message"
      role="status"
    >
      {{ actionMessage }}
    </p>
    <div class="preview-actions">
      <button
        :disabled="working && job !== 'preparing'"
        @click="cancel"
      >
        {{ t('printPreview.cancel') }}
      </button>
      <div>
        <button
          :class="{ 'button-primary': mode === 'pdf' }"
          :disabled="!ready || working || updating"
          @click="save"
        >
          {{ job === 'saving' ? t('printPreview.generatingPdf') : t('printPreview.savePdf') }}
        </button>
        <button
          v-if="mode === 'print'"
          class="button-primary"
          :disabled="!ready || working || updating || !device || !validCopies"
          @click="print"
        >
          {{ printLabel }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ArrowLeft, ArrowRight, Refresh, Warning } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import bus from '@/bus'
import { useEditorStore } from '@/store/editor'
import { getPrintLayout, type PreviewRequest } from '@/services/printService'
import { getCssForOptions, type PdfCssOptions } from '@/util/pdf'
import {
  PrintPreviewFrame,
  SHEET_GAP,
  type PreviewGeometry,
  type PreviewSettings
} from '@/printPreview/paginator'
import type { PageChrome, PrintStyleOptions } from '@/printPreview/printCss'
import type { PrintDevice, PrintLayout, PrintOutcome } from '@shared/types/print'
import { PRINT_DPI } from '@shared/types/print'

GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps<{
  options: Record<string, unknown>
  title: string
  /** `pdf` exports a file; `print` also offers printers. */
  mode: 'print' | 'pdf'
}>()
const emit = defineEmits<{ busy: [value: boolean]; close: []; printed: [] }>()
const { t, locale } = useI18n()
const invoke = window.electron.ipcRenderer.invoke

// Space around the sheets inside the viewport, CSS px.
const CANVAS_PADDING = 24
// Pause after the last edit before the preview is laid out again.
const UPDATE_DELAY_MS = 120
// Pause after the preview settles before the PDF is generated in the background.
const OUTPUT_DELAY_MS = 900

interface Output {
  revision: number
  /** The main process session revision holding this PDF. */
  snapshot: number
  layout: PrintLayout
  pdf: PDFDocumentProxy
}

const viewport = ref<HTMLElement>()
const frame = ref<HTMLIFrameElement>()
const geometry = shallowRef<PreviewGeometry>()
const layout = shallowRef<PrintLayout>()
const currentPage = ref(1)
const zoom = ref('width')
const viewportWidth = ref(600)
const viewportHeight = ref(500)
const updating = ref(false)
const error = ref('')
const actionMessage = ref('')
const printers = ref<PrintDevice[]>([])
const device = ref('')
const copies = ref(1)
const job = ref<'idle' | 'preparing' | 'printing' | 'saving'>('idle')
const stagedPage = ref(0)
// Pages in the PDF of the current layout, once it was generated.
const printedPages = ref(0)
const working = computed(() => job.value !== 'idle')
const ready = computed(() => !!geometry.value && !error.value)
const pageCount = computed(() => geometry.value?.pageCount ?? 0)
const validCopies = computed(
  () => Number.isInteger(copies.value) && copies.value >= 1 && copies.value <= 99
)

let session = ''
let disposed = false
let preview: PrintPreviewFrame | null = null
let contentKey = ''
// Bumped whenever the laid-out preview changes; an output belongs to one revision.
let revision = 0
let applying: Promise<void> | null = null
let applyAgain = false
let updatePending = false
let updateTimer: ReturnType<typeof setTimeout> | undefined
let outputTimer: ReturnType<typeof setTimeout> | undefined
let output: Output | null = null
let outputTask: { revision: number; promise: Promise<Output> } | null = null
let observer: ResizeObserver | undefined
let canceled = false

const scale = computed(() => {
  const value = geometry.value
  if (!value) return 1
  const fitWidth = (viewportWidth.value - 2 * CANVAS_PADDING) / value.width
  if (zoom.value === 'width') return Math.max(0.1, fitWidth)
  if (zoom.value === 'page') {
    const sheetHeight = value.pitch - SHEET_GAP
    return Math.max(0.1, Math.min(fitWidth, (viewportHeight.value - 2 * CANVAS_PADDING) / sheetHeight))
  }
  return Number(zoom.value) / 100
})
const canvasStyle = computed(() => {
  const value = geometry.value
  if (!value) return {}
  return {
    width: `${value.width * scale.value}px`,
    height: `${value.height * scale.value}px`,
    margin: `${CANVAS_PADDING}px auto`
  }
})
const frameStyle = computed(() => {
  const value = geometry.value
  if (!value) return { width: '800px', height: '800px' }
  return {
    width: `${value.width * value.density}px`,
    height: `${value.height * value.density}px`,
    transform: `scale(${scale.value / value.density})`
  }
})
const pageSummary = computed(() =>
  printedPages.value && printedPages.value !== pageCount.value
    ? t('printPreview.paginationDiffers', { actual: printedPages.value, expected: pageCount.value })
    : t('printPreview.totalPages', { count: pageCount.value })
)
const layoutCaption = computed(() =>
  layout.value ? `${layout.value.width} × ${layout.value.height} mm` : ''
)
const statusText = computed(() => {
  if (error.value) return ''
  if (!geometry.value) return t('printPreview.generating')
  return updating.value ? t('printPreview.updating') : ''
})
const printLabel = computed(() =>
  job.value === 'preparing'
    ? stagedPage.value
      ? t('printPreview.preparing', { page: stagedPage.value, count: pageCount.value })
      : t('printPreview.generatingPdf')
    : job.value === 'printing'
      ? t('printPreview.printing')
      : t('printPreview.print')
)

const goToPage = (page: number) => {
  if (!ready.value || !viewport.value || !Number.isFinite(page)) return
  const target = Math.max(1, Math.min(pageCount.value, Math.round(page)))
  currentPage.value = target
  viewport.value.scrollTop = CANVAS_PADDING + (target - 1) * geometry.value!.pitch * scale.value
}

// The field keeps what was typed when the page it clamps to is already current.
const enterPage = (input: HTMLInputElement) => {
  goToPage(Number(input.value))
  input.value = String(currentPage.value)
}

const trackPage = () => {
  const value = geometry.value
  if (!value || !viewport.value) return
  const middle = viewport.value.scrollTop - CANVAS_PADDING + viewport.value.clientHeight / 2
  currentPage.value = Math.max(1, Math.min(value.pageCount, Math.floor(middle / (value.pitch * scale.value)) + 1))
}

// Keep the page in view when the sheets are magnified or re-laid out.
watch(scale, async () => {
  const page = currentPage.value
  await nextTick()
  goToPage(page)
})

const requestHtml = (options: Record<string, unknown>) =>
  new Promise<string>((resolve, reject) => {
    bus.emit('prepare-print-preview', { options, resolve, reject } satisfies PreviewRequest)
  })

const formatDate = () =>
  new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date())

const previewSettings = async (options: Record<string, unknown>): Promise<PreviewSettings> => {
  let printLayout: PrintLayout
  try {
    printLayout = getPrintLayout(options)
  } catch {
    throw new Error(t('printPreview.invalidLayout'))
  }
  const texts = (value: unknown): [string, string, string] => {
    const list = Array.isArray(value) ? value : []
    return [0, 1, 2].map((i) => (typeof list[i] === 'string' ? list[i] : '')) as [string, string, string]
  }
  const chrome: PageChrome = {
    header: texts(options.header),
    footer: texts(options.footer),
    fontSize: Number(options.headerFooterFontSize) || 11,
    ruled: options.headerFooterStyled === true,
    title: props.title.replace(/\.(md|markdown|txt)$/i, ''),
    date: formatDate()
  }
  return {
    layout: printLayout,
    css: await getCssForOptions(options as PdfCssOptions),
    style: options as PrintStyleOptions,
    chrome
  }
}

// One layout pass at a time; edits arriving meanwhile are folded into one more.
const apply = async (): Promise<void> => {
  if (applying) {
    applyAgain = true
    return applying
  }
  applying = (async () => {
    do {
      if (disposed) return
      applyAgain = false
      updatePending = false
      const options = { ...props.options }
      updating.value = true
      try {
        // Let the status paint before the synchronous layout.
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)))
        const settings = await previewSettings(options)
        if (disposed) return
        const key = JSON.stringify([options.tocTitle, options.tocIncludeTopHeading])
        if (key !== contentKey || !preview) {
          const html = await requestHtml(options)
          if (disposed) return
          preview = new PrintPreviewFrame(frame.value!)
          await preview.load(html)
          contentKey = key
        }
        const page = currentPage.value
        const next = await preview.update(settings)
        if (disposed) return
        revision++
        printedPages.value = 0
        layout.value = settings.layout
        geometry.value = next
        error.value = ''
        await nextTick()
        goToPage(Math.min(page, next.pageCount))
        if (!updatePending && !applyAgain) scheduleOutput()
      } catch (err) {
        if (!disposed) error.value = (err as Error).message
      } finally {
        // An edit made meanwhile is still waiting for its own pass.
        updating.value = updatePending || applyAgain
      }
    } while (applyAgain)
  })()
  try {
    await applying
  } finally {
    applying = null
  }
}

const scheduleUpdate = () => {
  actionMessage.value = ''
  // Marked stale at once: actions must not use the layout being replaced.
  updatePending = true
  updating.value = true
  clearTimeout(updateTimer)
  clearTimeout(outputTimer)
  updateTimer = setTimeout(apply, UPDATE_DELAY_MS)
}
watch(() => props.options, scheduleUpdate, { deep: true })

const reload = () => {
  contentKey = ''
  error.value = ''
  scheduleUpdate()
}

const scheduleOutput = () => {
  clearTimeout(outputTimer)
  outputTimer = setTimeout(() => {
    if (!working.value && !updating.value) ensureOutput().catch(() => {})
  }, OUTPUT_DELAY_MS)
}

/** The PDF of the current preview, generated once per revision and verified. */
const ensureOutput = (): Promise<Output> => {
  if (output?.revision === revision) return Promise.resolve(output)
  if (outputTask?.revision === revision) return outputTask.promise
  const target = revision
  const printLayout = layout.value!
  const expected = geometry.value!.pageCount
  const promise = (async () => {
    const html = preview!.buildPrintDocument()
    const result = await invoke('mt::print-preview::render', session, html, printLayout)
    const pdf = await getDocument({ data: result.pdf.slice(), isEvalSupported: false }).promise
    if (disposed || target !== revision) {
      await pdf.destroy()
      throw new Error(t('printPreview.outdated'))
    }
    // Every preview page start is a forced break, so a page that did not fit
    // in print shows up as an extra page. The PDF is still usable.
    if (pdf.numPages !== expected) console.warn(`Print preview showed ${expected} pages, the PDF has ${pdf.numPages}`)
    printedPages.value = pdf.numPages
    // Owned before anything else is awaited, so closing the dialog meanwhile releases it.
    const previous = output
    const current = { revision: target, snapshot: result.revision, layout: printLayout, pdf }
    output = current
    await previous?.pdf.destroy()
    return current
  })()
  outputTask = { revision: target, promise }
  promise.catch(() => {}).finally(() => {
    if (outputTask?.promise === promise) outputTask = null
  })
  return promise
}

const loadPrinters = async () => {
  try {
    printers.value = await invoke('mt::print-preview::printers')
    if (!printers.value.some((printer) => printer.name === device.value)) {
      device.value = printers.value[0]?.name || ''
    }
  } catch (err) {
    actionMessage.value = (err as Error).message
  }
}

const showOutcome = (result: PrintOutcome, savePdf: boolean) => {
  actionMessage.value =
    result.status === 'error'
      ? result.error
      : result.status === 'canceled'
        ? t('printPreview.canceled')
        : t(savePdf ? 'printPreview.saved' : 'printPreview.sent')
  if (result.status === 'success' && !savePdf) emit('printed')
}

const save = async () => {
  if (!ready.value || working.value) return
  job.value = 'saving'
  actionMessage.value = ''
  let exported = false
  try {
    const { snapshot } = await ensureOutput()
    const { currentFile, documentTitle } = useEditorStore()
    const result = await invoke('mt::print-preview::save', session, snapshot, {
      pathname: currentFile?.pathname || null,
      title: documentTitle
    })
    showOutcome(result, true)
    exported = result.status === 'success' && props.mode === 'pdf'
  } catch (err) {
    actionMessage.value = (err as Error).message
  } finally {
    job.value = 'idle'
  }
  // An export is done once the file is written; the export notice links to it.
  if (exported) emit('close')
}

const cancel = () => {
  if (job.value === 'preparing') canceled = true
  else if (!working.value) emit('close')
}

const print = async () => {
  if (!ready.value || !validCopies.value || working.value) return
  canceled = false
  job.value = 'preparing'
  stagedPage.value = 0
  actionMessage.value = ''
  try {
    const { pdf, snapshot } = await ensureOutput()
    for (let number = 1; number <= pdf.numPages; number++) {
      if (canceled || disposed) break
      stagedPage.value = number
      const page = await pdf.getPage(number)
      const view = page.getViewport({ scale: PRINT_DPI / 72 })
      const sheet = document.createElement('canvas')
      sheet.width = Math.ceil(view.width)
      sheet.height = Math.ceil(view.height)
      await page.render({ canvas: sheet, viewport: view, intent: 'print' }).promise
      const blob = await new Promise<Blob>((resolve, reject) =>
        sheet.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Could not render print page'))),
          'image/png'
        )
      )
      sheet.width = sheet.height = 0
      if (canceled || disposed) break
      await invoke('mt::print-preview::page', session, snapshot, {
        number,
        png: new Uint8Array(await blob.arrayBuffer())
      })
    }
    if (canceled || disposed) {
      actionMessage.value = t('printPreview.canceled')
      return
    }
    job.value = 'printing'
    showOutcome(
      await invoke('mt::print-preview::print', session, snapshot, device.value, copies.value, pdf.numPages),
      false
    )
  } catch (err) {
    actionMessage.value = (err as Error).message
  } finally {
    job.value = 'idle'
    stagedPage.value = 0
  }
}

watch(working, (value) => emit('busy', value))
// Print export can be chosen while the PDF export preview is open.
watch(
  () => props.mode,
  (mode) => {
    if (mode === 'print' && !printers.value.length) loadPrinters()
  }
)

onMounted(async () => {
  observer = new ResizeObserver(([entry]) => {
    viewportWidth.value = entry.contentRect.width
    viewportHeight.value = entry.contentRect.height
  })
  if (viewport.value) observer.observe(viewport.value)
  if (props.mode === 'print') loadPrinters()
  try {
    session = await invoke('mt::print-preview::open')
    if (disposed) {
      await invoke('mt::print-preview::close', session)
      return
    }
    await apply()
  } catch (err) {
    error.value = (err as Error).message
  }
})
onBeforeUnmount(() => {
  disposed = true
  canceled = true
  clearTimeout(updateTimer)
  clearTimeout(outputTimer)
  observer?.disconnect()
  output?.pdf.destroy().catch(() => {})
  if (session) invoke('mt::print-preview::close', session).catch(() => {})
})
</script>

<style scoped>
.print-preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  color: var(--editorColor);
}
.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 0 12px;
}
.page-navigation {
  display: flex;
  gap: 8px;
  align-items: center;
}
.preview-status {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--editorColor60);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.page-navigation button,
.refresh-printers {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
}
.print-preview button,
.print-preview input,
.print-preview select {
  font: inherit;
  font-size: 13px;
  border-radius: 5px;
}
.print-preview button {
  min-height: 32px;
  padding: 6px 12px;
  background: var(--buttonBgColor);
  color: var(--buttonFontColor);
  border: var(--buttonBorder);
}
.print-preview button:hover:not(:disabled) {
  background: var(--buttonBgColorHover);
}
.print-preview button.button-primary {
  color: white;
  background: oklch(from var(--buttonPrimaryBgColor) min(l, 0.5) c h);
  border: var(--buttonPrimaryBorder);
}
.print-preview button.button-primary:hover:not(:disabled) {
  background: oklch(from var(--buttonPrimaryBgColor) min(l, 0.46) c h);
}
.print-preview input,
.print-preview select {
  color: var(--editorColor);
  background: var(--inputBgColor);
  border: 1px solid var(--editorColor10);
  padding: 6px 8px;
  min-width: 0;
}
.print-preview input:focus-visible,
.print-preview select:focus-visible,
.print-preview button:focus-visible,
.preview-viewport:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: 2px;
}
.page-counter {
  display: flex;
  align-items: center;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}
.page-counter input {
  width: 52px;
  text-align: center;
}
.preview-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--editorColor04);
  border-radius: 6px;
  scrollbar-color: var(--editorColor30) transparent;
  scrollbar-width: thin;
}
.preview-canvas {
  position: relative;
  transition: opacity 0.12s ease-out;
}
/* Still the previous layout while the next one is computed. */
.preview-canvas.stale {
  opacity: 0.75;
}
.preview-canvas.concealed {
  visibility: hidden;
}
.preview-frame {
  position: absolute;
  top: 0;
  left: 0;
  border: 0;
  background: transparent;
  transform-origin: 0 0;
  pointer-events: none;
}
.preview-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--editorColor60);
  font-size: 14px;
}
.preview-caption {
  display: flex;
  justify-content: space-between;
  padding: 10px 0 14px;
  color: var(--editorColor60);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.print-destination {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.print-destination label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
.print-destination .copies {
  flex: 0 0 64px;
}
.print-destination .refresh-printers {
  padding: 0;
}
.print-note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--editorColor60);
  margin: 12px 0;
}
.preview-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 4px;
}
.preview-actions > div {
  display: flex;
  gap: 8px;
}
.print-preview button:disabled {
  opacity: 0.5;
  cursor: default;
}
.preview-message {
  position: absolute;
  inset: 48px 0 auto;
  z-index: 1;
  max-width: 360px;
  margin: 0 auto;
  text-align: center;
}
.preview-message h4 {
  margin: 12px 0 8px;
  font-size: 16px;
}
.preview-message p {
  overflow-wrap: anywhere;
  user-select: text;
  font-size: 13px;
  line-height: 1.6;
}
.action-message {
  margin: 0 0 12px;
  font-size: 13px;
  overflow-wrap: anywhere;
  user-select: text;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
