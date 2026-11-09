import { useLiveQuery } from 'dexie-react-hooks'
import { Check, ChevronRight, Download, FileSpreadsheet, FileText, Info, Paperclip, Share2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Card, EmptyAction, EmptyState, FilterPill, IconButton, PaperButton, Perforation, PrimaryButton, Rupee, SectionLabel, cx, inputClass } from '../components/ui'
import { db } from '../db'
import { useBilledTo, useNatures, useProfile } from '../hooks'
import { type Params, scrubText, track } from '../lib/analytics'
import { buildCsv, type ClaimInput } from '../lib/claim'
import { formatAmount, formatDate, monthRange, todayIso } from '../lib/format'
import { canShareFile, download, shareFile, slug } from '../lib/share'

type Period = 'this' | 'last' | 'all' | 'custom'

export function ClaimScreen({ onAddExpense, onOpenSettings }: { onAddExpense: () => void; onOpenSettings: () => void }) {
  const billedTo = useBilledTo()
  const natures = useNatures()
  const profile = useProfile()
  const toast = useToast()
  const [who, setWho] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('this')
  const [custom, setCustom] = useState(() => ({ ...monthRange(0), to: todayIso() }))
  const [withReceipts, setWithReceipts] = useState(true)
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null)
  const [ready, setReady] = useState<{ blob: Blob; name: string; kind: 'pdf' | 'csv'; params: Params; exported?: boolean } | null>(null)

  const all = useLiveQuery(() => db.expenses.orderBy('date').toArray(), [])
  const receiptIds = useLiveQuery(async () => (await db.receipts.orderBy('expenseId').keys()) as string[], [])

  const range = useMemo(() => {
    if (period === 'this') return monthRange(0)
    if (period === 'last') return monthRange(-1)
    if (period === 'custom') return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from }
    const first = all?.[0]?.date ?? todayIso()
    return { from: first, to: todayIso() }
  }, [period, custom, all])

  const items = useMemo(
    () => (all ?? []).filter((e) => (!who || e.billedToId === who) && e.date >= range.from && e.date <= range.to),
    [all, who, range],
  )
  const total = items.reduce((s, e) => s + e.amountPaise, 0)
  const receiptCount = useMemo(() => {
    const ids = new Set(items.map((e) => e.id))
    return (receiptIds ?? []).filter((id) => ids.has(id)).length
  }, [items, receiptIds])

  const input: ClaimInput = {
    expenses: items,
    billedTo: billedTo.map,
    natures: natures.map,
    billedToLabel: who ? (billedTo.map.get(who)?.name ?? '') : new Set(items.map((e) => e.billedToId)).size === 1 ? (billedTo.map.get(items[0]?.billedToId ?? '')?.name ?? 'All') : 'Multiple',
    from: range.from,
    to: range.to,
    profile,
  }
  const fileBase = `claim-${slug(input.billedToLabel)}-${range.from}-to-${range.to}`

  async function exportAs(kind: 'pdf' | 'csv') {
    setBusy(kind)
    const startedAt = performance.now()
    try {
      const blob = kind === 'csv' ? await buildCsv(input) : await (await import('../lib/pdf')).buildPdf(input, { includeReceipts: withReceipts })
      const name = `${fileBase}.${kind}`
      // GA4 key event candidate (claim_export), sent once the file is shared or saved.
      const params: Params = {
        format: kind,
        period_type: period,
        period_label: `${range.from} to ${range.to}`,
        billed_to: who ? scrubText(input.billedToLabel) : 'everyone',
        expense_count: items.length,
        value: total / 100,
        currency: 'INR',
        include_receipts: kind === 'pdf' ? withReceipts && receiptCount > 0 : undefined,
        receipt_count: receiptCount,
        duration_ms: Math.round(performance.now() - startedAt),
      }
      // Sharing needs a fresh tap: building the PDF takes long enough for the original tap to expire.
      if (canShareFile(blob, name)) setReady({ blob, name, kind, params })
      else {
        download(blob, name)
        toast(`${kind.toUpperCase()} saved to downloads`)
        track('claim_export', { ...params, method: 'download' })
      }
    } catch (e) {
      console.error(e)
      track('claim_export_error', { format: kind, reason: scrubText((e as Error)?.message || String(e)) })
      toast(`Couldn't create the ${kind.toUpperCase()}. Please try again.`)
    } finally {
      setBusy(null)
    }
  }

  /** The key event (with its value) counts once per built claim; sharing or saving it again is a plain action. */
  const reportExport = (method: 'share' | 'download') => {
    if (!ready) return
    if (ready.exported) return track('claim_export_action', { format: ready.kind, method })
    // Set on the object itself, so a Save tapped while a Share is still open sees it too.
    ready.exported = true
    track('claim_export', { ...ready.params, method })
  }

  // A prepared file goes stale as soon as the selection changes.
  const selectionKey = `${who}|${range.from}|${range.to}|${withReceipts}|${items.length}|${total}`
  const [readyKey, setReadyKey] = useState(selectionKey)
  if (readyKey !== selectionKey) {
    setReadyKey(selectionKey)
    if (ready) setReady(null)
  }

  if (!all) return null

  return (
    <div className="flex flex-col gap-5 px-4 pt-[max(20px,env(safe-area-inset-top))]">
      <header className="flex flex-col gap-1 pt-2">
        <h1 className="t-headline-lg">Make a claim</h1>
        <p className="t-body-md text-secondary">Pick the expenses, then share a PDF or spreadsheet with your company.</p>
      </header>

      {all.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon={<FileText size={26} />}
            title="Nothing to claim yet"
            body="Add a few expenses first. They'll appear here, ready to export."
            action={<EmptyAction onClick={onAddExpense}>Add an expense</EmptyAction>}
          />
        </Card>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <SectionLabel>Billed to</SectionLabel>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              <FilterPill selected={who === null} onClick={() => setWho(null)}>
                Everyone
              </FilterPill>
              {billedTo.list.map((b) => (
                <FilterPill key={b.id} selected={who === b.id} onClick={() => setWho(b.id)}>
                  {b.name}
                </FilterPill>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <SectionLabel>Period</SectionLabel>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {(
                [
                  ['this', 'This month'],
                  ['last', 'Last month'],
                  ['all', 'All time'],
                  ['custom', 'Custom'],
                ] as const
              ).map(([id, label]) => (
                <FilterPill key={id} selected={period === id} onClick={() => setPeriod(id)}>
                  {label}
                </FilterPill>
              ))}
            </div>
            {period === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                {(['from', 'to'] as const).map((k) => (
                  <label key={k} className="flex flex-col gap-1">
                    <span className="t-body-sm text-secondary">{k === 'from' ? 'From' : 'To'}</span>
                    <div className="relative">
                      <div className={cx(inputClass, 'pointer-events-none flex items-center t-body-md')}>{formatDate(custom[k])}</div>
                      <input
                        type="date"
                        max={todayIso()}
                        value={custom[k]}
                        onChange={(e) => e.target.value && setCustom((c) => ({ ...c, [k]: e.target.value }))}
                        className="absolute inset-0 h-full w-full opacity-0"
                      />
                    </div>
                  </label>
                ))}
              </div>
            )}
          </section>

          {/* Receipt-style preview */}
          <Card className="overflow-hidden p-0">
            <div className="flex flex-col gap-1 px-5 pt-5 pb-4">
              <SectionLabel>Claim total</SectionLabel>
              <div className="flex items-baseline gap-1">
                <Rupee className="t-num-hero font-semibold text-accent" />
                <span className="t-num-hero">{formatAmount(total)}</span>
              </div>
              <div className="t-body-sm text-secondary">
                {items.length} expense{items.length === 1 ? '' : 's'} · {formatDate(range.from)} – {formatDate(range.to)}
              </div>
            </div>
            <Perforation />
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-6 text-center">
                <p className="t-body-md text-secondary">
                  No expenses {who ? `for ${billedTo.map.get(who)?.name} ` : ''}in this period.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {who && <EmptyAction onClick={() => setWho(null)}>Include everyone</EmptyAction>}
                  {period !== 'all' && <EmptyAction onClick={() => setPeriod('all')}>Show all time</EmptyAction>}
                </div>
              </div>
            ) : (
              <ul className="max-h-80 overflow-y-auto px-5 py-2">
                {items.map((e) => {
                  const n = e.natureId ? natures.map.get(e.natureId) : undefined
                  return (
                    <li key={e.id} className="flex items-center gap-3 border-b border-hairline py-2.5 last:border-0">
                      <span className="w-14 shrink-0 t-num-sm text-secondary">{formatDate(e.date).replace(/ \d{4}$/, '')}</span>
                      <span className="min-w-0 flex-1 truncate t-body-md">
                        {n ? `${n.emoji} ${n.name}` : (e.remarks ?? 'Expense')}
                        {!who && <span className="t-body-sm text-tertiary"> · {billedTo.map.get(e.billedToId)?.name}</span>}
                      </span>
                      <span className="t-num-md">{formatAmount(e.amountPaise)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <label className="flex min-h-14 items-center gap-3 rounded-card border border-hairline bg-paper px-4">
            <Paperclip size={18} className="text-secondary" />
            <span className="flex flex-1 flex-col">
              <span className="t-body-md font-medium">Attach receipts</span>
              <span className="t-body-sm text-secondary">
                {receiptCount ? `${receiptCount} receipt page${receiptCount === 1 ? '' : 's'} added to the PDF` : 'No receipts in this claim'}
              </span>
            </span>
            <Switch checked={withReceipts && receiptCount > 0} disabled={!receiptCount} onChange={setWithReceipts} />
          </label>

          {!profile.name && (
            <button type="button" onClick={onOpenSettings} className="flex items-center gap-2.5 rounded-field bg-surface-low p-3 text-left active:bg-pressed">
              <Info size={18} className="shrink-0 text-secondary" />
              <span className="flex-1 t-body-sm text-secondary">Add your name and employee ID so they're printed on the claim.</span>
              <span className="flex shrink-0 items-center t-button-sm text-primary">
                Settings <ChevronRight size={16} />
              </span>
            </button>
          )}

          {ready && (
            <div className="flex animate-toast-in flex-col gap-3 rounded-card border border-hairline bg-paper p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sage-tint text-positive">
                  <Check size={20} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="t-title-md">{ready.kind === 'pdf' ? 'PDF claim ready' : 'Spreadsheet ready'}</span>
                  <span className="truncate t-body-sm text-secondary">{ready.name}</span>
                </span>
                <IconButton label="Dismiss" onClick={() => setReady(null)} className="text-secondary">
                  <X size={18} />
                </IconButton>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <PrimaryButton
                  compact
                  icon={<Share2 size={18} />}
                  onClick={async () => {
                    const how = await shareFile(ready.blob, ready.name, 'Expense claim')
                    if (how === 'failed') {
                      download(ready.blob, ready.name)
                      toast('Saved to downloads instead')
                    }
                    if (how !== 'cancelled') reportExport(how === 'shared' ? 'share' : 'download')
                  }}
                >
                  Share
                </PrimaryButton>
                <PaperButton
                  icon={<Download size={17} />}
                  onClick={() => {
                    download(ready.blob, ready.name)
                    reportExport('download')
                  }}
                >
                  Save
                </PaperButton>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <PrimaryButton disabled={!items.length || !!busy} onClick={() => exportAs('pdf')} icon={<FileText size={20} />}>
              {busy === 'pdf' ? 'Preparing PDF…' : 'Export PDF claim'}
            </PrimaryButton>
            <PaperButton disabled={!items.length || !!busy} onClick={() => exportAs('csv')} icon={<FileSpreadsheet size={18} />}>
              {busy === 'csv' ? 'Preparing…' : 'Export spreadsheet (CSV)'}
            </PaperButton>
          </div>
        </>
      )}
    </div>
  )
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40', checked ? 'bg-accent' : 'bg-surface-highest')}
    >
      <span className={cx('absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200', checked && 'translate-x-5')} />
    </button>
  )
}
