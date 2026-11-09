import { useEffect, useState } from 'react'
import { getSetting, setSetting } from '../db'
import { isAnalyticsConfigured, isAnalyticsEnabled, NOTICE_KEY, useAnalyticsEnabled } from '../lib/analytics'
import { cx } from './ui'

/** One-time, non-blocking note that usage is shared with Google Analytics, above the bottom nav. */
export function AnalyticsNotice({ suppressed, raised, onOpenSettings }: { suppressed: boolean; raised: boolean; onOpenSettings: () => void }) {
  const [show, setShow] = useState(false)
  const enabled = useAnalyticsEnabled()

  useEffect(() => {
    if (!isAnalyticsConfigured() || !isAnalyticsEnabled()) return
    getSetting(NOTICE_KEY)
      .then((v) => !v && setShow(true))
      .catch(() => {})
  }, [])

  // Nothing to announce once analytics is off.
  if (!show || suppressed || !enabled) return null

  const dismiss = () => {
    setShow(false)
    setSetting(NOTICE_KEY, String(Date.now())).catch(() => {})
  }

  return (
    <div
      role="status"
      className={cx(
        'pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4',
        // Sits above the "Add expense" button on the Expenses tab.
        raised ? 'bottom-[calc(144px+env(safe-area-inset-bottom))]' : 'bottom-[calc(76px+env(safe-area-inset-bottom))]',
      )}
    >
      <div className="pointer-events-auto flex w-full max-w-[560px] animate-toast-in items-center gap-2 rounded-field bg-inverse py-2 pr-2 pl-4 text-inverse-ink shadow-lg">
        <span className="flex-1 t-body-sm">We use Google Analytics to improve Reimburse Me. Manage in Settings.</span>
        <button
          type="button"
          className="min-h-10 shrink-0 rounded-full px-3 t-button-sm text-inverse-ink/70 active:bg-white/10"
          onClick={() => {
            dismiss()
            onOpenSettings()
          }}
        >
          Settings
        </button>
        <button type="button" className="min-h-10 shrink-0 rounded-full bg-accent px-4 t-button-sm text-white" onClick={dismiss}>
          OK
        </button>
      </div>
    </div>
  )
}
