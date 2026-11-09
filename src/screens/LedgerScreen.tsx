import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Paperclip, ReceiptText, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Card, Dot, EmptyAction, EmptyState, FilterPill, IconButton, inputClass, Rupee, SectionLabel, Tag, TONE_CLASSES, cx } from '../components/ui'
import { db, type Expense } from '../db'
import { useBilledTo, useNatures } from '../hooks'
import { scrubText, track } from '../lib/analytics'
import { dayHeading, formatAmount, formatMonth, monthRange } from '../lib/format'

/** How long typing must pause before a search is reported. */
const SEARCH_REPORT_DELAY_MS = 1500

export function LedgerScreen({ onOpen, onAdd }: { onOpen: (id: string) => void; onAdd: () => void }) {
  const [monthOffset, setMonthOffset] = useState(0)
  const [billedFilter, setBilledFilter] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')

  const all = useLiveQuery(() => db.expenses.orderBy('date').reverse().toArray(), [])
  const receiptIds = useLiveQuery(async () => new Set((await db.receipts.orderBy('expenseId').keys()) as string[]), [])
  const natures = useNatures()
  const billedTo = useBilledTo()

  const { from, to } = monthRange(monthOffset)
  const monthDate = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1)
  const q = query.trim().toLowerCase()

  const visible = useMemo(() => {
    if (!all) return []
    return all.filter((e) => {
      if (billedFilter && e.billedToId !== billedFilter) return false
      if (q) {
        const hay = [e.remarks, natures.map.get(e.natureId ?? '')?.name, billedTo.map.get(e.billedToId)?.name, formatAmount(e.amountPaise)]
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      }
      return e.date >= from && e.date <= to
    })
  }, [all, billedFilter, q, from, to, natures.map, billedTo.map])

  // Report a search once the user stops typing, not on every keystroke.
  const resultCount = visible.length
  useEffect(() => {
    if (!q) return
    const t = setTimeout(() => track('search', { search_term: scrubText(q), results_count: resultCount }), SEARCH_REPORT_DELAY_MS)
    return () => clearTimeout(t)
  }, [q, resultCount])

  const changeMonth = (direction: 'prev' | 'next' | 'current') => {
    setMonthOffset((m) => (direction === 'prev' ? m - 1 : direction === 'next' ? m + 1 : 0))
    track('month_change', { direction })
  }

  const filterBilled = (id: string | null) => {
    setBilledFilter(id)
    if (id) track('filter_company', { billed_to: scrubText(billedTo.map.get(id)?.name ?? '') })
  }

  const monthTotal = visible.reduce((s, e) => s + e.amountPaise, 0)
  const groups = useMemo(() => {
    const m = new Map<string, Expense[]>()
    for (const e of visible) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return [...m.entries()]
  }, [visible])

  const byBilled = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of visible) m.set(e.billedToId, (m.get(e.billedToId) ?? 0) + e.amountPaise)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [visible])

  if (!all) return null

  return (
    <div className="flex flex-col gap-4 px-4 pt-[max(12px,env(safe-area-inset-top))]">
      <header className="flex min-h-16 items-center gap-3">
        {searching ? (
          <div className="relative flex-1">
            <Search size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tertiary" />
            <input
              autoFocus
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search remarks, company, amount…"
              className={cx(inputClass, 'min-h-12 rounded-full pl-11 t-body-md')}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2.5">
            <img src="/icon.svg" alt="" className="size-8" />
            <span className="t-wordmark">Reimburse Me</span>
          </div>
        )}
        <IconButton
          label={searching ? 'Close search' : 'Search'}
          onClick={() => {
            setSearching(!searching)
            setQuery('')
          }}
          className="border border-hairline bg-paper"
        >
          {searching ? <X size={20} /> : <Search size={20} />}
        </IconButton>
      </header>

      {!q && (
        <Card>
          <div className="flex items-center justify-between">
            <SectionLabel>{billedFilter ? `${billedTo.map.get(billedFilter)?.name} · ` : ''}Spent in {formatMonth(monthDate)}</SectionLabel>
            <div className="-my-2 -mr-2 flex">
              <IconButton label="Previous month" onClick={() => changeMonth('prev')} className="text-secondary">
                <ChevronLeft size={20} />
              </IconButton>
              <IconButton label="Next month" disabled={monthOffset >= 0} onClick={() => changeMonth('next')} className="text-secondary disabled:opacity-30">
                <ChevronRight size={20} />
              </IconButton>
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <Rupee className="t-num-hero font-semibold text-accent" />
            <span className="t-num-hero text-ink">{formatAmount(monthTotal)}</span>
          </div>
          <div className="t-body-sm text-secondary">
            {visible.length} expense{visible.length === 1 ? '' : 's'}
            {monthOffset !== 0 && (
              <>
                {' · '}
                <button type="button" className="font-medium text-primary" onClick={() => changeMonth('current')}>
                  Back to this month
                </button>
              </>
            )}
          </div>
          {byBilled.length > 1 && !billedFilter && (
            <div className="mt-4 flex flex-col gap-2.5 border-t border-hairline pt-3">
              {byBilled.slice(0, 4).map(([id, amt]) => (
                <div key={id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate t-body-sm font-medium text-ink">{billedTo.map.get(id)?.name}</span>
                    <span className="t-num-sm text-secondary">
                      <Rupee />
                      {formatAmount(amt)}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-surface-mid">
                    <div className="h-full rounded-full bg-ink/70" style={{ width: `${Math.max(4, (amt / monthTotal) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {billedTo.list.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <FilterPill selected={billedFilter === null} onClick={() => filterBilled(null)}>
            All
          </FilterPill>
          {billedTo.list.map((b) => (
            <FilterPill key={b.id} selected={billedFilter === b.id} onClick={() => filterBilled(billedFilter === b.id ? null : b.id)}>
              {b.name}
            </FilterPill>
          ))}
        </div>
      )}

      {all.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            icon={<ReceiptText size={26} />}
            title="No expenses yet"
            body="Paid for a cab, a client lunch or office supplies? Add it here so you don't forget to claim it."
            action={
              <button type="button" onClick={onAdd} className="t-button-sm text-primary">
                Add your first expense
              </button>
            }
          />
        </Card>
      ) : groups.length === 0 ? (
        <Card className="p-2">
          <EmptyState
            title={q ? 'Nothing matches' : billedFilter ? `Nothing for ${billedTo.map.get(billedFilter)?.name ?? 'this company'}` : 'Nothing this month'}
            body={
              q
                ? `No expense mentions "${query.trim()}"${billedFilter ? ' for this company' : ''}.`
                : monthOffset === 0
                  ? 'Expenses you add this month will show up here.'
                  : `No expenses in ${formatMonth(monthDate)}${billedFilter ? ' for this company' : ''}.`
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {q && (
                  <EmptyAction
                    onClick={() => {
                      setQuery('')
                      setSearching(false)
                    }}
                  >
                    Clear search
                  </EmptyAction>
                )}
                {billedFilter && <EmptyAction onClick={() => setBilledFilter(null)}>Show all companies</EmptyAction>}
                {!q && monthOffset !== 0 && <EmptyAction onClick={() => changeMonth('current')}>Go to this month</EmptyAction>}
                {!q && !billedFilter && monthOffset === 0 && <EmptyAction onClick={onAdd}>Add an expense</EmptyAction>}
              </div>
            }
          />
        </Card>
      ) : (
        groups.map(([date, items]) => (
          <Card key={date} className="px-4 pt-3 pb-1">
            <div className="flex items-center justify-between pb-1">
              <SectionLabel>{dayHeading(date)}</SectionLabel>
              <span className="t-num-sm text-secondary">
                <Rupee />
                {formatAmount(items.reduce((s, e) => s + e.amountPaise, 0))}
              </span>
            </div>
            <ul>
              {items.map((e, i) => {
                const nature = e.natureId ? natures.map.get(e.natureId) : undefined
                const title = nature?.name ?? e.remarks ?? 'Expense'
                const sub = nature ? e.remarks : undefined
                return (
                  <li key={e.id} className={cx(i > 0 && 'border-t border-hairline')}>
                    <button type="button" onClick={() => onOpen(e.id)} className="-mx-2 flex min-h-16 w-[calc(100%+16px)] items-center gap-3 rounded-field px-2 py-2.5 text-left active:bg-pressed">
                      <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-full text-lg', nature ? TONE_CLASSES[nature.tone].tint : 'bg-surface-mid')}>
                        {nature ? nature.emoji : <Dot />}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate t-body-md font-medium text-ink">{title}</span>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Tag>{billedTo.map.get(e.billedToId)?.name ?? '—'}</Tag>
                          {sub && <span className="truncate t-body-sm text-secondary">{sub}</span>}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {receiptIds?.has(e.id) && <Paperclip size={14} className="text-tertiary" aria-label="Has receipt" />}
                        <span className="t-num-md text-ink">
                          <Rupee className="text-secondary" />
                          {formatAmount(e.amountPaise, { trimZero: true })}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
        ))
      )}
    </div>
  )
}
