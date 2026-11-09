import { FileOutput, Plus, ReceiptText, Settings as SettingsIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { AnalyticsNotice } from './components/AnalyticsNotice'
import { cx, PrimaryButton } from './components/ui'
import { InstallPrompt } from './components/InstallPrompt'
import { ToastProvider } from './components/Toast'
import { requestPersistence } from './db'
import { pageView, track, trackNow } from './lib/analytics'
import { ClaimScreen } from './screens/ClaimScreen'
import { ExpenseSheet } from './screens/ExpenseSheet'
import { LedgerScreen } from './screens/LedgerScreen'
import { SettingsScreen } from './screens/SettingsScreen'

type Tab = 'expenses' | 'claim' | 'settings'

export function App() {
  const [tab, setTab] = useState<Tab>('expenses')
  // `undefined` = closed, `null` = new expense, string = editing that id.
  const [editing, setEditing] = useState<string | null | undefined>(() =>
    new URLSearchParams(location.search).has('add') ? null : undefined,
  )

  useEffect(() => {
    if (location.search) history.replaceState(null, '', location.pathname)
    requestPersistence()
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
    pageView(tab)
  }, [tab])

  return (
    <ToastProvider>
      <div className="mx-auto min-h-dvh max-w-[600px] pb-[calc(160px+env(safe-area-inset-bottom))]">
        {tab === 'expenses' && <LedgerScreen onOpen={setEditing} onAdd={() => setEditing(null)} />}
        {tab === 'claim' && (
          <ClaimScreen
            onAddExpense={() => {
              setTab('expenses')
              setEditing(null)
            }}
            onOpenSettings={() => setTab('settings')}
          />
        )}
        {tab === 'settings' && <SettingsScreen />}
      </div>

      {tab === 'expenses' && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex justify-center px-4">
          <PrimaryButton
            className="pointer-events-auto shadow-[0_6px_20px_-6px_rgba(181,38,3,0.55)]"
            icon={<Plus size={22} strokeWidth={2.4} />}
            onClick={() => setEditing(null)}
          >
            Add expense
          </PrimaryButton>
        </div>
      )}

      <BottomNav tab={tab} onChange={setTab} />
      <ExpenseSheet editing={editing} onClose={() => setEditing(undefined)} />
      <InstallPrompt suppressed={editing !== undefined} />
      <AnalyticsNotice suppressed={editing !== undefined} raised={tab === 'expenses'} onOpenSettings={() => setTab('settings')} />
      <UpdatePrompt />
    </ToastProvider>
  )
}

function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'expenses', label: 'Expenses', icon: <ReceiptText size={22} /> },
    { id: 'claim', label: 'Claim', icon: <FileOutput size={22} /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon size={22} /> },
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface/95 pb-safe backdrop-blur" aria-label="Main">
      <div className="mx-auto flex max-w-[600px]">
        {items.map((it) => {
          const active = it.id === tab
          return (
            <button
              key={it.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onChange(it.id)}
              className="flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5"
            >
              <span
                className={cx(
                  'flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200',
                  active ? 'bg-accent-soft text-primary' : 'text-secondary',
                )}
              >
                {it.icon}
              </span>
              <span className={cx('t-body-sm', active ? 'font-semibold text-ink' : 'text-secondary')}>{it.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  useEffect(() => {
    if (needRefresh) track('sw_update_available')
  }, [needRefresh])
  if (!needRefresh) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[max(12px,env(safe-area-inset-top))]">
      <div className="flex w-full max-w-[560px] animate-toast-in items-center gap-3 rounded-field bg-inverse py-2 pr-2 pl-4 text-inverse-ink shadow-lg">
        <span className="flex-1 t-body-md">A new version is ready.</span>
        <button
          type="button"
          className="min-h-10 rounded-full px-3 t-button-sm text-inverse-ink/70"
          onClick={() => {
            setNeedRefresh(false)
            track('sw_update_later')
          }}
        >
          Later
        </button>
        <button
          type="button"
          className="min-h-10 rounded-full bg-accent px-4 t-button-sm text-white"
          onClick={async () => {
            await trackNow('sw_update_applied')
            updateServiceWorker(true)
          }}
        >
          Reload
        </button>
      </div>
    </div>
  )
}
