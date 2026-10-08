<template>
  <div class="print-settings-dialog">
    <el-dialog
      v-model="showExportSettingsDialog"
      :show-close="isPreview"
      :modal="true"
      :class="{ 'print-preview-dialog': isPreview }"
      :width="isPreview ? 'min(1240px, calc(100vw - 48px))' : '500px'"
      :close-on-click-modal="!isPreview"
      :before-close="beforeClose"
      @closed="previewBusy = false"
    >
      <template v-if="isPreview">
        <div class="preview-heading">
          <h3>{{ t(exportType === 'pdf' ? 'printPreview.exportTitle' : 'printPreview.title') }}</h3>
          <p class="preview-document-name">
            {{ documentTitle }}
          </p>
        </div>
        <div class="print-preview-layout">
          <div
            class="export-options"
            :inert="previewBusy"
          >
            <settings-panel
              :settings="settings"
              :page-sizes="pageSizeList"
              :themes="themeList"
            />
          </div>
          <print-preview
            v-if="showExportSettingsDialog"
            :options="previewOptions"
            :title="documentTitle"
            :mode="exportType === 'pdf' ? 'pdf' : 'print'"
            @busy="previewBusy = $event"
            @close="closePreview"
            @printed="printComplete"
          />
        </div>
      </template>
      <template v-else>
        <h3>{{ t('exportSettings.title') }}</h3>
        <el-tabs v-model="activeName">
          <el-tab-pane
            :label="t('exportSettings.info.label')"
            name="info"
          >
            <span class="text">{{ t('exportSettings.info.description') }}</span>
          </el-tab-pane>
          <el-tab-pane
            :label="t('exportSettings.page.label')"
            name="page"
          >
            <text-box
              :description="t('exportSettings.page.pageTitle')"
              :input="settings.htmlTitle"
              :emit-time="0"
              :on-change="(value: string) => (settings.htmlTitle = value)"
            />
          </el-tab-pane>
          <el-tab-pane
            :label="t('exportSettings.style.label')"
            name="style"
          >
            <bool
              :description="t('exportSettings.style.overwriteThemeFont')"
              :bool="settings.fontSettingsOverwrite"
              :on-change="(value: boolean) => (settings.fontSettingsOverwrite = value)"
            />
            <div v-if="settings.fontSettingsOverwrite">
              <font-text-box
                :description="t('exportSettings.style.fontFamily')"
                :value="settings.fontFamily"
                :on-change="(value: string) => (settings.fontFamily = value)"
              />
              <range
                :description="t('exportSettings.style.fontSize')"
                :value="settings.fontSize"
                :min="8"
                :max="32"
                unit="px"
                :step="1"
                :on-change="(value: number) => (settings.fontSize = value)"
              />
              <range
                :description="t('exportSettings.style.lineHeight')"
                :value="settings.lineHeight"
                :min="1.0"
                :max="2.0"
                :step="0.1"
                :on-change="(value: number) => (settings.lineHeight = value)"
              />
            </div>
            <bool
              :description="t('exportSettings.autoNumberingHeadings')"
              :bool="settings.autoNumberingHeadings"
              :on-change="(value: boolean) => (settings.autoNumberingHeadings = value)"
            />
            <bool
              :description="t('exportSettings.showFrontMatter')"
              :bool="settings.showFrontMatter"
              :on-change="(value: boolean) => (settings.showFrontMatter = value)"
            />
          </el-tab-pane>
          <el-tab-pane
            :label="t('exportSettings.theme.label')"
            name="theme"
          >
            <div class="text">
              {{ t('exportSettings.theme.description') }}
            </div>
            <cur-select
              :description="t('exportSettings.theme.theme')"
              more="https://marktext.me/docs/export-themes"
              :value="settings.theme"
              :options="themeList"
              :on-change="(value: unknown) => (settings.theme = String(value))"
            />
          </el-tab-pane>
          <el-tab-pane
            :label="t('exportSettings.toc.label')"
            name="toc"
          >
            <bool
              :description="t('exportSettings.toc.includeTopHeading')"
              :detailed-description="t('exportSettings.toc.includeTopHeadingDetail')"
              :bool="settings.tocIncludeTopHeading"
              :on-change="(value: boolean) => (settings.tocIncludeTopHeading = value)"
            />
            <text-box
              :description="t('exportSettings.toc.title')"
              :input="settings.tocTitle"
              :emit-time="0"
              :on-change="(value: string) => (settings.tocTitle = value)"
            />
          </el-tab-pane>
        </el-tabs>
        <div class="button-controlls">
          <button
            class="button-primary"
            @click="handleClicked"
          >
            {{ t('exportSettings.export') }}
          </button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, reactive, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import bus from '../../bus'
import { loadExportSettings, saveExportSettings } from './persistence'
import { createExportSettings, restoreExportSettings, toExportOptions } from './state'
import Bool from '@/prefComponents/common/bool/index.vue'
import CurSelect from '@/prefComponents/common/select/index.vue'
import FontTextBox from '@/prefComponents/common/fontTextBox/index.vue'
import Range from '@/prefComponents/common/range/index.vue'
import TextBox from '@/prefComponents/common/textBox/index.vue'
import SettingsPanel from '@/components/printPreview/settingsPanel.vue'
import { getPageSizeList, getExportThemeList } from './exportOptions'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/store/editor'
import notice from '@/services/notification'

const { t } = useI18n()
const PrintPreview = defineAsyncComponent(() => import('@/components/printPreview/index.vue'))

const exportType = ref('')
// PDF export and printing share the paged preview, so a saved PDF has exactly
// the pages shown.
const isPreview = computed(() => exportType.value === 'print' || exportType.value === 'pdf')
const previewBusy = ref(false)
const documentTitle = ref('')
const editorStore = useEditorStore()
const themesLoaded = ref(false)
const showExportSettingsDialog = ref(false)
const activeName = ref('info')
const themeList = ref(getExportThemeList())
const pageSizeList = ref(getPageSizeList())
const settings = reactive(createExportSettings())

// #2287 — persist the chosen export options across sessions.
watch(settings, () => saveExportSettings({ ...settings }), { deep: true })

onMounted(() => {
  restoreExportSettings(settings, loadExportSettings())
  bus.on('showExportDialog', showDialog)
  bus.on('language-changed', updateTranslations)
})

onBeforeUnmount(() => {
  bus.off('showExportDialog', showDialog)
  bus.off('language-changed', updateTranslations)
})

const updateTranslations = () => {
  themeList.value = getExportThemeList()
  pageSizeList.value = getPageSizeList()
}

const showDialog = (type: unknown) => {
  if (previewBusy.value) return
  exportType.value = String(type ?? '')
  documentTitle.value = editorStore.currentFile?.filename || 'Untitled'
  showExportSettingsDialog.value = true
  bus.emit('editor-blur')

  if (!themesLoaded.value) {
    themesLoaded.value = true
    loadThemesFromDisk()
  }
}

const previewOptions = computed(() => toExportOptions(settings, exportType.value))
const handleClicked = () => {
  showExportSettingsDialog.value = false
  bus.emit('export', toExportOptions(settings, exportType.value))
}
const beforeClose = (done: () => void) => {
  if (!previewBusy.value) done()
}
const closePreview = () => {
  // The preview only asks to close once its job is over.
  previewBusy.value = false
  showExportSettingsDialog.value = false
}
const printComplete = () => {
  previewBusy.value = false
  showExportSettingsDialog.value = false
  notice.notify({
    title: t('printPreview.title'),
    type: 'primary',
    message: t('printPreview.sent')
  })
}

const loadThemesFromDisk = async () => {
  // marktext.paths is attached to `window` at runtime by bootstrap.ts but
  // isn't part of the typed contextBridge surface. Cast through `unknown`.
  const marktext = (window as unknown as { marktext?: { paths?: { userDataPath?: string } } })
    .marktext
  const userDataPath = marktext?.paths?.userDataPath
  if (!userDataPath) return
  const themeDir = window.path.join(userDataPath, 'themes/export')

  if (!(await window.fileUtils.isDirectory(themeDir))) return
  let filenames = []
  try {
    filenames = await window.fileUtils.readdir(themeDir)
  } catch {
    return
  }

  for (const filename of filenames) {
    const fullname = window.path.join(themeDir, filename)
    if (!/.+\.css$/i.test(filename)) continue
    if (!(await window.fileUtils.isFile(fullname))) continue
    try {
      const buf = await window.fileUtils.readFile(fullname)
      const content = buf instanceof Uint8Array ? new TextDecoder('utf-8').decode(buf) : String(buf)
      const match = content.match(/^(?:\/\*+[ \t]*([A-z0-9 -]+)[ \t]*(?:\*+\/|[\n\r])?)/)
      const label = match && match[1] ? match[1] : filename
      themeList.value.push({ value: filename, label })
    } catch (e) {
      console.error('loadThemesFromDisk failed:', e)
    }
  }
}
</script>

<style scoped>
.print-settings-dialog {
  user-select: none;
}
.text {
  white-space: pre-wrap;
  word-break: break-word;
}

.button-controlls {
  margin-top: 8px;
  text-align: right;
}

.button-controlls .button-primary {
  font-size: 14px;
}

.el-tab-pane section:first-child {
  margin-top: 0;
}
</style>
<style>
.print-settings-dialog .el-dialog__body {
  padding: 0 20px 20px 20px;
}
.print-settings-dialog .pref-select-item .el-select {
  width: 240px;
}
.print-settings-dialog .el-tabs__content {
  max-height: 350px;
  overflow-x: hidden;
  overflow-y: auto;
}

.print-settings-dialog .el-tabs__content::-webkit-scrollbar:vertical {
  width: 5px;
}

.print-preview-dialog {
  margin-top: 24px;
  margin-bottom: 24px;
}
.print-preview-dialog .el-dialog__body {
  padding: 0 24px 24px;
}
.print-preview-dialog h3 {
  margin: 0;
  color: var(--editorColor);
  font-size: 20px;
  font-weight: 600;
}
.preview-document-name {
  margin: 6px 0 18px;
  color: var(--editorColor60);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.print-preview-layout {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  /* A definite row: both panes scroll inside the dialog instead of growing it. */
  grid-template-rows: minmax(0, 1fr);
  gap: 28px;
  height: calc(100vh - 160px);
  min-height: 420px;
}
.print-preview-layout .export-options {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding-right: 8px;
  scrollbar-gutter: stable;
}
@media (max-width: 900px) {
  .print-preview-layout {
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 16px;
  }
}
@media (max-width: 700px) {
  .print-preview-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 240px minmax(0, 1fr);
  }
}

.el-input-number {
  & div {
    background: var(--inputBgColor);
  }
  & input {
    border: none !important;
  }
}
</style>
