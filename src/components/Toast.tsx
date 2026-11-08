import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'

interface ToastItem {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

const Ctx = createContext<(text: string, action?: ToastItem['action']) => void>(() => {})
export const useToast = () => useContext(Ctx)

/** Inverse-ink snackbar above the bottom nav, with an optional action such as "Undo". */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null)
  const timer = useRef<number>(undefined)

  const show = useCallback((text: string, action?: ToastItem['action']) => {
    window.clearTimeout(timer.current)
    setToast({ id: Date.now(), text, action })
    timer.current = window.setTimeout(() => setToast(null), action ? 5000 : 2800)
  }, [])

  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
        {toast && (
          <div key={toast.id} className="pointer-events-auto flex min-h-12 w-full max-w-[560px] animate-toast-in items-center gap-3 rounded-field bg-inverse py-2 pr-2 pl-4 text-inverse-ink shadow-lg">
            <span className="flex-1 t-body-md">{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                className="min-h-10 rounded-full px-4 t-button-sm text-accent-soft active:bg-white/10"
                onClick={() => {
                  toast.action?.run()
                  setToast(null)
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  )
}
