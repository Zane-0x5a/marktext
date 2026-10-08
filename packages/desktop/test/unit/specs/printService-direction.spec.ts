import { describe, expect, it } from 'vitest'
import { preparePrintDocument } from '@/services/printService'

describe('Standalone print document — inherited text direction (#4833)', () => {
  for (const direction of ['rtl', 'auto', 'ltr']) {
    it(`preserves ${direction} from the styled export`, () => {
      const html = `<html dir="${direction}"><head></head><body><article class="markdown-body"><p>سلام</p></article></body></html>`
      const doc = new DOMParser().parseFromString(preparePrintDocument(html), 'text/html')
      expect(doc.documentElement.getAttribute('dir')).toBe(direction)
      expect(doc.querySelector('.print-container .markdown-body p')?.textContent).toBe('سلام')
      expect(document.body.querySelector('.print-container')).toBeNull()
    })
  }
})
