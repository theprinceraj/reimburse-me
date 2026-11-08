import { X } from 'lucide-react'
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from 'react'
import type { Tone } from '../db'
import { useBackLayer } from '../lib/backstack'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

/** A white "stationery leaf" on the warm canvas, framed by a hairline instead of a shadow. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-card border border-hairline bg-paper', className ?? 'p-4')}>{children}</div>
}

/** Quieter inset panel with no frame. */
export function Inset({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-field bg-surface-low p-3', className)}>{children}</div>
}

/** Tracked, uppercase micro-heading, like a column head in a printed journal. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('t-label-caps text-secondary', className)}>{children}</div>
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; compact?: boolean }

/** The single vermilion call to action on a screen. */
export function PrimaryButton({ icon, compact, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 text-white transition-colors duration-150 select-none',
        'active:bg-accent-pressed disabled:bg-surface-highest disabled:text-tertiary disabled:cursor-not-allowed',
        compact ? 'min-h-12 t-button-sm' : 'min-h-14 t-title-md',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/** A white paper button with a hairline frame, for secondary actions. */
export function PaperButton({ icon, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-hairline bg-paper px-5 t-button-sm text-ink transition-colors duration-150 select-none',
        'active:bg-pressed disabled:text-tertiary disabled:cursor-not-allowed',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/** A low-key text button. */
export function GhostButton({ icon, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-4 t-button-sm transition-colors duration-150 active:bg-pressed',
        className ?? 'text-primary',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx('inline-flex size-10 items-center justify-center rounded-full text-ink transition-colors active:bg-pressed', className)}
    >
      {children}
    </button>
  )
}

/** Filter pill: dark ink when chosen, white paper otherwise. */
export function FilterPill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-4 t-body-sm whitespace-nowrap transition-colors duration-150',
        selected ? 'bg-ink font-medium text-surface' : 'border border-hairline bg-paper text-secondary active:bg-pressed',
      )}
    >
      {children}
    </button>
  )
}

export const TONE_CLASSES: Record<Tone, { dot: string; tint: string; ring: string }> = {
  sage: { dot: 'bg-sage', tint: 'bg-sage-tint', ring: 'ring-sage' },
  slate: { dot: 'bg-slate', tint: 'bg-mist-tint', ring: 'ring-slate' },
  coral: { dot: 'bg-coral', tint: 'bg-peach-tint', ring: 'ring-coral' },
  lavender: { dot: 'bg-lavender', tint: 'bg-lavender-tint', ring: 'ring-lavender' },
  amber: { dot: 'bg-amber', tint: 'bg-butter-tint', ring: 'ring-amber' },
  sky: { dot: 'bg-sky', tint: 'bg-sky-tint', ring: 'ring-sky' },
}

export function Dot({ tone, className }: { tone?: Tone; className?: string }) {
  return <span className={cx('inline-block shrink-0 rounded-full', tone ? TONE_CLASSES[tone].dot : 'bg-tertiary', className ?? 'size-2.5')} />
}

/** Square-cornered tag, e.g. a "Billed to" label on a ledger row. */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-block max-w-[60%] shrink-0 truncate rounded-tag bg-surface-high px-1.5 py-px t-label-caps text-[10px] text-secondary">{children}</span>
}

export function Perforation({ className }: { className?: string }) {
  return <div aria-hidden className={cx('perforation w-full', className)} />
}

/** ₹ is set in the body face because JetBrains Mono has no rupee glyph. */
export function Rupee({ className }: { className?: string }) {
  return <span className={cx('font-sans', className)}>₹</span>
}

/** Small paper pill used as the way forward inside an empty state. */
export function EmptyAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="min-h-10 rounded-full border border-hairline bg-paper px-4 t-button-sm text-primary active:bg-pressed">
      {children}
    </button>
  )
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
      {icon && <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-surface-mid text-secondary">{icon}</div>}
      <div className="t-headline-sm text-ink">{title}</div>
      {body && <p className="max-w-72 t-body-md text-secondary">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * Bottom sheet with a grabber, scrim and Escape/back-button support.
 * The Android back gesture closes the sheet instead of leaving the app.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  isDirty,
  discardLabel = 'Discard changes?',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  /** When it returns true, closing by scrim, ×, Escape or back asks before throwing work away. */
  isDirty?: () => boolean
  discardLabel?: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [generation, setGeneration] = useState(0)
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty

  const requestClose = (fromBack = false) => {
    if (dirtyRef.current?.() && !confirming) {
      setConfirming(true)
      if (fromBack) setGeneration((g) => g + 1) // the back press consumed our entry; re-arm it
      return
    }
    onClose()
  }

  useBackLayer(open, () => requestClose(true), generation)

  useEffect(() => {
    if (!open) {
      setConfirming(false)
      return
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && requestClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  })

  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 animate-fade-in bg-ink/40" onClick={() => requestClose()} />
      {confirming && (
        <div className="absolute inset-x-0 bottom-0 z-10 mx-auto w-full max-w-[600px] animate-toast-in px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2 rounded-card bg-inverse py-2 pr-2 pl-4 text-inverse-ink shadow-xl">
            <span className="flex-1 t-body-md">{discardLabel}</span>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-full px-3 t-button-sm text-inverse-ink/80 active:bg-white/10">
              Keep editing
            </button>
            <button type="button" onClick={onClose} className="min-h-11 rounded-full bg-error px-4 t-button-sm text-white">
              Discard
            </button>
          </div>
        </div>
      )}
      <div className="relative mx-auto flex max-h-[92dvh] w-full max-w-[600px] animate-sheet-in flex-col rounded-t-sheet bg-surface">
        <div className="flex justify-center pt-3 pb-1">
          <span className="h-1 w-10 rounded-full bg-surface-highest" />
        </div>
        {title && (
          <div className="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 className="t-headline-sm">{title}</h2>
            <IconButton label="Close" onClick={() => requestClose()} className="-mr-2 text-secondary">
              <X size={20} />
            </IconButton>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-hairline bg-surface px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, optional, children, htmlFor }: { label: string; optional?: boolean; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={htmlFor} className="t-label-caps text-secondary">
          {label}
        </label>
        {optional && <span className="rounded-full bg-surface-mid px-2 py-px t-label-caps text-[9px] text-tertiary">Optional</span>}
      </div>
      {children}
    </div>
  )
}

export const inputClass =
  'w-full min-h-[52px] rounded-field border border-hairline bg-paper px-4 t-body-lg text-ink placeholder:text-tertiary outline-none transition-colors focus:border-ink'
