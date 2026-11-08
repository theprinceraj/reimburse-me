const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inrWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** `123456` paise → `1,234.56` (no symbol; the ₹ is set in a different font). */
export function formatAmount(paise: number, opts: { trimZero?: boolean } = {}): string {
  const rupees = paise / 100
  if (opts.trimZero && paise % 100 === 0) return inrWhole.format(rupees)
  return inr.format(rupees)
}

export const formatInr = (paise: number) => `₹${formatAmount(paise)}`

/**
 * Parses what the user typed into the amount field. Accepts commas and at most two decimals.
 * Returns paise, or `null` when the text is not a positive amount.
 */
export function parseAmount(input: string): number | null {
  const clean = input.replace(/[,\s₹]/g, '')
  if (!/^\d*(\.\d{0,2})?$/.test(clean) || clean === '' || clean === '.') return null
  const [whole = '0', frac = ''] = clean.split('.')
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'))
  return Number.isFinite(paise) && paise > 0 && paise < 1e13 ? paise : null
}

/** Keeps the amount field to digits, one dot and two decimals while the user types. */
export function sanitizeAmountInput(input: string): string {
  let s = input.replace(/[^\d.]/g, '')
  const dot = s.indexOf('.')
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  if (s.startsWith('0') && s.length > 1 && s[1] !== '.') s = s.replace(/^0+/, '') || '0'
  return s.slice(0, 12)
}

/** Live grouping for the amount field: `123456.5` → `1,23,456.5`. */
export function groupAmountInput(s: string): string {
  if (!s) return ''
  const [whole, frac] = s.split('.')
  const grouped = whole ? inrWhole.format(Number(whole)) : '0'
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

export function todayIso(): string {
  return toIso(new Date())
}

export function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short' })
const monthYear = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' })

export const formatDate = (iso: string) => dayMonthYear.format(fromIso(iso))
export const formatMonth = (d: Date) => monthYear.format(d)

/** "Today · 9 Nov", "Yesterday · 8 Nov", "Fri · 6 Nov" or "Fri · 6 Nov 2025" for other years. */
export function dayHeading(iso: string): string {
  const d = fromIso(iso)
  const today = fromIso(todayIso())
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000)
  const dm = d.getFullYear() === today.getFullYear() ? dayMonth.format(d) : dayMonthYear.format(d)
  if (diff === 0) return `Today · ${dm}`
  if (diff === 1) return `Yesterday · ${dm}`
  return `${weekday.format(d)} · ${dm}`
}

export function monthRange(offset = 0): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  return { from: toIso(start), to: toIso(end) }
}
