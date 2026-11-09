import Dexie, { type EntityTable } from 'dexie'

/** Colour pairs from Qoody's category palette; a nature of expense picks one by key. */
export type Tone = 'sage' | 'slate' | 'coral' | 'lavender' | 'amber' | 'sky'
export const TONES: Tone[] = ['amber', 'sky', 'sage', 'lavender', 'coral', 'slate']

export interface Expense {
  id: string
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string
  /** Whole paise, so sums never drift. */
  amountPaise: number
  natureId?: string
  remarks?: string
  billedToId: string
  createdAt: number
  updatedAt: number
}

export interface BilledTo {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number
}

export interface Nature {
  id: string
  name: string
  emoji: string
  tone: Tone
  builtIn: boolean
  order: number
}

export interface Receipt {
  id: string
  expenseId: string
  blob: Blob
  width: number
  height: number
  createdAt: number
}

export interface Setting {
  key: string
  value: string
}

/** An analytics event that could not go to gtag at once, replayed in order later. Never backed up. */
export interface QueuedEvent {
  id: number
  name: string
  params: Record<string, string | number | boolean>
  /** Epoch ms when the event happened. */
  queued_at: number
  /** True when it was queued because the device was offline or gtag.js failed (not just still loading). */
  offline?: boolean
}

export const db = new Dexie('reimburse-me') as Dexie & {
  expenses: EntityTable<Expense, 'id'>
  billedTo: EntityTable<BilledTo, 'id'>
  natures: EntityTable<Nature, 'id'>
  receipts: EntityTable<Receipt, 'id'>
  settings: EntityTable<Setting, 'key'>
  analyticsQueue: EntityTable<QueuedEvent, 'id'>
}

db.version(1).stores({
  expenses: 'id, date, billedToId, natureId, createdAt',
  billedTo: 'id, &name, lastUsedAt',
  natures: 'id, order',
  receipts: 'id, expenseId',
  settings: 'key',
})

db.version(2).stores({
  expenses: 'id, date, billedToId, natureId, createdAt',
  billedTo: 'id, &name, lastUsedAt',
  natures: 'id, order',
  receipts: 'id, expenseId',
  settings: 'key',
  analyticsQueue: '++id, queued_at',
})

/** Settings about this device's analytics (opt-out, first touch, notice): kept out of backups and delete-all. */
export const isDeviceSetting = (key: string) => key.startsWith('analytics_')

export const PRESET_NATURES: Omit<Nature, 'order'>[] = [
  { id: 'travel', name: 'Travel', emoji: '🚕', tone: 'slate', builtIn: true },
  { id: 'food', name: 'Food & Meals', emoji: '🍱', tone: 'sage', builtIn: true },
  { id: 'fuel', name: 'Fuel', emoji: '⛽', tone: 'amber', builtIn: true },
  { id: 'stay', name: 'Stay', emoji: '🏨', tone: 'lavender', builtIn: true },
  { id: 'supplies', name: 'Supplies', emoji: '📦', tone: 'coral', builtIn: true },
  { id: 'phone', name: 'Phone & Internet', emoji: '📶', tone: 'sky', builtIn: true },
  { id: 'client', name: 'Client Meeting', emoji: '🤝', tone: 'amber', builtIn: true },
]

const presetNatureRows = (): Nature[] => PRESET_NATURES.map((n, i) => ({ ...n, order: i }))

db.on('populate', (tx) => {
  tx.table('natures').bulkAdd(presetNatureRows())
})

/**
 * Empties every table and restores the built-in natures. Deliberately not `db.delete()`: deleting
 * the database waits forever while any other tab or window (e.g. a frozen background browser tab
 * next to the installed PWA) still has it open, so the button appeared to do nothing.
 */
export async function wipeAllData() {
  await db.transaction('rw', db.tables, async () => {
    const keep = await db.settings.filter((s) => isDeviceSetting(s.key)).toArray()
    // The analytics queue belongs to the device too: unsent events survive a wipe.
    await Promise.all(db.tables.filter((t) => t !== db.analyticsQueue).map((t) => t.clear()))
    await db.natures.bulkAdd(presetNatureRows())
    await db.settings.bulkAdd(keep)
  })
}

/** `crypto.randomUUID` needs a secure context; fall back to getRandomValues for plain-HTTP LAN testing. */
export const newId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Finds a "Billed to" by name (case-insensitive) or creates it, and marks it as just used. */
export async function upsertBilledTo(rawName: string): Promise<string> {
  const name = rawName.trim().replace(/\s+/g, ' ')
  const now = Date.now()
  const all = await db.billedTo.toArray()
  const existing = all.find((b) => b.name.toLowerCase() === name.toLowerCase())
  if (existing) {
    await db.billedTo.update(existing.id, { lastUsedAt: now })
    return existing.id
  }
  const id = newId()
  await db.billedTo.add({ id, name, createdAt: now, lastUsedAt: now })
  return id
}

export async function deleteExpense(id: string) {
  await db.transaction('rw', db.expenses, db.receipts, async () => {
    await db.receipts.where('expenseId').equals(id).delete()
    await db.expenses.delete(id)
  })
}

export async function getSetting(key: string): Promise<string | undefined> {
  return (await db.settings.get(key))?.value
}

export async function setSetting(key: string, value: string) {
  await db.settings.put({ key, value })
}

/** Asks the browser not to evict our IndexedDB under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
