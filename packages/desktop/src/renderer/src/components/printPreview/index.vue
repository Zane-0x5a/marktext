<template>
  <section
    class="print-preview"
    :aria-label="t('printPreview.title')"
    :data-revision="snapshot?.revision"
  >
    <div class="preview-toolbar">
      <div class="page-navigation">
        <button
          :aria-label="t('printPreview.previous')"
          :disabled="!ready || currentPage <= 1"
          @click="currentPage--"
        >
          <el-icon><ArrowLeft /></el-icon>
        </button>
        <label class="page-counter">
          <span class="sr-only">{{ t('printPreview.page') }}</span>
          <input
            v-model.number="currentPage"
            type="number"
            min="1"
            :max="pageCount"
            :disabled="!ready"
            @change="clampPage"
          >
          <span>/ {{ pageCount || '—' }}</span>
        </label>
        <button
          :aria-label="t('printPreview.next')"
          :disabled="!ready || currentPage >= pageCount"
          @click="currentPage++"
        >
          <el-icon><ArrowRight /></el-icon>
        </button>
      </div>
      <label class="preview-zoom">
        <span class="sr-only">{{ t('printPreview.zoom') }}</span>
        <select
          v-model="zoom"
          :aria-label="t('printPreview.zoom')"
        >
          <option value="fit">{{ t('printPreview.fit') }}</option>
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
      :aria-busy="loading"
      tabindex="0"
      @keydown.left.prevent="previousPage"
      @keydown.right.prevent="nextPage"
    >
      <div
        v-if="error"
        class="preview-message"
        role="alert"
      >
        <el-icon><Warning /></el-icon>
        <h4>{{ t('printPreview.failed') }}</h4>
        <p>{{ error }}</p>
        <button @click="refresh">
          {{ t('printPreview.retry') }}
        </button>
      </div>
      <div
        v-else
        class="page-sheet"
        :class="{ pending: loading }"
        :style="sheetStyle"
      >
        <canvas
          ref="canvas"
          :aria-label="t('printPreview.pageLabel', { page: currentPage })"
        />
        <div
          v-if="loading"
          class="page-loading"
          role="status"
        >
          {{ t('printPreview.generating') }}
        </div>
      </div>
    </div>
    <div
      class="preview-caption"
      aria-live="polite"
    >
      {{ snapshot ? `${snapshot.layout.width} × ${snapshot.layout.height} mm` : '' }}
      <span v-if="pageCount">{{ t('printPreview.totalPages', { count: pageCount }) }}</span>
    </div>
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
          :disabled="!ready || working"
          @click="save"
        >
          {{ t('printPreview.savePdf') }}
        </button>
        <button
          class="button-primary"
          :disabled="!ready || working || !device || !validCopies"
          @click="print"
        >
          {{
            job === 'preparing'
              ? t('printPreview.preparing', { page: stagedPage, count: pageCount })
              : job === 'printing'
                ? t('printPreview.printing')
                : t('printPreview.print')
          }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { ArrowLeft, ArrowRight, Refresh, Warning } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import bus from '@/bus'
import { getPrintLayout, type PreviewRequest } from '@/services/printService'
import type { PrintSnapshot, PrintDevice, PrintOutcome } from '@shared/types/print'

GlobalWorkerOptions.workerSrc = workerUrl

const props = defineProps<{ options: Record<string, unknown>; title: string }>()
const emit = defineEmits<{ busy: [value: boolean]; close: []; printed: [] }>()
const { t } = useI18n()
const invoke = window.electron.ipcRenderer.invoke
const viewport = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const snapshot = ref<PrintSnapshot>()
const pageCount = ref(0)
const currentPage = ref(1)
const zoom = ref('fit')
const availableWidth = ref(600)
const availableHeight = ref(500)
const loading = ref(true)
const ready = ref(false)
const error = ref('')
const actionMessage = ref('')
const printers = ref<PrintDevice[]>([])
const device = ref('')
const copies = ref(1)
const job = ref<'idle' | 'preparing' | 'printing' | 'saving'>('idle')
const stagedPage = ref(0)
const working = computed(() => job.value !== 'idle')
const validCopies = computed(
  () => Number.isInteger(copies.value) && copies.value >= 1 && copies.value <= 99
)
let id = ''
let disposed = false
let sequence = 0
let generating = false
let pending = false
let timer: ReturnType<typeof setTimeout> | undefined
let pdf: PDFDocumentProxy | undefined
let renderTask: RenderTask | undefined
let drawSequence = 0
let observer: ResizeObserver | undefined
let resizeFrame = 0
let canceled = false

const displayScale = computed(() => {
  const layout = snapshot.value?.layout
  if (!layout) return 0.7
  return zoom.value === 'fit'
    ? Math.min(
      (availableWidth.value - 56) / ((layout.width * 96) / 25.4),
      (availableHeight.value - 48) / ((layout.height * 96) / 25.4),
      1
    )
    : Number(zoom.value) / 100
})
const sheetStyle = computed(() => {
  const layout = snapshot.value?.layout || { width: 210, height: 297 }
  return {
    width: `${((layout.width * 96) / 25.4) * displayScale.value}px`,
    height: `${((layout.height * 96) / 25.4) * displayScale.value}px`
  }
})

const clampPage = () => {
  currentPage.value = Math.max(1, Math.min(pageCount.value, Math.round(currentPage.value || 1)))
}
const previousPage = () => {
  if (ready.value && currentPage.value > 1) currentPage.value--
}
const nextPage = () => {
  if (ready.value && currentPage.value < pageCount.value) currentPage.value++
}

const drawPage = async () => {
  if (!Number.isInteger(currentPage.value) || currentPage.value < 1 || currentPage.value > pageCount.value) return
  const ticket = ++drawSequence
  renderTask?.cancel()
  if (!pdf || !canvas.value || !ready.value || disposed) return
  const document = pdf
  try {
    const page = await document.getPage(currentPage.value)
    if (document !== pdf || disposed || ticket !== drawSequence) return
    const target = canvas.value
    const view = page.getViewport({
      scale: (96 / 72) * displayScale.value * Math.min(window.devicePixelRatio, 2)
    })
    target.width = Math.ceil(view.width)
    target.height = Math.ceil(view.height)
    renderTask = page.render({ canvas: target, viewport: view })
    await renderTask.promise
  } catch (err) {
    if ((err as Error).name !== 'RenderingCancelledException' && !disposed && ticket === drawSequence) { error.value = String((err as Error).message) }
  }
}

const generate = async () => {
  if (disposed || !id || generating) {
    pending = true
    return
  }
  generating = true
  pending = false
  ready.value = false
  loading.value = true
  const ticket = sequence
  const options = { ...props.options }
  try {
    let layout
    try {
      layout = getPrintLayout(options)
    } catch {
      throw new Error(t('printPreview.invalidLayout'))
    }
    const html = await new Promise<string>((resolve, reject) => {
      bus.emit('prepare-print-preview', { options, resolve, reject } satisfies PreviewRequest)
    })
    if (disposed || ticket !== sequence) return
    const result = await invoke('mt::print-preview::render', id, html, layout)
    if (disposed || ticket !== sequence) return
    renderTask?.cancel()
    await pdf?.destroy()
    pdf = await getDocument({ data: result.pdf.slice(), isEvalSupported: false }).promise
    if (disposed || ticket !== sequence) {
      await pdf.destroy()
      pdf = undefined
      return
    }
    snapshot.value = result
    pageCount.value = pdf.numPages
    clampPage()
    error.value = ''
    ready.value = true
    loading.value = false
    await nextTick()
    await drawPage()
  } catch (err) {
    if (!disposed && ticket === sequence) {
      error.value = (err as Error).message
      loading.value = false
    }
  } finally {
    generating = false
    if (pending && !disposed && !timer) generate()
  }
}

const refresh = () => {
  sequence++
  ready.value = false
  loading.value = true
  error.value = ''
  actionMessage.value = ''
  pending = true
  clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    generate()
  }, 250)
}
watch(() => props.options, refresh, { deep: true, flush: 'sync' })
watch([currentPage, displayScale], () => {
  drawPage()
})
watch(working, (value) => emit('busy', value))

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
  if (!ready.value || !snapshot.value || working.value) return
  job.value = 'saving'
  try {
    showOutcome(
      await invoke('mt::print-preview::save', id, snapshot.value.revision, props.title),
      true
    )
  } catch (err) {
    actionMessage.value = (err as Error).message
  } finally {
    job.value = 'idle'
  }
}

const cancel = () => {
  if (job.value === 'preparing') canceled = true
  else if (!working.value) emit('close')
}

const print = async () => {
  if (!ready.value || !snapshot.value || !pdf || !validCopies.value || working.value) return
  const revision = snapshot.value.revision
  canceled = false
  job.value = 'preparing'
  actionMessage.value = ''
  try {
    for (let number = 1; number <= pageCount.value; number++) {
      if (canceled || disposed) break
      stagedPage.value = number
      const page = await pdf.getPage(number)
      const view = page.getViewport({ scale: 300 / 72 })
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
      await invoke('mt::print-preview::page', id, revision, {
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
      await invoke(
        'mt::print-preview::print',
        id,
        revision,
        device.value,
        copies.value,
        pageCount.value
      ),
      false
    )
  } catch (err) {
    actionMessage.value = (err as Error).message
  } finally {
    job.value = 'idle'
  }
}

onMounted(async () => {
  observer = new ResizeObserver(([entry]) => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      if (disposed) return
      availableWidth.value = entry.contentRect.width
      availableHeight.value = entry.contentRect.height
    })
  })
  if (viewport.value) observer.observe(viewport.value)
  loadPrinters()
  try {
    id = await invoke('mt::print-preview::open')
    if (disposed) {
      await invoke('mt::print-preview::close', id)
      return
    }
    await generate()
  } catch (err) {
    error.value = (err as Error).message
    loading.value = false
  }
})
onBeforeUnmount(() => {
  disposed = true
  canceled = true
  sequence++
  clearTimeout(timer)
  observer?.disconnect()
  cancelAnimationFrame(resizeFrame)
  renderTask?.cancel()
  pdf?.destroy().catch(() => {})
  if (id) invoke('mt::print-preview::close', id).catch(() => {})
})
</script>

<style scoped>
.print-preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  color: var(--editorColor);
}
.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 12px;
}
.page-navigation {
  display: flex;
  gap: 8px;
  align-items: center;
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
  width: 48px;
  text-align: center;
}
.preview-viewport {
  flex: 1;
  min-height: 180px;
  overflow: auto;
  background: var(--editorColor04);
  border-radius: 6px;
  padding: 24px;
  scrollbar-color: var(--editorColor30) transparent;
  scrollbar-width: thin;
}
.page-sheet {
  margin: 0 auto;
  background: white;
  box-shadow: 0 3px 18px rgba(0, 0, 0, 0.14);
  position: relative;
  flex-shrink: 0;
}
.page-sheet canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.page-sheet.pending canvas {
  opacity: 0.3;
}
.page-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #4d4d4d;
  font-size: 14px;
}
.preview-caption {
  display: flex;
  justify-content: space-between;
  padding: 10px 0 16px;
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
  max-width: 360px;
  margin: 48px auto;
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
