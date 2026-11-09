import { type EncodedImage, encodeCanvas } from './images'

/** Long edge of a rendered page. Higher than photos (1600) because PDF receipts are mostly small text. */
const PAGE_EDGE = 2000
/** A multi-page invoice is fine; a 200-page statement would blow past browser storage. */
export const MAX_PDF_PAGES = 10

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

/**
 * Renders each page of a PDF receipt to a JPEG, so it is stored, previewed and attached to the
 * claim exactly like a photo. pdf.js is loaded on first use only.
 */
export async function rasterizePdf(file: File): Promise<{ pages: EncodedImage[]; totalPages: number }> {
  const [pdfjs, { default: workerSrc }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  try {
    const count = Math.min(doc.numPages, MAX_PDF_PAGES)
    const pages: EncodedImage[] = []
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: PAGE_EDGE / Math.max(base.width, base.height) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      // Opaque white page so transparent PDFs don't turn black as JPEG.
      await page.render({ canvas, viewport, background: '#fff' }).promise
      pages.push(await encodeCanvas(canvas))
      page.cleanup()
      canvas.width = canvas.height = 0
    }
    return { pages, totalPages: doc.numPages }
  } finally {
    await task.destroy()
  }
}
