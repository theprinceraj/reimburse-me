import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { type BilledTo, db, type Nature } from './db'
import { EMPTY_PROFILE, type Profile } from './lib/claim'

export function useNatures() {
  const list = useLiveQuery(() => db.natures.orderBy('order').toArray(), []) ?? []
  const map = useMemo(() => new Map<string, Nature>(list.map((n) => [n.id, n])), [list])
  return { list, map }
}

export function useBilledTo() {
  const list = useLiveQuery(() => db.billedTo.orderBy('lastUsedAt').reverse().toArray(), []) ?? []
  const map = useMemo(() => new Map<string, BilledTo>(list.map((b) => [b.id, b])), [list])
  return { list, map }
}

export function useProfile(): Profile {
  const row = useLiveQuery(() => db.settings.get('profile'), [])
  return useMemo(() => (row ? { ...EMPTY_PROFILE, ...JSON.parse(row.value) } : EMPTY_PROFILE), [row])
}

/** Object URL for a receipt blob, revoked when the component unmounts or the blob changes. */
export function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferredInstall: InstallEvent | null = null
const listeners = new Set<() => void>()
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredInstall = e as InstallEvent
  for (const l of listeners) l()
})
window.addEventListener('appinstalled', () => {
  deferredInstall = null
  for (const l of listeners) l()
})

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/** The browser's "Add to home screen" prompt, when it has offered one. */
export function useInstallPrompt() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return {
    canInstall: !!deferredInstall,
    install: async () => {
      if (!deferredInstall) return false
      await deferredInstall.prompt()
      const { outcome } = await deferredInstall.userChoice
      deferredInstall = null
      force((n) => n + 1)
      return outcome === 'accepted'
    },
  }
}
