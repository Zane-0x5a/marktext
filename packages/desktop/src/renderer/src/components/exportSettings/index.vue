<template>
  <div class="print-settings-dialog">
    <el-dialog
      v-model="showExportSettingsDialog"
      :show-close="isPrintPreview"
      :modal="true"
      :class="{ 'print-preview-dialog': isPrintPreview }"
      :width="isPrintPreview ? 'min(1120px, calc(100vw - 48px))' : '500px'"
      :close-on-click-modal="!isPrintPreview"
      :before-close="beforeClose"
      @closed="previewBusy = false"
    >
      <h3>{{ t(isPrintPreview ? 'printPreview.title' : 'exportSettings.title') }}</h3>
      <p
        v-if="isPrintPreview"
        class="preview-document-name"
      >
        {{ documentTitle }}
      </p>
      <div :class="{ 'print-preview-layout': isPrintPreview }">
        <div
          class="export-options"
          :inert="previewBusy"
        >
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
              <!-- HTML -->
              <div v-if="!isPrintable">
                <text-box
                  :description="t('exportSettings.page.pageTitle')"
                  :input="htmlTitle"
                  :emit-time="0"
                  :on-change="(value: unknown) => onSelectChange('htmlTitle', value)"
                />
              </div>

              <!-- PDF/Print -->
              <div v-if="isPrintable">
                <div>
                  <cur-select
                    class="page-size-select"
                    :description="t('exportSettings.page.pageSize')"
                    :value="pageSize"
                    :options="pageSizeList"
                    :on-change="(value: unknown) => onSelectChange('pageSize', value)"
                  />
                  <div
                    v-if="pageSize === 'custom'"
                    class="row"
                  >
                    <div>{{ t('exportSettings.page.widthHeight') }}</div>
                    <el-input-number
                      v-model="pageSizeWidth"
                      size="mini"
                      controls-position="right"
                      :min="100"
                      :max="1000"
                    />
                    <el-input-number
                      v-model="pageSizeHeight"
                      size="mini"
                      controls-position="right"
                      :min="100"
                      :max="1000"
                    />
                  </div>

                  <bool
                    :description="t('exportSettings.page.landscapeOrientation')"
                    :bool="isLandscape"
                    :on-change="(value: unknown) => onSelectChange('isLandscape', value)"
                  />
                </div>

                <div class="row">
                  <div class="description">
                    {{ t('exportSettings.page.pageMargin') }}
                  </div>
                  <div>
                    <div class="label">
                      {{ t('exportSettings.page.topBottom') }}
                    </div>
                    <el-input-number
                      v-model="pageMarginTop"
                      size="mini"
                      controls-position="right"
                      :min="0"
                      :max="100"
                    />
                    <el-input-number
                      v-model="pageMarginBottom"
                      size="mini"
                      controls-position="right"
                      :min="0"
                      :max="100"
                    />
                  </div>
                  <div>
                    <div class="label">
                      {{ t('exportSettings.page.leftRight') }}
                    </div>
                    <el-input-number
                      v-model="pageMarginLeft"
                      size="mini"
                      controls-position="right"
                      :min="0"
                      :max="100"
                    />
                    <el-input-number
                      v-model="pageMarginRight"
                      size="mini"
                      controls-position="right"
                      :min="0"
                      :max="100"
                    />
                  </div>
                </div>
              </div>
            </el-tab-pane>
            <el-tab-pane
              :label="t('exportSettings.style.label')"
              name="style"
            >
              <bool
                :description="t('exportSettings.style.overwriteThemeFont')"
                :bool="fontSettingsOverwrite"
                :on-change="(value: unknown) => onSelectChange('fontSettingsOverwrite', value)"
              />
              <div v-if="fontSettingsOverwrite">
                <font-text-box
                  :description="t('exportSettings.style.fontFamily')"
                  :value="fontFamily"
                  :on-change="(value: unknown) => onSelectChange('fontFamily', value)"
                />
                <range
                  :description="t('exportSettings.style.fontSize')"
                  :value="fontSize"
                  :min="8"
                  :max="32"
                  unit="px"
                  :step="1"
                  :on-change="(value: unknown) => onSelectChange('fontSize', value)"
                />
                <range
                  :description="t('exportSettings.style.lineHeight')"
                  :value="lineHeight"
                  :min="1.0"
                  :max="2.0"
                  :step="0.1"
                  :on-change="(value: unknown) => onSelectChange('lineHeight', value)"
                />
              </div>
              <bool
                :description="t('exportSettings.autoNumberingHeadings')"
                :bool="autoNumberingHeadings"
                :on-change="(value: unknown) => onSelectChange('autoNumberingHeadings', value)"
              />
              <bool
                :description="t('exportSettings.showFrontMatter')"
                :bool="showFrontMatter"
                :on-change="(value: unknown) => onSelectChange('showFrontMatter', value)"
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
                :value="theme"
                :options="themeList"
                :on-change="(value: unknown) => onSelectChange('theme', value)"
              />
            </el-tab-pane>
            <el-tab-pane
              v-if="isPrintable"
              :label="t('exportSettings.headerFooter.label')"
              name="header"
            >
              <div class="text">
                {{ t('exportSettings.headerFooter.description') }}
              </div>
              <cur-select
                :description="t('exportSettings.headerFooter.headerType')"
                :value="headerType"
                :options="headerFooterTypes"
                :on-change="(value: unknown) => onSelectChange('headerType', value)"
              />
              <text-box
                v-if="headerType === 2"
                :description="t('exportSettings.headerFooter.leftHeaderText')"
                :input="headerTextLeft"
                :emit-time="0"
                :on-change="(value: unknown) => onSelectChange('headerTextLeft', value)"
              />
              <text-box
                v-if="headerType !== 0"
                :description="t('exportSettings.headerFooter.mainHeaderText')"
                :input="headerTextCenter"
                :emit-time="0"
                :on-change="(value: unknown) => onSelectChange('headerTextCenter', value)"
              />
              <text-box
                v-if="headerType === 2"
                :description="t('exportSettings.headerFooter.rightHeaderText')"
                :input="headerTextRight"
                :emit-time="0"
                :on-change="(value: unknown) => onSelectChange('headerTextRight', value)"
              />

              <cur-select
                :description="t('exportSettings.headerFooter.footerType')"
                :value="footerType"
                :options="headerFooterTypes"
                :on-change="(value: unknown) => onSelectChange('footerType', value)"
              />
              <text-box
                v-if="footerType === 2"
                :description="t('exportSettings.headerFooter.leftFooterText')"
                :input="footerTextLeft"
                :emit-time="0"
                :on-change="(value: unknown) => onSelectChange('footerTextLeft', value)"
              />
              <text-box
                v-if="footerType !== 0"
                :description="t('exportSettings.headerFooter.mainFooterText')"
                :input="footerTextCenter"
                :emit-time="0"
                :on-change="(value: unknown) => onSelectChange('footerTextCenter', value)"
              />
              <text-box
                v-if="footerType === 2"
                :description="t('exportSettings.headerFooter.rightFooterText')"
                :input="footerTextRight"
                :emit-time="0"
                :on-change="(value: unknown) => onSelectChange('footerTextRight', value)"
              />

              <bool
                :description="t('exportSettings.headerFooter.customizeStyle')"
                :bool="headerFooterCustomize"
                :on-change="(value: unknown) => onSelectChange('headerFooterCustomize', value)"
              />

              <div v-if="headerFooterCustomize">
                <bool
                  :description="t('exportSettings.headerFooter.allowStyled')"
                  :bool="headerFooterStyled"
                  :on-change="(value: unknown) => onSelectChange('headerFooterStyled', value)"
                />
                <range
                  :description="t('exportSettings.headerFooter.fontSize')"
                  :value="headerFooterFontSize"
                  :min="8"
                  :max="20"
                  unit="px"
                  :step="1"
                  :on-change="(value: unknown) => onSelectChange('headerFooterFontSize', value)"
                />
              </div>
            </el-tab-pane>

            <el-tab-pane
              :label="t('exportSettings.toc.label')"
              name="toc"
            >
              <bool
                :description="t('exportSettings.toc.includeTopHeading')"
                :detailed-description="t('exportSettings.toc.includeTopHeadingDetail')"
                :bool="tocIncludeTopHeading"
                :on-change="(value: unknown) => onSelectChange('tocIncludeTopHeading', value)"
              />
              <text-box
                :description="t('exportSettings.toc.title')"
                :input="tocTitle"
                :emit-time="0"
                :on-change="(value: unknown) => onSelectChange('tocTitle', value)"
              />
            </el-tab-pane>
          </el-tabs>
          <div
            v-if="!isPrintPreview"
            class="button-controlls"
          >
            <button
              class="button-primary"
              @click="handleClicked"
            >
              {{ t('exportSettings.export') }}
            </button>
          </div>
        </div>
        <print-preview
          v-if="isPrintPreview && showExportSettingsDialog"
          :options="previewOptions"
          :title="documentTitle"
          @busy="previewBusy = $event"
          @close="closePreview"
          @printed="printComplete"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  type Ref
} from 'vue'
import bus from '../../bus'
import { loadExportSettings, saveExportSettings } from './persistence'
import Bool from '@/prefComponents/common/bool/index.vue'
import CurSelect from '@/prefComponents/common/select/index.vue'
import FontTextBox from '@/prefComponents/common/fontTextBox/index.vue'
import Range from '@/prefComponents/common/range/index.vue'
import TextBox from '@/prefComponents/common/textBox/index.vue'
import { getPageSizeList, getHeaderFooterTypes, getExportThemeList } from './exportOptions'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/store/editor'
import notice from '@/services/notification'

const { t } = useI18n()
const PrintPreview = defineAsyncComponent(() => import('@/components/printPreview/index.vue'))

const exportType = ref('')
const isPrintPreview = computed(() => exportType.value === 'print')
const previewBusy = ref(false)
const documentTitle = ref('')
const editorStore = useEditorStore()
const themesLoaded = ref(false)
const isPrintable = ref(true)
const showExportSettingsDialog = ref(false)
const activeName = ref('info')
const htmlTitle = ref('')
const pageSize = ref('A4')
const pageSizeWidth = ref(210)
const pageSizeHeight = ref(297)
const isLandscape = ref(false)
const pageMarginTop = ref(20)
const pageMarginRight = ref(15)
const pageMarginBottom = ref(20)
const pageMarginLeft = ref(15)
const fontSettingsOverwrite = ref(false)
const fontFamily = ref('Default')
const fontSize = ref(14)
const lineHeight = ref(1.5)
const autoNumberingHeadings = ref(false)
const showFrontMatter = ref(false)
const theme = ref('default')
const themeList = ref(getExportThemeList())
const pageSizeList = ref(getPageSizeList())
const headerFooterTypes = ref(getHeaderFooterTypes())
const headerType = ref(0)
const headerTextLeft = ref('')
const headerTextCenter = ref('')
const headerTextRight = ref('')
const footerType = ref(0)
const footerTextLeft = ref('')
const footerTextCenter = ref('')
const footerTextRight = ref('')
const headerFooterCustomize = ref(false)
const headerFooterStyled = ref(true)
const headerFooterFontSize = ref(12)
const tocTitle = ref('')
const tocIncludeTopHeading = ref(true)

// #2287 — persist the chosen export options across sessions. Every option ref
// is registered here; changes are saved to localStorage and restored on mount.
const persistableSettings: Record<string, Ref<unknown>> = {
  htmlTitle,
  pageSize,
  pageSizeWidth,
  pageSizeHeight,
  isLandscape,
  pageMarginTop,
  pageMarginRight,
  pageMarginBottom,
  pageMarginLeft,
  fontSettingsOverwrite,
  fontFamily,
  fontSize,
  lineHeight,
  autoNumberingHeadings,
  showFrontMatter,
  theme,
  headerType,
  headerTextLeft,
  headerTextCenter,
  headerTextRight,
  footerType,
  footerTextLeft,
  footerTextCenter,
  footerTextRight,
  headerFooterCustomize,
  headerFooterStyled,
  headerFooterFontSize,
  tocTitle,
  tocIncludeTopHeading
}

const restoreExportSettings = () => {
  const saved = loadExportSettings()
  for (const [key, settingRef] of Object.entries(persistableSettings)) {
    if (key in saved) settingRef.value = saved[key]
  }
}

watch(Object.values(persistableSettings), () => {
  saveExportSettings(
    Object.fromEntries(
      Object.entries(persistableSettings).map(([key, settingRef]) => [key, settingRef.value])
    )
  )
})

onMounted(() => {
  restoreExportSettings()
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
  headerFooterTypes.value = getHeaderFooterTypes()
}

const showDialog = (type: unknown) => {
  if (previewBusy.value) return
  const exportTypeValue = String(type ?? '')
  exportType.value = exportTypeValue
  documentTitle.value = editorStore.currentFile?.filename || 'Untitled'
  if (isPrintPreview.value) activeName.value = 'page'
  isPrintable.value = exportTypeValue !== 'styledHtml'
  if (!isPrintable.value && (activeName.value === 'header' || activeName.value === 'page')) {
    activeName.value = 'info'
  }

  showExportSettingsDialog.value = true
  bus.emit('editor-blur')

  if (!themesLoaded.value) {
    themesLoaded.value = true
    loadThemesFromDisk()
  }
}

const buildOptions = () => {
  const options: Record<string, unknown> = {
    type: exportType.value,
    pageSize: pageSize.value,
    pageSizeWidth: pageSizeWidth.value,
    pageSizeHeight: pageSizeHeight.value,
    isLandscape: isLandscape.value,
    pageMarginTop: pageMarginTop.value,
    pageMarginRight: pageMarginRight.value,
    pageMarginBottom: pageMarginBottom.value,
    pageMarginLeft: pageMarginLeft.value,
    autoNumberingHeadings: autoNumberingHeadings.value,
    showFrontMatter: showFrontMatter.value,
    theme: theme.value === 'default' ? null : theme.value,
    tocTitle: tocTitle.value,
    tocIncludeTopHeading: tocIncludeTopHeading.value
  }

  if (!isPrintable.value) {
    options.htmlTitle = htmlTitle.value
  }

  if (fontSettingsOverwrite.value) {
    Object.assign(options, {
      fontSize: fontSize.value,
      lineHeight: lineHeight.value,
      fontFamily: fontFamily.value === 'Default' ? null : fontFamily.value
    })
  }

  if (headerType.value !== 0) {
    Object.assign(options, {
      header: {
        type: headerType.value,
        left: headerTextLeft.value,
        center: headerTextCenter.value,
        right: headerTextRight.value
      }
    })
  }

  if (footerType.value !== 0) {
    Object.assign(options, {
      footer: {
        type: footerType.value,
        left: footerTextLeft.value,
        center: footerTextCenter.value,
        right: footerTextRight.value
      }
    })
  }

  if (headerFooterCustomize.value) {
    Object.assign(options, {
      headerFooterStyled: headerFooterStyled.value,
      headerFooterFontSize: headerFooterFontSize.value
    })
  }

  return options
}

const previewOptions = computed(buildOptions)
const handleClicked = () => {
  showExportSettingsDialog.value = false
  bus.emit('export', buildOptions())
}
const beforeClose = (done: () => void) => {
  if (!previewBusy.value) done()
}
const closePreview = () => {
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

const onSelectChange = (key: string, value: unknown) => {
  const state: Record<string, Ref<unknown>> = {
    htmlTitle,
    pageSize,
    isLandscape,
    fontSettingsOverwrite,
    fontFamily,
    fontSize,
    lineHeight,
    autoNumberingHeadings,
    showFrontMatter,
    theme,
    headerType,
    headerTextLeft,
    headerTextCenter,
    headerTextRight,
    footerType,
    footerTextLeft,
    footerTextCenter,
    footerTextRight,
    headerFooterCustomize,
    headerFooterStyled,
    headerFooterFontSize,
    tocIncludeTopHeading,
    tocTitle
  }
  if (key in state) {
    state[key]!.value = value
  }
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
.row {
  margin-bottom: 8px;
}
.description {
  margin-bottom: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}
.label {
  margin-bottom: 5px;
}
.label ~ div {
  margin-right: 20px;
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
.print-settings-dialog #pane-header .pref-text-box-item .el-input {
  width: 90% !important;
}

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
  margin: 6px 0 20px;
  color: var(--editorColor60);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.print-preview-layout {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 28px;
  height: calc(100vh - 180px);
  max-height: 750px;
  min-height: 400px;
}
.print-preview-layout .export-options {
  min-width: 0;
  overflow: auto;
  padding-right: 4px;
}
.print-preview-layout .el-tabs__content {
  max-height: none;
}
.print-preview-layout .row .el-input-number {
  width: 124px;
  margin-right: 8px;
}
.print-preview-layout .el-tabs__item {
  font-size: 13px;
  padding: 0 10px;
}
.print-preview-layout .pref-select-item .el-select {
  width: 100%;
}
.print-preview-layout .pref-select-item {
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 850px) {
  .print-preview-layout {
    grid-template-columns: 260px minmax(0, 1fr);
    gap: 16px;
  }
  .print-preview-layout .row .el-input-number {
    width: 108px;
  }
}
@media (max-width: 700px) {
  .print-preview-layout {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
    max-height: none;
    min-height: 0;
  }
  .print-preview-layout .export-options { max-height: 220px; }
  .print-preview-layout .print-preview { height: 560px; }
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
