import { type BilledTo, db, type Expense, type Nature, type Receipt } from '../db'
import { formatAmount, formatDate } from './format'

export interface Profile {
  name: string
  employeeId: string
  department: string
  email: string
}

export const EMPTY_PROFILE: Profile = { name: '', employeeId: '', department: '', email: '' }

export interface ClaimInput {
  expenses: Expense[]
  billedTo: Map<string, BilledTo>
  natures: Map<string, Nature>
  /** Label for the claim header: a company name, or "All" when several are mixed. */
  billedToLabel: string
  from: string
  to: string
  profile: Profile
}

export const claimTotal = (expenses: Expense[]) => expenses.reduce((s, e) => s + e.amountPaise, 0)

const csvCell = (v: string | number) => {
  const s = String(v)
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s
}

/** UTF-8 CSV with a BOM so Excel shows ₹ and Indian names correctly. */
export async function buildCsv(input: ClaimInput): Promise<Blob> {
  const counts = await receiptCounts(input.expenses)
  const rows: (string | number)[][] = [
    ['S.No', 'Date', 'Amount (INR)', 'Nature of Expense', 'Remarks', 'Billed To', 'Receipts'],
  ]
  input.expenses.forEach((e, i) => {
    rows.push([
      i + 1,
      e.date,
      (e.amountPaise / 100).toFixed(2),
      e.natureId ? (input.natures.get(e.natureId)?.name ?? '') : '',
      e.remarks ?? '',
      input.billedTo.get(e.billedToId)?.name ?? '',
      counts.get(e.id) ?? 0,
    ])
  })
  rows.push(['', 'Total', (claimTotal(input.expenses) / 100).toFixed(2), '', '', '', ''])
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  return new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
}

async function receiptCounts(expenses: Expense[]) {
  const ids = expenses.map((e) => e.id)
  const receipts = await db.receipts.where('expenseId').anyOf(ids).toArray()
  const counts = new Map<string, number>()
  for (const r of receipts) counts.set(r.expenseId, (counts.get(r.expenseId) ?? 0) + 1)
  return counts
}

export async function receiptsFor(expenses: Expense[]): Promise<Map<string, Receipt[]>> {
  const ids = expenses.map((e) => e.id)
  const receipts = await db.receipts.where('expenseId').anyOf(ids).sortBy('createdAt')
  const map = new Map<string, Receipt[]>()
  for (const r of receipts) map.set(r.expenseId, [...(map.get(r.expenseId) ?? []), r])
  return map
}

export const periodLabel = (from: string, to: string) => `${formatDate(from)} – ${formatDate(to)}`
export { formatAmount }
