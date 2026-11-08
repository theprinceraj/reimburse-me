import { Download, EllipsisVertical, Share, SquarePlus } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { isStandalone, useInstallPrompt } from '../hooks'
import { GhostButton, PrimaryButton, Sheet } from './ui'

const SEEN_KEY = 'install-prompt-shown'

type Platform = 'native' | 'ios' | 'manual'

/**
 * Once per visit (browser tab session), invites someone using the app in a mobile browser to
 * install it. Uses the browser's own install dialog where offered; otherwise shows the steps.
 */
export function InstallPrompt({ suppressed }: { suppressed: boolean }) {
  const { canInstall, install } = useInstallPrompt()
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const platform: Platform = canInstall ? 'native' : ios ? 'ios' : 'manual'

  // Give Chrome a moment to fire `beforeinstallprompt` so we can offer the one-tap install.
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 4000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!ready && !canInstall) return
    // Browsers only install over HTTPS; on plain HTTP there is nothing we could honestly offer.
    if (suppressed || isStandalone() || !window.isSecureContext) return
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return
      sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* private mode: still show once for this page load */
    }
    setOpen(true)
  }, [ready, canInstall, suppressed])

  return (
    <Sheet open={open} onClose={() => setOpen(false)}>
      <div className="flex flex-col items-center gap-2 pt-3 pb-1 text-center">
        <img src="/icon.svg" alt="" className="size-16" />
        <h2 className="mt-2 t-headline-md">Install Reimburse Me</h2>
        <p className="max-w-80 t-body-md text-secondary">
          Add it to your home screen to log expenses in one tap. It opens full screen and works without internet.
        </p>
      </div>

      {platform === 'ios' && (
        <ol className="mt-5 flex flex-col gap-2">
          <Step n={1} icon={<Share size={18} />}>
            Tap <b className="font-semibold">Share</b> in Safari's toolbar
          </Step>
          <Step n={2} icon={<SquarePlus size={18} />}>
            Choose <b className="font-semibold">Add to Home Screen</b>
          </Step>
        </ol>
      )}
      {platform === 'manual' && (
        <ol className="mt-5 flex flex-col gap-2">
          <Step n={1} icon={<EllipsisVertical size={18} />}>
            Open your browser's <b className="font-semibold">menu</b>
          </Step>
          <Step n={2} icon={<Download size={18} />}>
            Tap <b className="font-semibold">Install app</b> or <b className="font-semibold">Add to Home screen</b>
          </Step>
        </ol>
      )}

      <div className="mt-6 flex flex-col gap-1 pb-[max(4px,env(safe-area-inset-bottom))]">
        {platform === 'native' ? (
          <PrimaryButton
            icon={<Download size={20} />}
            onClick={async () => {
              await install()
              setOpen(false)
            }}
          >
            Install app
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={() => setOpen(false)}>Got it</PrimaryButton>
        )}
        <GhostButton onClick={() => setOpen(false)} className="text-secondary">
          {platform === 'native' ? 'Not now' : 'Maybe later'}
        </GhostButton>
      </div>
    </Sheet>
  )
}

function Step({ n, icon, children }: { n: number; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-h-14 items-center gap-3 rounded-field border border-hairline bg-paper px-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft t-num-sm text-primary">{n}</span>
      <span className="flex-1 t-body-md">{children}</span>
      <span className="text-secondary">{icon}</span>
    </li>
  )
}
