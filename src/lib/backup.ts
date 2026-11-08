import { db } from '../db'
import { blobToDataUrl, dataUrlToBlob } from './images'

const FORMAT = 'reimburse-me-backup'
const VERSION = 1

/** Everything, receipts included, as one JSON file the user can keep or move to a new phone. */
export async function exportBackup(): Promise<Blob> {
  const [expenses, billedTo, natures, receipts, settings] = await Promise.all([
    db.expenses.toArray(),
    db.billedTo.toArray(),
    db.natures.toArray(),
    db.receipts.toArray(),
    db.settings.toArray(),
  ])
  const encoded = await Promise.all(receipts.map(async ({ blob, ...r }) => ({ ...r, data: await blobToDataUrl(blob) })))
  const json = JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), expenses, billedTo, natures, receipts: encoded, settings })
  return new Blob([json], { type: 'application/json' })
}

/** Replaces all data with the backup's. Throws a readable message on a bad file. */
export async function importBackup(file: File): Promise<number> {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error("That file isn't a Reimburse Me backup.")
  }
  if (data.format !== FORMAT || typeof data.version !== 'number') throw new Error("That file isn't a Reimburse Me backup.")
  if (data.version > VERSION) throw new Error('This backup is from a newer version of the app. Update first.')
  const arr = (k: string) => (Array.isArray(data[k]) ? (data[k] as never[]) : [])
  const receipts = await Promise.all(
    arr('receipts').map(async ({ data: d, ...r }: { data: string }) => ({ ...(r as object), blob: await dataUrlToBlob(d) })),
  )
  await db.transaction('rw', [db.expenses, db.billedTo, db.natures, db.receipts, db.settings], async () => {
    await Promise.all([db.expenses.clear(), db.billedTo.clear(), db.natures.clear(), db.receipts.clear(), db.settings.clear()])
    await db.expenses.bulkAdd(arr('expenses'))
    await db.billedTo.bulkAdd(arr('billedTo'))
    await db.natures.bulkAdd(arr('natures'))
    await db.receipts.bulkAdd(receipts as never[])
    await db.settings.bulkAdd(arr('settings'))
  })
  return arr('expenses').length
}
