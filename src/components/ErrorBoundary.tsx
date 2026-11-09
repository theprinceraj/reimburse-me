import { Component, type ReactNode } from 'react'
import { trackError } from '../lib/analytics'
import { exportBackup } from '../lib/backup'
import { download } from '../lib/share'

/** A crash shows a way out (reload, or save a backup first) instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
    trackError(error, 'error_boundary', true)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface p-6">
        <div className="flex w-full max-w-96 flex-col items-center gap-3 text-center">
          <img src="/icon.svg" alt="" className="size-12" />
          <h1 className="t-headline-md">Something went wrong</h1>
          <p className="t-body-md text-secondary">Your expenses are safe on this phone. Reload to try again, or save a backup first if you're worried.</p>
          <button type="button" onClick={() => location.reload()} className="mt-2 min-h-14 w-full rounded-full bg-accent t-title-md text-white active:bg-accent-pressed">
            Reload app
          </button>
          <button
            type="button"
            onClick={async () => download(await exportBackup(), 'reimburse-me-backup.json')}
            className="min-h-12 w-full rounded-full border border-hairline bg-paper t-button-sm active:bg-pressed"
          >
            Save a backup
          </button>
          <p className="t-num-sm break-all text-tertiary">{this.state.error.message}</p>
        </div>
      </main>
    )
  }
}
