import type { jsPDF as JsPDF } from 'jspdf'
import { type ClaimInput, claimTotal, periodLabel, receiptsFor } from './claim'
import { formatAmount, formatDate, todayIso } from './format'
import { blobToDataUrl } from './images'

// Qoody palette, as RGB for jsPDF.
const INK: [number, number, number] = [28, 28, 25]
const SECONDARY: [number, number, number] = [96, 94, 90]
const ACCENT: [number, number, number] = [255, 90, 54]
const HAIRLINE: [number, number, number] = [232, 228, 220]
const SURFACE_LOW: [number, number, number] = [246, 243, 238]

const fontCache: Record<string, string> = {}
async function fontBase64(file: string): Promise<string> {
  const cached = fontCache[file]
  if (cached) return cached
  const buf = await (await fetch(`/fonts/${file}`)).arrayBuffer()
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return (fontCache[file] = btoa(bin))
}

async function registerFonts(doc: JsPDF) {
  const fonts: [string, string, string][] = [
    ['PlusJakartaSans-Regular.ttf', 'Jakarta', 'normal'],
    ['PlusJakartaSans-Bold.ttf', 'Jakarta', 'bold'],
    ['DMSans-Bold.ttf', 'DMSans', 'bold'],
  ]
  for (const [file, family, style] of fonts) {
    doc.addFileToVFS(file, await fontBase64(file))
    doc.addFont(file, family, style)
  }
}

/** A4 claim sheet: header, itemised table, total, sign-off lines, then one receipt per page section. */
export async function buildPdf(input: ClaimInput, opts: { includeReceipts: boolean }): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  await registerFonts(doc)
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 16
  const receipts = opts.includeReceipts ? await receiptsFor(input.expenses) : new Map()

  // Header
  doc.setFillColor(...ACCENT)
  doc.rect(0, 0, W, 3, 'F')
  doc.setFont('DMSans', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...INK)
  doc.text('Expense Reimbursement Claim', M, 20)
  doc.setFont('Jakarta', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...SECONDARY)
  doc.text(`Generated on ${formatDate(todayIso())}`, M, 26)

  const p = input.profile
  const meta: [string, string][] = [
    ['Employee', p.name || '—'],
    ['Employee ID', p.employeeId || '—'],
    ['Department', p.department || '—'],
    ['Email', p.email || '—'],
    ['Billed to', input.billedToLabel],
    ['Period', periodLabel(input.from, input.to)],
  ]
  const boxY = 32
  const colW = (W - 2 * M) / 2
  doc.setFillColor(...SURFACE_LOW)
  doc.roundedRect(M, boxY, W - 2 * M, 34, 3, 3, 'F')
  meta.forEach(([k, v], i) => {
    const x = M + 6 + (i % 2) * colW
    const y = boxY + 9 + Math.floor(i / 2) * 9.5
    doc.setFont('Jakarta', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...SECONDARY)
    doc.text(k.toUpperCase(), x, y - 3.2)
    doc.setFont('Jakarta', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(v, colW - 10)[0] as string, x, y + 1.2)
  })

  // Items
  const showBilledTo = new Set(input.expenses.map((e) => e.billedToId)).size > 1
  const head = ['#', 'Date', 'Nature of expense', 'Remarks', ...(showBilledTo ? ['Billed to'] : []), 'Amount (₹)']
  const body = input.expenses.map((e, i) => {
    const r = receipts.get(e.id)?.length ?? 0
    const nature = e.natureId ? (input.natures.get(e.natureId)?.name ?? '') : ''
    return [
      String(i + 1),
      formatDate(e.date),
      nature || '—',
      (e.remarks ?? '') + (r ? `${e.remarks ? '\n' : ''}${r} receipt${r > 1 ? 's' : ''} attached` : ''),
      ...(showBilledTo ? [input.billedTo.get(e.billedToId)?.name ?? ''] : []),
      formatAmount(e.amountPaise),
    ]
  })
  const amountCol = head.length - 1
  autoTable(doc, {
    startY: boxY + 42,
    margin: { left: M, right: M },
    head: [head],
    body,
    foot: [[...Array(amountCol - 1).fill(''), 'Total', `₹${formatAmount(claimTotal(input.expenses))}`]],
    theme: 'plain',
    styles: { font: 'Jakarta', fontSize: 9, textColor: INK, cellPadding: { top: 2.6, bottom: 2.6, left: 2, right: 2 }, valign: 'top' },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: SECONDARY, fillColor: SURFACE_LOW },
    footStyles: { fontStyle: 'bold', fontSize: 11, textColor: INK },
    columnStyles: {
      0: { cellWidth: 8, textColor: SECONDARY },
      1: { cellWidth: 26 },
      [amountCol]: { halign: 'right', cellWidth: 30 },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index === amountCol) data.cell.styles.halign = 'right'
      if (data.section === 'foot' && data.column.index >= amountCol - 1) data.cell.styles.halign = 'right'
    },
    willDrawCell: (data) => {
      if (data.section === 'body') {
        doc.setDrawColor(...HAIRLINE)
        doc.setLineWidth(0.2)
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height)
      }
      if (data.section === 'foot' && data.column.index === amountCol) {
        doc.setDrawColor(...INK)
        doc.setLineWidth(0.4)
        doc.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y)
      }
    },
  })

  // Sign-off
  // biome-ignore lint: jspdf-autotable augments the doc with lastAutoTable
  let y = ((doc as any).lastAutoTable?.finalY ?? 120) + 12
  if (y > H - 50) {
    doc.addPage()
    y = 30
  }
  doc.setFont('Jakarta', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...SECONDARY)
  const count = input.expenses.length
  doc.text(`${count} expense${count === 1 ? '' : 's'} · amount in words: ${rupeesInWords(claimTotal(input.expenses))}`, M, y, {
    maxWidth: W - 2 * M,
  })
  y += 26
  if (y > H - 20) {
    doc.addPage()
    y = 40
  }
  const sigW = (W - 2 * M - 20) / 2
  ;['Employee signature', 'Approved by'].forEach((label, i) => {
    const x = M + i * (sigW + 20)
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.3)
    doc.line(x, y, x + sigW, y)
    doc.text(label, x, y + 5)
  })

  // Receipts appendix
  const withReceipts = input.expenses.map((e, i) => ({ e, i, list: receipts.get(e.id) ?? [] })).filter((x) => x.list.length)
  for (const { e, i, list } of withReceipts) {
    for (const [ri, r] of list.entries()) {
      doc.addPage()
      doc.setFillColor(...ACCENT)
      doc.rect(0, 0, W, 3, 'F')
      doc.setFont('DMSans', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(...INK)
      doc.text(`Receipt for item #${i + 1}${list.length > 1 ? ` (${ri + 1} of ${list.length})` : ''}`, M, 16)
      doc.setFont('Jakarta', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...SECONDARY)
      const nature = e.natureId ? input.natures.get(e.natureId)?.name : undefined
      doc.text([formatDate(e.date), nature, `₹${formatAmount(e.amountPaise)}`].filter(Boolean).join('  ·  '), M, 22)
      const maxW = W - 2 * M
      const maxH = H - 30 - M
      const s = Math.min(maxW / r.width, maxH / r.height)
      const w = r.width * s
      const h = r.height * s
      doc.addImage(await blobToDataUrl(r.blob), 'JPEG', M + (maxW - w) / 2, 28, w, h, undefined, 'FAST')
    }
  }

  // Page numbers
  const pages = doc.getNumberOfPages()
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n)
    doc.setFont('Jakarta', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...SECONDARY)
    doc.text(`${p.name ? `${p.name} · ` : ''}Page ${n} of ${pages}`, W - M, H - 8, { align: 'right' })
  }

  return doc.output('blob')
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? ''
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
}

/** Indian numbering: 123456 paise → "Rupees One Thousand Two Hundred Thirty Four and Fifty Six Paise Only". */
export function rupeesInWords(paise: number): string {
  let n = Math.floor(paise / 100)
  const p = paise % 100
  if (n === 0 && p === 0) return 'Rupees Zero Only'
  const parts: string[] = []
  const crore = Math.floor(n / 1e7)
  n %= 1e7
  const lakh = Math.floor(n / 1e5)
  n %= 1e5
  const thousand = Math.floor(n / 1e3)
  n %= 1e3
  const hundred = Math.floor(n / 100)
  n %= 100
  if (crore) parts.push(`${crore > 99 ? rupeesInWords(crore * 100).replace(/^Rupees | Only$/g, '') : twoDigits(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (hundred) parts.push(`${ONES[hundred]} Hundred`)
  if (n) parts.push(twoDigits(n))
  const rupees = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero'
  return `${rupees}${p ? ` and ${twoDigits(p)} Paise` : ''} Only`
}
