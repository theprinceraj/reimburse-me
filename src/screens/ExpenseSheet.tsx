import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, Camera, Check, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { Field, GhostButton, inputClass, PrimaryButton, Rupee, Sheet, TONE_CLASSES, cx } from '../components/ui'
import { db, deleteExpense, newId, type Receipt, TONES, upsertBilledTo } from '../db'
import { useBilledTo, useNatures, useObjectUrl } from '../hooks'
import { overlayView, refreshUserProps, scrubText, track, trackError } from '../lib/analytics'
import { formatDate, groupAmountInput, parseAmount, sanitizeAmountInput, toIso, todayIso } from '../lib/format'
import { compressImage } from '../lib/images'
import { isPdf, MAX_PDF_PAGES, rasterizePdf } from '../lib/pdfReceipt'
import { ReceiptViewer } from './ReceiptViewer'

/** `kind` is what the user picked (a PDF is stored as page images); only known for receipts added this time. */
type DraftReceipt = Pick<Receipt, 'id' | 'blob' | 'width' | 'height'> & { isNew: boolean; kind?: 'image' | 'pdf' }

interface Draft {
  amount: string
  date: string
  natureId?: string
  remarks: string
  billedToId?: string
  newBilledTo: string
  receipts: DraftReceipt[]
}

const emptyDraft = (billedToId?: string): Draft => ({
  amount: '',
  date: todayIso(),
  remarks: '',
  billedToId,
  newBilledTo: '',
  receipts: [],
})

export function ExpenseSheet({ editing, onClose }: { editing: string | null | undefined; onClose: () => void }) {
  const open = editing !== undefined
  const isEdit = typeof editing === 'string'
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [loaded, setLoaded] = useState(false)
  const [errors, setErrors] = useState<{ amount?: string; billedTo?: string }>({})
  const [addingBilled, setAddingBilled] = useState(false)
  const [addingNature, setAddingNature] = useState(false)
  const [newNature, setNewNature] = useState('')
  const [viewing, setViewing] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const natures = useNatures()
  const billedTo = useBilledTo()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const initial = useRef('')
  const [showAllBilled, setShowAllBilled] = useState(false)
  const original = useLiveQuery(() => (isEdit ? db.expenses.get(editing) : undefined), [editing])

  // Load the draft each time the sheet opens.
  useEffect(() => {
    if (!open) {
      setLoaded(false)
      setViewing(null)
      return
    }
    let stale = false
    const leave = overlayView(isEdit ? 'expense/edit' : 'expense/new')
    setErrors({})
    setAddingNature(false)
    setViewing(null)
    if (!isEdit) {
      db.billedTo
        .orderBy('lastUsedAt')
        .last()
        .then((b) => {
          if (stale) return
          const d = emptyDraft(b?.id)
          initial.current = JSON.stringify(d)
          setDraft(d)
          setAddingBilled(!b)
          setLoaded(true)
        })
      return () => {
        stale = true
        leave()
      }
    }
    Promise.all([db.expenses.get(editing), db.receipts.where('expenseId').equals(editing).sortBy('createdAt')]).then(([e, rs]) => {
      if (stale) return
      if (!e) return onClose()
      const d: Draft = {
        amount: String(e.amountPaise / 100).replace(/\.(\d)$/, '.$10'),
        date: e.date,
        natureId: e.natureId,
        remarks: e.remarks ?? '',
        billedToId: e.billedToId,
        newBilledTo: '',
        receipts: rs.map((r) => ({ ...r, isNew: false })),
      }
      initial.current = JSON.stringify(d)
      setDraft(d)
      setAddingBilled(false)
      setLoaded(true)
    })
    return () => {
      stale = true
      leave()
    }
  }, [open, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loaded && !isEdit) setTimeout(() => amountRef.current?.focus(), 280)
  }, [loaded, isEdit])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  async function addFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const added: DraftReceipt[] = []
      let failed = 0
      let truncated = false
      for (const f of Array.from(files)) {
        try {
          if (isPdf(f)) {
            const { pages, totalPages } = await rasterizePdf(f)
            if (totalPages > MAX_PDF_PAGES) truncated = true
            for (const p of pages) added.push({ id: newId(), ...p, isNew: true, kind: 'pdf' })
            track('receipt_attach', { type: 'pdf', size_kb: Math.round(f.size / 1024), page_count: pages.length, truncated: totalPages > MAX_PDF_PAGES })
          } else if (f.type.startsWith('image/')) {
            added.push({ id: newId(), ...(await compressImage(f)), isNew: true, kind: 'image' })
            track('receipt_attach', { type: 'image', size_kb: Math.round(f.size / 1024) })
          } else {
            failed++
            track('receipt_error', { stage: 'pick', reason: 'unsupported_type' })
          }
        } catch (err) {
          failed++
          track('receipt_error', { stage: isPdf(f) ? 'pdf' : 'image', reason: scrubText((err as Error)?.name || 'unknown') })
        }
      }
      setDraft((d) => ({ ...d, receipts: [...d.receipts, ...added] }))
      if (failed) toast(`Couldn't read ${failed === 1 ? 'that file' : `${failed} files`}. Try a photo or an unlocked PDF.`)
      else if (truncated) toast(`Added the first ${MAX_PDF_PAGES} pages of the PDF.`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function createNature() {
    const name = newNature.trim()
    if (!name) return setAddingNature(false)
    const existing = natures.list.find((n) => n.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      set('natureId', existing.id)
    } else {
      const id = newId()
      const order = natures.list.length
      const tone = TONES[order % TONES.length] ?? 'slate'
      await db.natures.add({ id, name, emoji: '🏷️', tone, builtIn: false, order })
      set('natureId', id)
      track('nature_create', { nature_name: scrubText(name), tone, surface: 'expense_sheet' })
    }
    setNewNature('')
    setAddingNature(false)
  }

  async function save() {
    if (busy) return
    const amountPaise = parseAmount(draft.amount)
    const typedBilled = draft.newBilledTo.trim()
    const errs: typeof errors = {}
    if (!amountPaise) errs.amount = draft.amount ? 'Enter a valid amount' : 'Enter the amount you paid'
    if (!(addingBilled ? typedBilled : draft.billedToId)) errs.billedTo = 'Choose who this is billed to'
    setErrors(errs)
    if (errs.amount || errs.billedTo || !amountPaise) {
      if (errs.amount) amountRef.current?.focus()
      return
    }
    setBusy(true)
    const billedName = typedBilled.replace(/\s+/g, ' ')
    const isNewBilled = addingBilled && !billedTo.list.some((b) => b.name.toLowerCase() === billedName.toLowerCase())
    let billedToId = draft.billedToId as string
    try {
      if (addingBilled) billedToId = await upsertBilledTo(typedBilled)
      if (!addingBilled) await db.billedTo.update(billedToId, { lastUsedAt: Date.now() })
      const now = Date.now()
      const id = isEdit ? editing : newId()
      await db.transaction('rw', db.expenses, db.receipts, async () => {
        await db.expenses.put({
          id,
          date: draft.date,
          amountPaise,
          natureId: draft.natureId,
          remarks: draft.remarks.trim() || undefined,
          billedToId,
          createdAt: original?.createdAt ?? now,
          updatedAt: now,
        })
        const keep = new Set(draft.receipts.map((r) => r.id))
        const existing = (await db.receipts.where('expenseId').equals(id).primaryKeys()) as string[]
        await db.receipts.bulkDelete(existing.filter((k) => !keep.has(k)))
        await db.receipts.bulkAdd(
          draft.receipts
            .filter((r) => r.isNew)
            .map((r, i) => ({ id: r.id, expenseId: id, blob: r.blob, width: r.width, height: r.height, createdAt: now + i })),
        )
      })
      onClose()
      toast(isEdit ? 'Expense updated' : 'Expense added')
    } catch (err) {
      console.error(err)
      trackError(err, 'expense_save')
      toast(
        (err as DOMException)?.name === 'QuotaExceededError'
          ? 'Phone storage is full. Free up space or remove some photos.'
          : "Couldn't save. Please try again.",
      )
      return
    } finally {
      setBusy(false)
    }
    // Saved: an analytics failure past this point must not report the save as failed.
    try {
      if (isNewBilled) track('billed_to_create', { billed_to: scrubText(billedName), surface: 'expense_sheet' })
      if (isEdit) {
        const before = JSON.parse(initial.current) as Draft
        const ids = (rs: DraftReceipt[]) => rs.map((r) => r.id).join()
        const changed = [
          parseAmount(before.amount) !== amountPaise && 'amount',
          before.date !== draft.date && 'date',
          before.natureId !== draft.natureId && 'nature',
          before.remarks.trim() !== draft.remarks.trim() && 'remarks',
          before.billedToId !== billedToId && 'billed_to',
          ids(before.receipts) !== ids(draft.receipts) && 'receipts',
        ].filter(Boolean)
        track('expense_edit', { fields_changed: changed.join(',') || 'none', receipt_count: draft.receipts.length })
      } else {
        const nature = draft.natureId ? natures.map.get(draft.natureId) : undefined
        const remarks = scrubText(draft.remarks)
        const kinds = new Set(draft.receipts.map((r) => r.kind ?? 'image'))
        const offsetDays = Math.round((Date.parse(todayIso()) - Date.parse(draft.date)) / 86_400_000)
        // GA4 key event candidate.
        track('expense_add', {
          value: amountPaise / 100,
          currency: 'INR',
          nature_id: nature ? (nature.builtIn ? nature.id : 'custom') : 'none',
          nature_name: nature ? scrubText(nature.name) : 'none',
          nature_is_custom: nature ? !nature.builtIn : false,
          billed_to: scrubText(addingBilled ? billedName : (billedTo.map.get(billedToId)?.name ?? '')),
          remarks: remarks || undefined,
          has_remarks: !!remarks,
          receipt_count: draft.receipts.length,
          receipt_types: kinds.size === 0 ? 'none' : kinds.size > 1 ? 'mixed' : [...kinds][0],
          expense_date_offset_days: offsetDays,
          is_backdated: offsetDays > 0,
        })
      }
      refreshUserProps()
    } catch (err) {
      trackError(err, 'analytics')
    }
  }

  async function remove() {
    if (!isEdit) return
    const [e, rs] = await Promise.all([db.expenses.get(editing), db.receipts.where('expenseId').equals(editing).toArray()])
    await deleteExpense(editing)
    onClose()
    track('expense_delete', { receipt_count: rs.length })
    refreshUserProps()
    if (e)
      toast('Expense deleted', {
        label: 'Undo',
        run: () =>
          db
            .transaction('rw', db.expenses, db.receipts, async () => {
              await db.expenses.add(e)
              await db.receipts.bulkAdd(rs)
            })
            .then(() => {
              track('expense_delete_undo', { receipt_count: rs.length })
              refreshUserProps()
            })
            .catch(() => toast("Couldn't restore the expense.")),
      })
  }

  const now = new Date()
  const yesterday = toIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const CHIP_LIMIT = 8
  const selectedBilled = billedTo.list.find((b) => b.id === draft.billedToId)
  const recentBilled = showAllBilled
    ? billedTo.list
    : [...billedTo.list.slice(0, CHIP_LIMIT), ...(selectedBilled && !billedTo.list.slice(0, CHIP_LIMIT).includes(selectedBilled) ? [selectedBilled] : [])]
  const hiddenBilled = billedTo.list.length - recentBilled.length

  return (
    <>
      <Sheet
        open={open && loaded}
        onClose={onClose}
        title={isEdit ? 'Edit expense' : 'New expense'}
        isDirty={() => JSON.stringify(draft) !== initial.current}
        discardLabel={isEdit ? 'Discard your changes?' : 'Discard this expense?'}
        footer={
          <div className="flex items-center gap-2">
            {isEdit && (
              <GhostButton icon={<Trash2 size={18} />} onClick={remove} className="text-error" aria-label="Delete expense">
                Delete
              </GhostButton>
            )}
            <PrimaryButton className="flex-1" onClick={save} disabled={busy} icon={<Check size={20} />}>
              {isEdit ? 'Save changes' : 'Save expense'}
            </PrimaryButton>
          </div>
        }
      >
        <form
          className="flex flex-col gap-6 pt-2 pb-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          {/* Amount */}
          <Field label="Amount" htmlFor="amount">
            <div
              className={cx(
                'flex min-h-16 items-center gap-1 rounded-field border bg-paper px-4 transition-colors focus-within:border-ink',
                errors.amount ? 'border-error' : 'border-hairline',
              )}
            >
              <Rupee className="t-num-hero text-accent" />
              <input
                ref={amountRef}
                id="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={groupAmountInput(draft.amount)}
                onChange={(e) => {
                  set('amount', sanitizeAmountInput(e.target.value))
                  if (errors.amount) setErrors((x) => ({ ...x, amount: undefined }))
                }}
                className="w-full min-w-0 bg-transparent t-num-hero text-ink outline-none placeholder:text-surface-highest"
                aria-invalid={!!errors.amount}
                aria-describedby={errors.amount ? 'amount-err' : undefined}
              />
            </div>
            {errors.amount && (
              <p id="amount-err" className="t-body-sm text-error">
                {errors.amount}
              </p>
            )}
          </Field>

          {/* Date */}
          <Field label="Date" htmlFor="date">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <div className={cx(inputClass, 'pointer-events-none flex items-center gap-3')}>
                  <CalendarDays size={18} className="text-secondary" />
                  <span>{formatDate(draft.date)}</span>
                </div>
                <input
                  id="date"
                  type="date"
                  value={draft.date}
                  max={todayIso()}
                  required
                  onChange={(e) => e.target.value && set('date', e.target.value > todayIso() ? todayIso() : e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </div>
            </div>
            <div className="flex gap-2">
              {[
                [todayIso(), 'Today'],
                [yesterday, 'Yesterday'],
              ].map(([iso, label]) => (
                <Chip key={label} selected={draft.date === iso} onClick={() => set('date', iso as string)}>
                  {label}
                </Chip>
              ))}
            </div>
          </Field>

          {/* Billed to */}
          <Field label="Billed to" htmlFor={addingBilled ? 'billed-new' : undefined}>
            {recentBilled.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {recentBilled.map((b) => (
                  <Chip
                    key={b.id}
                    selected={!addingBilled && draft.billedToId === b.id}
                    onClick={() => {
                      setAddingBilled(false)
                      set('billedToId', b.id)
                      setErrors((x) => ({ ...x, billedTo: undefined }))
                    }}
                  >
                    {b.name}
                  </Chip>
                ))}
                {hiddenBilled > 0 && (
                  <Chip selected={false} onClick={() => setShowAllBilled(true)}>
                    {hiddenBilled} more…
                  </Chip>
                )}
                <Chip selected={addingBilled} onClick={() => setAddingBilled(true)} icon={<Plus size={14} />}>
                  New
                </Chip>
              </div>
            )}
            {addingBilled && (
              <input
                id="billed-new"
                autoFocus={recentBilled.length > 0}
                value={draft.newBilledTo}
                onChange={(e) => {
                  set('newBilledTo', e.target.value)
                  setErrors((x) => ({ ...x, billedTo: undefined }))
                }}
                placeholder="Company, client or project"
                autoCapitalize="words"
                enterKeyHint="next"
                maxLength={60}
                className={cx(inputClass, errors.billedTo && 'border-error')}
              />
            )}
            {errors.billedTo && <p className="t-body-sm text-error">{errors.billedTo}</p>}
          </Field>

          {/* Nature */}
          <Field label="Nature of expense" optional>
            <div className="flex flex-wrap gap-2">
              {natures.list.map((n) => {
                const selected = draft.natureId === n.id
                return (
                  <button
                    key={n.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => set('natureId', selected ? undefined : n.id)}
                    className={cx(
                      'inline-flex min-h-9 items-center gap-1.5 rounded-full pr-3.5 pl-2.5 t-body-sm transition-all duration-150',
                      TONE_CLASSES[n.tone].tint,
                      selected ? cx('font-semibold text-ink ring-2 ring-inset', TONE_CLASSES[n.tone].ring) : 'text-ink/80',
                    )}
                  >
                    <span aria-hidden>{n.emoji}</span>
                    {n.name}
                  </button>
                )
              })}
              {addingNature ? (
                <div className="flex min-h-9 items-center gap-1 rounded-full border border-ink bg-paper pr-1 pl-3.5">
                  <input
                    autoFocus
                    value={newNature}
                    onChange={(e) => setNewNature(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        createNature()
                      }
                    }}
                    maxLength={30}
                    placeholder="e.g. Parking"
                    className="w-28 bg-transparent t-body-sm outline-none"
                  />
                  <button type="button" onClick={createNature} aria-label="Add" className="flex size-7 items-center justify-center rounded-full bg-ink text-surface">
                    <Check size={14} />
                  </button>
                </div>
              ) : (
                <Chip selected={false} onClick={() => setAddingNature(true)} icon={<Plus size={14} />}>
                  Custom
                </Chip>
              )}
            </div>
          </Field>

          {/* Remarks */}
          <Field label="Remarks" optional htmlFor="remarks">
            <textarea
              id="remarks"
              value={draft.remarks}
              onChange={(e) => set('remarks', e.target.value)}
              placeholder="e.g. Cab from airport to client office"
              rows={2}
              maxLength={300}
              className={cx(inputClass, 'resize-none py-3.5')}
            />
          </Field>

          {/* Receipts */}
          <Field label="Receipts" optional>
            <div className="grid grid-cols-4 gap-2">
              {draft.receipts.map((r, i) => (
                <Thumb
                  key={r.id}
                  blob={r.blob}
                  onOpen={() => setViewing(i)}
                  onRemove={() => {
                    set('receipts', draft.receipts.filter((x) => x.id !== r.id))
                    track('receipt_remove', { surface: 'thumbnail' })
                  }}
                />
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-field border border-dashed border-outline-variant bg-paper text-secondary active:bg-pressed"
              >
                <Camera size={20} />
                <span className="t-body-sm">{busy ? 'Adding…' : 'Add'}</span>
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          </Field>
        </form>
      </Sheet>
      {viewing !== null && draft.receipts[viewing] && (
        <ReceiptViewer
          blobs={draft.receipts.map((r) => r.blob)}
          start={viewing}
          onClose={() => setViewing(null)}
          onDelete={(i) => {
            setDraft((d) => ({ ...d, receipts: d.receipts.filter((_, j) => j !== i) }))
            setViewing(null)
            track('receipt_remove', { surface: 'viewer' })
          }}
        />
      )}
    </>
  )
}

function Chip({ selected, onClick, icon, children }: { selected: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-9 max-w-full items-center gap-1 rounded-full px-3.5 t-body-sm transition-colors duration-150',
        selected ? 'bg-ink font-medium text-surface' : 'border border-hairline bg-paper text-ink active:bg-pressed',
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  )
}

function Thumb({ blob, onOpen, onRemove }: { blob: Blob; onOpen: () => void; onRemove: () => void }) {
  const url = useObjectUrl(blob)
  return (
    <div className="relative aspect-square">
      <button type="button" onClick={onOpen} className="size-full overflow-hidden rounded-field border border-hairline bg-surface-mid" aria-label="View receipt">
        {url && <img src={url} alt="" className="size-full object-cover" />}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove receipt"
        className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border-2 border-surface bg-ink text-surface"
      >
        <X size={12} strokeWidth={3} />
      </button>
    </div>
  )
}
