import { RotateCcw, Smartphone } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'

type Block = 'desktop' | 'landscape' | null

/**
 * The app is built for phones held upright. A desktop (mouse + hover, no touch) gets a QR
 * code to open the app on a phone; a phone or tablet held sideways is asked to turn upright.
 */
function detect(): Block {
  const touch = navigator.maxTouchPoints > 0 || matchMedia('(any-pointer: coarse)').matches
  const desktop = !touch && matchMedia('(hover: hover) and (pointer: fine)').matches
  if (desktop) return 'desktop'
  // Use the device orientation where available: the on-screen keyboard can make the
  // viewport wider than tall without the phone actually being turned.
  const type = screen.orientation?.type
  const landscape = type ? type.startsWith('landscape') : matchMedia('(orientation: landscape)').matches
  return landscape ? 'landscape' : null
}

export function DeviceGate({ children }: { children: ReactNode }) {
  const [block, setBlock] = useState<Block>(detect)

  useEffect(() => {
    const update = () => setBlock(detect())
    screen.orientation?.addEventListener('change', update)
    window.addEventListener('resize', update)
    return () => {
      screen.orientation?.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    if (block !== 'landscape') return
    const prev = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prev
    }
  }, [block])

  return (
    <>
      {/* Keep the app mounted under the landscape notice so an open form isn't lost. */}
      {block !== 'desktop' && <div aria-hidden={block === 'landscape'}>{children}</div>}
      {block === 'desktop' && <DesktopNotice />}
      {block === 'landscape' && <LandscapeNotice />}
    </>
  )
}

function Mark() {
  return <img src="/icon.svg" alt="" className="size-12" />
}

function DesktopNotice() {
  const [qr, setQr] = useState<string>()
  // In dev, "localhost" means nothing to a phone; point the code at this machine's LAN address.
  const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname)
  const url = isLocal && __DEV_LAN_HOST__ ? `${location.protocol}//${__DEV_LAN_HOST__}:${location.port}` : location.origin

  useEffect(() => {
    import('qrcode').then((QR) =>
      QR.toString(url, { type: 'svg', margin: 0, color: { dark: '#1C1C19', light: '#0000' }, errorCorrectionLevel: 'M' }).then(setQr),
    )
  }, [url])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface p-6">
      <div className="w-full max-w-[440px] rounded-card border border-hairline bg-paper">
        <div className="flex flex-col items-center gap-3 px-8 pt-8 pb-6 text-center">
          <Mark />
          <h1 className="t-headline-lg">Open Reimburse Me on your phone</h1>
          <p className="t-body-md text-secondary">
            This app is made for phones, so you can snap receipts and log expenses on the go. Scan the code with your phone's camera to open it.
          </p>
        </div>
        <div className="perforation" />
        <div className="flex flex-col items-center gap-4 px-8 py-7">
          <div
            className="size-44 [&>svg]:size-full"
            role="img"
            aria-label={`QR code for ${url}`}
            // biome-ignore lint: trusted SVG string generated locally by the qrcode library
            dangerouslySetInnerHTML={qr ? { __html: qr } : undefined}
          />
          <div className="flex items-center gap-2 rounded-full bg-surface-low px-3 py-1.5 t-num-sm text-secondary">
            <Smartphone size={14} />
            {url.replace(/^https?:\/\//, '')}
          </div>
        </div>
      </div>
    </main>
  )
}

function LandscapeNotice() {
  return (
    <div role="alertdialog" aria-label="Rotate your phone" className="fixed inset-0 z-[100] flex items-center justify-center bg-surface p-6">
      <div className="flex max-w-96 flex-col items-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-primary">
          <RotateCcw size={28} className="animate-[spin_2.4s_ease-in-out_infinite_reverse]" />
        </div>
        <h1 className="t-headline-md">Turn your phone upright</h1>
        <p className="t-body-md text-secondary">Reimburse Me works in portrait only. Rotate your phone and you'll be right where you left off.</p>
      </div>
    </div>
  )
}
