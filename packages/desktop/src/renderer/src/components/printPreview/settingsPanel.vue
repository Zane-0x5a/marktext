<template>
  <div class="print-settings">
    <section>
      <h4>{{ t('printPreview.settings.page') }}</h4>
      <div class="field">
        <label for="print-paper">{{ t('printPreview.settings.paper') }}</label>
        <el-select
          id="print-paper"
          v-model="settings.pageSize"
        >
          <el-option
            v-for="item in pageSizes"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </div>
      <div
        v-if="settings.pageSize === 'custom'"
        class="field pair"
      >
        <label>{{ t('printPreview.settings.paperSize') }}</label>
        <el-input-number
          v-model="settings.pageSizeWidth"
          :aria-label="t('printPreview.settings.width')"
          controls-position="right"
          :min="100"
          :max="1000"
        />
        <el-input-number
          v-model="settings.pageSizeHeight"
          :aria-label="t('printPreview.settings.height')"
          controls-position="right"
          :min="100"
          :max="1000"
        />
      </div>
      <div class="field">
        <label>{{ t('printPreview.settings.orientation') }}</label>
        <el-radio-group
          :aria-label="t('printPreview.settings.orientation')"
          v-model="settings.isLandscape"
          size="small"
        >
          <el-radio-button :value="false">
            {{ t('printPreview.settings.portrait') }}
          </el-radio-button>
          <el-radio-button :value="true">
            {{ t('printPreview.settings.landscape') }}
          </el-radio-button>
        </el-radio-group>
      </div>
      <div class="field">
        <label for="print-margins">{{ t('printPreview.settings.margins') }}</label>
        <el-select
          id="print-margins"
          :model-value="marginPreset"
          @update:model-value="setMarginPreset"
        >
          <el-option
            v-for="preset in marginPresets"
            :key="preset.value"
            :label="preset.label"
            :value="preset.value"
          />
        </el-select>
      </div>
      <div
        v-if="marginPreset === 'custom'"
        class="margins"
      >
        <label
          v-for="side in marginSides"
          :key="side.key"
        >
          <span>{{ side.label }}</span>
          <el-input-number
            v-model="settings[side.key]"
            :aria-label="side.label"
            controls-position="right"
            :min="0"
            :max="100"
          />
        </label>
      </div>
    </section>

    <section>
      <h4>{{ t('printPreview.settings.text') }}</h4>
      <div class="field slider">
        <label>{{ t('printPreview.settings.scale') }}</label>
        <el-slider
          :aria-label="t('printPreview.settings.scale')"
          v-model="settings.printScale"
          :min="50"
          :max="200"
          :step="5"
          :format-tooltip="percent"
        />
        <output>{{ settings.printScale }}%</output>
      </div>
      <div class="field slider">
        <label>{{ t('printPreview.settings.codeScale') }}</label>
        <el-slider
          :aria-label="t('printPreview.settings.codeScale')"
          v-model="settings.codeScale"
          :min="50"
          :max="200"
          :step="5"
          :format-tooltip="percent"
        />
        <output>{{ settings.codeScale }}%</output>
      </div>
      <div class="field slider">
        <label>{{ t('printPreview.settings.mathScale') }}</label>
        <el-slider
          :aria-label="t('printPreview.settings.mathScale')"
          v-model="settings.mathScale"
          :min="50"
          :max="200"
          :step="5"
          :format-tooltip="percent"
        />
        <output>{{ settings.mathScale }}%</output>
      </div>
      <div class="field toggle">
        <label for="print-font-overwrite">{{ t('printPreview.settings.customFont') }}</label>
        <el-switch
          id="print-font-overwrite"
          v-model="settings.fontSettingsOverwrite"
        />
      </div>
      <template v-if="settings.fontSettingsOverwrite">
        <font-text-box
          class="font-field"
          :description="t('exportSettings.style.fontFamily')"
          :value="settings.fontFamily"
          :on-change="(value: string) => (settings.fontFamily = value)"
        />
        <div class="field slider">
          <label>{{ t('printPreview.settings.fontSize') }}</label>
          <el-slider
            :aria-label="t('printPreview.settings.fontSize')"
            v-model="settings.fontSize"
            :min="8"
            :max="32"
            :format-tooltip="(value: number) => `${value}px`"
          />
          <output>{{ settings.fontSize }}px</output>
        </div>
        <div class="field slider">
          <label>{{ t('printPreview.settings.lineHeight') }}</label>
          <el-slider
            :aria-label="t('printPreview.settings.lineHeight')"
            v-model="settings.lineHeight"
            :min="1"
            :max="2.4"
            :step="0.1"
          />
          <output>{{ settings.lineHeight.toFixed(1) }}</output>
        </div>
      </template>
    </section>

    <section>
      <h4>{{ t('printPreview.settings.layout') }}</h4>
      <div class="field">
        <label>{{ t('printPreview.settings.spacing') }}</label>
        <el-radio-group
          :aria-label="t('printPreview.settings.spacing')"
          v-model="settings.blockSpacing"
          size="small"
        >
          <el-radio-button value="compact">
            {{ t('printPreview.settings.compact') }}
          </el-radio-button>
          <el-radio-button value="default">
            {{ t('printPreview.settings.normal') }}
          </el-radio-button>
          <el-radio-button value="relaxed">
            {{ t('printPreview.settings.relaxed') }}
          </el-radio-button>
        </el-radio-group>
      </div>
      <div class="field slider">
        <label>{{ t('printPreview.settings.imageWidth') }}</label>
        <el-slider
          :aria-label="t('printPreview.settings.imageWidth')"
          v-model="settings.imageMaxWidth"
          :min="20"
          :max="100"
          :step="5"
          :format-tooltip="percent"
        />
        <output>{{ settings.imageMaxWidth }}%</output>
      </div>
      <div class="field toggle">
        <label for="print-break-h1">{{ t('printPreview.settings.breakBeforeH1') }}</label>
        <el-switch
          id="print-break-h1"
          v-model="settings.breakBeforeH1"
        />
      </div>
      <div class="field toggle">
        <label for="print-break-h2">{{ t('printPreview.settings.breakBeforeH2') }}</label>
        <el-switch
          id="print-break-h2"
          v-model="settings.breakBeforeH2"
        />
      </div>
      <div class="field toggle">
        <label for="print-numbering">{{ t('exportSettings.autoNumberingHeadings') }}</label>
        <el-switch
          id="print-numbering"
          v-model="settings.autoNumberingHeadings"
        />
      </div>
      <div class="field toggle">
        <label for="print-front-matter">{{ t('exportSettings.showFrontMatter') }}</label>
        <el-switch
          id="print-front-matter"
          v-model="settings.showFrontMatter"
        />
      </div>
    </section>

    <section>
      <h4>{{ t('printPreview.settings.running') }}</h4>
      <div
        v-for="band in bands"
        :key="band.key"
        class="band"
      >
        <span class="band-name">{{ band.label }}</span>
        <div class="band-cells">
          <el-input
            v-for="part in parts"
            :key="part.key"
            v-model="settings[`${band.key}Text${part.key}`]"
            :placeholder="part.label"
            :aria-label="`${band.label} ${part.label}`"
          />
        </div>
      </div>
      <p class="hint">
        <!-- The placeholders are passed as values so they show literally. -->
        {{ t('printPreview.settings.tokens', tokenNames) }}
        <button
          type="button"
          class="link-button"
          @click="settings.footerTextCenter = '{page} / {pages}'"
        >
          {{ t('printPreview.settings.addPageNumbers') }}
        </button>
      </p>
      <div class="field slider">
        <label>{{ t('printPreview.settings.runningSize') }}</label>
        <el-slider
          :aria-label="t('printPreview.settings.runningSize')"
          v-model="settings.headerFooterFontSize"
          :min="8"
          :max="20"
          :format-tooltip="(value: number) => `${value}px`"
        />
        <output>{{ settings.headerFooterFontSize }}px</output>
      </div>
      <div class="field toggle">
        <label for="print-ruled">{{ t('printPreview.settings.ruled') }}</label>
        <el-switch
          id="print-ruled"
          v-model="settings.headerFooterStyled"
        />
      </div>
    </section>

    <section>
      <h4>{{ t('printPreview.settings.content') }}</h4>
      <div class="field">
        <label for="print-theme">{{ t('exportSettings.theme.theme') }}</label>
        <el-select
          id="print-theme"
          v-model="settings.theme"
        >
          <el-option
            v-for="item in themes"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </div>
      <div class="field">
        <label for="print-toc-title">{{ t('printPreview.settings.tocTitle') }}</label>
        <el-input
          id="print-toc-title"
          v-model="settings.tocTitle"
          :placeholder="t('exportSettings.toc.title')"
        />
      </div>
      <div class="field toggle">
        <label for="print-toc-top">{{ t('exportSettings.toc.includeTopHeading') }}</label>
        <el-switch
          id="print-toc-top"
          v-model="settings.tocIncludeTopHeading"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FontTextBox from '@/prefComponents/common/fontTextBox/index.vue'
import type { PrefSelectOption } from '@/prefComponents/common/types'
import type { ExportSettingsState } from '../exportSettings/state'

type MarginKey = 'pageMarginTop' | 'pageMarginRight' | 'pageMarginBottom' | 'pageMarginLeft'

// The dialog's reactive settings; fields are edited in place.
const settings = defineModel<ExportSettingsState>('settings', { required: true })
defineProps<{
  pageSizes: PrefSelectOption<string>[]
  themes: PrefSelectOption<string>[]
}>()
const { t } = useI18n()
const percent = (value: number) => `${value}%`
const tokenNames = { page: '{page}', pages: '{pages}', title: '{title}', date: '{date}' }

// [top, right, bottom, left] in mm.
const MARGINS: Record<string, [number, number, number, number]> = {
  narrow: [12.7, 12.7, 12.7, 12.7],
  normal: [20, 15, 20, 15],
  wide: [25.4, 25.4, 25.4, 25.4]
}
const marginKeys: MarginKey[] = ['pageMarginTop', 'pageMarginRight', 'pageMarginBottom', 'pageMarginLeft']
const marginPresets = computed(() => [
  { value: 'narrow', label: t('printPreview.settings.marginNarrow') },
  { value: 'normal', label: t('printPreview.settings.marginNormal') },
  { value: 'wide', label: t('printPreview.settings.marginWide') },
  { value: 'custom', label: t('printPreview.settings.marginCustom') }
])
const marginSides = computed(() =>
  (['top', 'right', 'bottom', 'left'] as const).map((side, i) => ({
    key: marginKeys[i],
    label: t(`printPreview.settings.margin${side[0].toUpperCase()}${side.slice(1)}`)
  }))
)
// Choosing "custom" keeps the current values and makes them editable.
const editingMargins = ref(false)
const marginPreset = computed(() => {
  if (editingMargins.value) return 'custom'
  const current = marginKeys.map((key) => settings.value[key])
  const match = Object.entries(MARGINS).find(([, values]) => values.every((value, i) => value === current[i]))
  return match ? match[0] : 'custom'
})
const setMarginPreset = (preset: string) => {
  const values = MARGINS[preset]
  editingMargins.value = !values
  if (values) marginKeys.forEach((key, i) => (settings.value[key] = values[i]))
}

const bands = computed(() => [
  { key: 'header' as const, label: t('printPreview.settings.header') },
  { key: 'footer' as const, label: t('printPreview.settings.footer') }
])
const parts = computed(() => [
  { key: 'Left' as const, label: t('printPreview.settings.cellLeft') },
  { key: 'Center' as const, label: t('printPreview.settings.cellCenter') },
  { key: 'Right' as const, label: t('printPreview.settings.cellRight') }
])
</script>

<style scoped>
/* Element Plus controls default to light colours; follow the editor theme. */
.print-settings {
  --el-fill-color-blank: var(--inputBgColor);
  --el-bg-color-overlay: var(--floatBgColor);
  --el-fill-color-light: var(--floatHoverColor);
  --el-text-color-primary: var(--editorColor);
  --el-text-color-regular: var(--editorColor80);
  --el-text-color-placeholder: var(--editorColor30);
  --el-border-color: var(--editorColor10);
  --el-border-color-light: var(--floatBorderColor);
  --el-border-color-hover: var(--editorColor30);
  --el-color-primary: var(--themeColor);
  --el-switch-off-color: var(--editorColor30);

  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: 13px;
  color: var(--editorColor);
}
section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--editorColor60);
  text-transform: uppercase;
}
.field {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.field > label {
  color: var(--editorColor80);
  line-height: 1.3;
}
.field.slider {
  grid-template-columns: 92px minmax(0, 1fr) 44px;
}
.field.slider output {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--editorColor60);
  font-size: 12px;
}
.field.toggle {
  grid-template-columns: minmax(0, 1fr) auto;
}
.field.pair {
  grid-template-columns: 92px repeat(2, minmax(0, 1fr));
}
.field :deep(.el-select),
.field :deep(.el-input-number) {
  width: 100%;
}
/* The input wrapper already draws the border. */
.print-settings :deep(input.el-input__inner) {
  border: 0;
  background: transparent;
}
.margins {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
  padding-left: 102px;
}
.margins label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--editorColor60);
}
.margins :deep(.el-input-number) {
  width: 100%;
}
.font-field {
  margin: 0;
}
.band {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.band-cells {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.hint {
  margin: 0;
  padding-left: 102px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--editorColor60);
}
.link-button {
  padding: 0;
  margin-left: 4px;
  border: 0;
  background: none;
  color: var(--themeColor);
  font: inherit;
  cursor: pointer;
}
.link-button:hover {
  text-decoration: underline;
}
.link-button:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: 2px;
}
</style>
