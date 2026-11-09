import { useSyncExternalStore } from 'react'
import type { Metric } from 'web-vitals'
import { db, getSetting, setSetting } from '../db'
import { isStandalone } from '../hooks'

/**
 * Google Analytics 4 over plain gtag.js. Events that can't go to gtag at once (offline, script still loading or
 * failed, opt-out not yet read) wait in IndexedDB and are replayed in order. Everything is a no-op without a
 * Measurement ID, and nothing is sent after the user opts out in Settings.
 */

type Param = string | number | boolean
type Clean = Record<string, Param>
export type Params = Record<string, Param | null | undefined>
export type Screen = 'expenses' | 'claim' | 'settings' | 'expense/new' | 'expense/edit' | 'receipt' | 'privacy'

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: unknown[]) => void
    [gaDisable: `ga-disable-${string}`]: boolean
  }
}

const ID = (import.meta.env.VITE_GA_MEASUREMENT_ID ?? '').trim()
const ENABLED_KEY = 'analytics_enabled'
const FIRST_TOUCH_KEY = 'analytics_first_touch'
/** Settings key set once the first-launch analytics notice has been dismissed. */
export const NOTICE_KEY = 'analytics_notice_dismissed'
const QUEUE_CAP = 500
/** The queue size is checked against QUEUE_CAP only every this many writes. */
const CAP_CHECK_EVERY = 20
const REPLAY_BATCH = 50
/** gtag's own wait for an event_callback. */
const EVENT_TIMEOUT_MS = 2000
/** The longest `trackNow` holds up a reload or a delete. */
const TRACK_NOW_MAX_MS = 800
/** Consecutive gtag.js load failures while online after which it counts as blocked for the session. */
const BLOCKED_AFTER_FAILURES = 2
/** GA4 allows 25 params per event; leave room for the page context, queued, offline_delay_sec and debug_mode. */
const MAX_PARAMS = 19

/** The address the app was opened with, captured before App.tsx strips the query (UTMs, ?add=1). */
const initialUrl = new URL(location.href)
/** Only campaign parameters from the launch query may reach GA; anything else in it stays on the phone. */
const CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid']
const campaignQuery = (() => {
  const q = new URLSearchParams()
  for (const k of CAMPAIGN_KEYS) {
    const v = initialUrl.searchParams.get(k)
    if (v) q.set(k, v)
  }
  const s = q.toString()
  return s ? `?${s}` : ''
})()
let firstPageView = true
let started = false
/** 'blocked': gtag.js failed to load twice while online (likely an ad blocker); analytics is off for the session. */
let script: 'idle' | 'loading' | 'loaded' | 'failed' | 'blocked' = 'idle'
let onlineFailures = 0
let failedOffline = false
const cachedEnabled = readCachedEnabled()
/** Whether events may be sent now. */
let enabled = cachedEnabled !== '0'
/** The user's latest choice, which `enabled` catches up with once any opt-out hit is out. */
let intent = enabled
/** False until the durable opt-out setting has been read, so a stale localStorage cache can't leak events. */
let settled = false
/** Queue writes not yet committed; events wait behind them so they keep their order. */
let unwritten = 0
let enqueued = 0
let writes: Promise<unknown> = Promise.resolve()
let flushing = false
/** Set when events are queued during a replay, so it runs again before stopping. */
let again = false
let toggles: Promise<unknown> = Promise.resolve()
const seenErrors = new Set<string>()
const subscribers = new Set<() => void>()

export const isAnalyticsConfigured = () => ID !== ''
export const isAnalyticsEnabled = () => intent
const offline = () => navigator.onLine === false

function subscribe(fn: () => void) {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** The "Share usage analytics" choice, kept in sync across components. */
export const useAnalyticsEnabled = () => useSyncExternalStore(subscribe, isAnalyticsEnabled)

/** The boot-time cache of the opt-out: '1', '0', or null when missing or unreadable. */
function readCachedEnabled(): string | null {
  try {
    return localStorage.getItem(ENABLED_KEY)
  } catch {
    return null
  }
}

/** Removes personal details from free text before it leaves the phone, then fits GA4's 100-char limit. */
const REDACT: RegExp[] = [
  /\b(?:https?:\/\/|www\.)\S+/gi, // URLs
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g, // emails and UPI IDs (name@bank)
  /\b[A-Z]{5}\d{4}[A-Z]\b/gi, // PAN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // Aadhaar-like 12 digits
  /(?:\+|\b)(?:91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, // Indian mobile
  /\+\d{1,3}[\s-]?\d[\d\s-]{6,}\d/g, // international phone
  /\d{6,}/g, // any other long number (account, card, landline)
  /(?:\d[\s-]?){8,}\d/g, // spaced or dashed numbers, e.g. phone numbers typed in groups
]

export function scrubText(s: string): string {
  let out = s
  for (const re of REDACT) out = out.replace(re, '[redacted]')
  return out.replace(/\s+/g, ' ').trim().slice(0, 100)
}

function clean(params: Params = {}): Clean {
  const out: Clean = {}
  let n = 0
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || n >= MAX_PARAMS) continue
    const max = k === 'page_location' || k === 'page_referrer' ? 1000 : k === 'page_title' ? 300 : 100
    out[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, max) : v
    n++
  }
  return out
}

function gtagEvent(name: string, params: Clean, onSent?: () => void) {
  const p: Record<string, unknown> = import.meta.env.DEV ? { ...params, debug_mode: true } : { ...params }
  if (onSent) {
    p.event_callback = onSent
    p.event_timeout = EVENT_TIMEOUT_MS
  }
  window.gtag('event', name.slice(0, 40), p)
}

/** Whether gtag.js is ready, the opt-out is settled and we're online, so the queue can be replayed. */
const canReplay = () => script === 'loaded' && settled && !offline()
/** Whether an event would go straight to gtag rather than behind older events in IndexedDB. */
const canSendNow = () => canReplay() && !flushing && unwritten === 0

function dispatch(name: string, params: Clean) {
  if (!ID || !enabled || script === 'blocked') return
  if (canSendNow()) gtagEvent(name, params)
  else enqueue(name, params)
}

/** Saves an event to IndexedDB at once (so a closed tab can't lose it), then replays the queue if possible. */
function enqueue(name: string, params: Clean) {
  const row = { name, params, queued_at: Date.now(), offline: offline() || script === 'failed' }
  const checkCap = ++enqueued % CAP_CHECK_EVERY === 0
  unwritten++
  writes = writes
    .then(async () => {
      await db.analyticsQueue.add(row)
      if (!checkCap) return
      const extra = (await db.analyticsQueue.count()) - QUEUE_CAP
      if (extra > 0) await db.analyticsQueue.bulkDelete(await db.analyticsQueue.orderBy(':id').limit(extra).primaryKeys())
    })
    .catch(() => {})
    .finally(() => {
      unwritten--
      // Not awaited: flush itself waits on `writes`.
      if (canReplay()) flush()
    })
}

async function flush() {
  if (!enabled || !canReplay()) return
  if (flushing) {
    again = true
    return
  }
  flushing = true
  try {
    do {
      again = false
      for (;;) {
        await writes
        if (!enabled || offline()) return
        const batch = await db.analyticsQueue.orderBy(':id').limit(REPLAY_BATCH).toArray()
        if (!batch.length) break
        // Delete first: a crash mid-replay may lose events, but never sends one (e.g. expense_add) twice.
        await db.analyticsQueue.bulkDelete(batch.map((e) => e.id))
        const now = Date.now()
        for (const e of batch) {
          // Events that only waited for gtag.js to load aren't reported as queued.
          const extra: Clean = e.offline ? { queued: true, offline_delay_sec: Math.max(0, Math.round((now - e.queued_at) / 1000)) } : {}
          gtagEvent(e.name, { ...e.params, ...extra })
        }
      }
    } while (again || unwritten > 0)
  } catch {
    /* IndexedDB unavailable: nothing to replay */
  } finally {
    flushing = false
  }
}

function loadScript() {
  if (script !== 'idle' && script !== 'failed') return
  script = 'loading'
  document.querySelector('script[data-gtag]')?.remove()
  const s = document.createElement('script')
  s.async = true
  // googletagmanager.com serves CORS headers, so the SW caches a real 200 rather than a padded opaque response.
  s.crossOrigin = 'anonymous'
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ID)}`
  s.dataset.gtag = ''
  s.onload = () => {
    script = 'loaded'
    onlineFailures = 0
    flush()
  }
  s.onerror = () => {
    failedOffline = offline()
    if (!failedOffline && ++onlineFailures >= BLOCKED_AFTER_FAILURES) {
      // Likely an ad blocker: stop collecting rather than fill IndexedDB with events that will never send.
      script = 'blocked'
      writes = writes.then(() => db.analyticsQueue.clear()).catch(() => {})
    } else script = 'failed'
  }
  document.head.appendChild(s)
}

/** A failed load is retried on `online`, and also when the app is shown again if it failed while online. */
function retry(e: Event) {
  if (!enabled) return
  if (script === 'failed') {
    if (e.type === 'online' || !failedOffline) loadScript()
  } else flush()
}

function consentState(on: boolean) {
  const v = on ? 'granted' : 'denied'
  return { analytics_storage: v, ad_storage: v, ad_user_data: v, ad_personalization: v }
}

/** Applies an on/off choice locally: consent, the GA kill switch, the boot-time cache and the queue. */
function apply(on: boolean) {
  enabled = on
  intent = on
  for (const fn of subscribers) fn()
  try {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0')
  } catch {
    /* private mode: the settings table still has it */
  }
  if (!started) return
  window[`ga-disable-${ID}`] = !on
  window.gtag('consent', 'update', consentState(on))
  if (on) loadScript()
  else writes = writes.then(() => db.analyticsQueue.clear()).catch(() => {})
}

/** Each event carries the page it happened on, so events replayed later still report the right screen. */
export function track(name: string, params?: Params) {
  dispatch(name, clean({ ...context(), ...params }))
}

/**
 * Like `track`, but resolves once the hit is handed to gtag or saved to IndexedDB, for use right before a reload.
 * Never waits longer than TRACK_NOW_MAX_MS.
 */
export function trackNow(name: string, params?: Params): Promise<void> {
  return new Promise((resolve) => {
    if (!ID || !enabled || script === 'blocked') return resolve()
    setTimeout(resolve, TRACK_NOW_MAX_MS)
    const p = clean({ ...context(), ...params })
    if (canSendNow()) gtagEvent(name, p, () => resolve())
    else {
      enqueue(name, p)
      writes.then(() => resolve())
    }
  })
}

const TITLES: Record<Screen, string> = {
  expenses: 'Expenses',
  claim: 'Claim',
  settings: 'Settings',
  'expense/new': 'New expense',
  'expense/edit': 'Edit expense',
  receipt: 'Receipt',
  privacy: 'Privacy',
}

/** The current tab, and the sheets or viewers open over it (topmost last). */
let tab: Screen | undefined
const overlays: Screen[] = []

function page(screen: Screen) {
  const page_path = `/${screen}`
  return { page_title: `${TITLES[screen]} · Reimburse Me`, page_location: initialUrl.origin + page_path, page_path }
}

/** Page context for events. Before the first screen, gtag falls back to the config's launch URL. */
function context() {
  const top = overlays[overlays.length - 1] ?? tab
  return top ? page(top) : {}
}

function sendPageView(screen: Screen) {
  const p = page(screen)
  // Only the first page view carries the launch URL's campaign parameters (UTMs, gclid), even if it isn't sent.
  if (firstPageView) {
    if (ID && enabled) p.page_location += campaignQuery
    firstPageView = false
  }
  track('page_view', p)
}

/** Virtual page view for a tab. Sheets already open over it stay the current context. */
export function pageView(screen: Screen) {
  tab = screen
  sendPageView(screen)
}

/** Page view for a sheet or viewer over the current tab. Call the returned function when it closes. */
export function overlayView(screen: Screen): () => void {
  overlays.push(screen)
  sendPageView(screen)
  return () => {
    const i = overlays.lastIndexOf(screen)
    if (i !== -1) overlays.splice(i, 1)
  }
}

export function setUserProps(props: Params) {
  if (!started) return
  window.gtag('set', 'user_properties', clean(props))
}

const bucket = (n: number) => (n === 0 ? '0' : n <= 5 ? '1-5' : n <= 20 ? '6-20' : n <= 100 ? '21-100' : '100+')

/** Recomputes the user properties that change over time; call after adding or removing expenses. */
export async function refreshUserProps() {
  if (!started) return
  try {
    const [persisted, count] = await Promise.all([navigator.storage?.persisted?.() ?? Promise.resolve(false), db.expenses.count()])
    setUserProps({ storage_persisted: persisted ? 'yes' : 'no', expense_count_bucket: bucket(count) })
  } catch {
    /* storage unavailable */
  }
}

/** Dev and prod share one GA4 property; anything other than a production build on the live domain counts as dev. */
const PROD_HOST = 'reimburse-me.theprinceraj.in'
const appEnv = () => (!import.meta.env.DEV && location.hostname === PROD_HOST ? 'prod' : 'dev')

const displayMode = () => (isStandalone() ? 'standalone' : 'browser')

function platform() {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'other'
}

export function trackError(err: unknown, context: string, fatal = false) {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  const description = scrubText(raw)
  if (seenErrors.has(description)) return
  seenErrors.add(description)
  track('exception', { description, fatal, context })
}

/** Records the choice at once (for the UI), then applies changes one at a time, skipping superseded ones. */
export function setAnalyticsEnabled(on: boolean): Promise<unknown> {
  intent = on
  for (const fn of subscribers) fn()
  toggles = toggles
    .then(async () => {
      if (intent !== on || on === enabled) return
      // Only sent when it can go out at once: a queued one would be deleted with the queue by apply(false).
      if (!on && canSendNow()) await trackNow('analytics_opt_out')
      if (intent !== on) return
      apply(on)
      await setSetting(ENABLED_KEY, on ? '1' : '0').catch(() => {})
      if (on) track('analytics_opt_in')
    })
    .catch(() => {})
  return toggles
}

/** First ever launch on this device: keep the first touch and report it once. */
async function recordFirstLaunch() {
  if (await getSetting(FIRST_TOUCH_KEY)) return
  const q = initialUrl.searchParams
  let referrer = ''
  try {
    referrer = document.referrer ? new URL(document.referrer).hostname : ''
  } catch {
    /* malformed referrer */
  }
  const touch = {
    source: q.get('utm_source'),
    medium: q.get('utm_medium'),
    campaign: q.get('utm_campaign'),
    term: q.get('utm_term'),
    content: q.get('utm_content'),
    gclid: q.get('gclid'),
    referrer,
    at: Date.now(),
  }
  const existing = await db.expenses.count()
  track('first_launch', {
    first_source: touch.source ? scrubText(touch.source) : undefined,
    first_medium: touch.medium ? scrubText(touch.medium) : undefined,
    first_campaign: touch.campaign ? scrubText(touch.campaign) : undefined,
    first_term: touch.term ? scrubText(touch.term) : undefined,
    first_content: touch.content ? scrubText(touch.content) : undefined,
    has_gclid: !!touch.gclid,
    referrer_host: referrer || undefined,
    display_mode: displayMode(),
    // Installs from before analytics existed report their first launch on upgrade.
    existing_data: existing > 0,
  })
  // Marked as reported only once the event is sent or saved to the queue, so a closed tab can't lose it
  // (at worst it is reported twice).
  await writes
  await setSetting(FIRST_TOUCH_KEY, JSON.stringify(touch))
}

/** Call once, before the app renders, so gtag sees the launch URL before App.tsx cleans it. */
export function initAnalytics() {
  if (!ID || started) return
  started = true
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    // gtag.js only accepts the `arguments` object itself.
    // biome-ignore lint: required by gtag.js
    window.dataLayer.push(arguments)
  }
  window[`ga-disable-${ID}`] = !enabled
  window.gtag('consent', 'default', consentState(enabled))
  window.gtag('js', new Date())
  window.gtag('config', ID, {
    send_page_view: false,
    allow_google_signals: true,
    app_version: __APP_VERSION__,
    page_location: initialUrl.origin + initialUrl.pathname + campaignQuery,
  })
  setUserProps({ display_mode: displayMode(), app_version: __APP_VERSION__, platform: platform(), app_env: appEnv() })
  // Without a cached '1' (first run, cleared storage), wait for the durable setting before loading gtag.js.
  if (enabled && cachedEnabled === '1') loadScript()

  window.addEventListener('online', retry)
  document.addEventListener('visibilitychange', (e) => document.visibilityState === 'visible' && retry(e))
  window.addEventListener('error', (e) => trackError(e.error ?? e.message, 'window_error'))
  window.addEventListener('unhandledrejection', (e) => trackError(e.reason, 'unhandled_rejection'))
  window.addEventListener('appinstalled', () => track('app_installed', { platform: platform() }))

  const vital = (m: Metric) =>
    track('web_vitals', {
      metric_name: m.name,
      metric_value: Math.round(m.value * 1000) / 1000,
      metric_rating: m.rating,
      metric_id: m.id,
    })
  import('web-vitals')
    .then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
      onCLS(vital)
      onFCP(vital)
      onINP(vital)
      onLCP(vital)
      onTTFB(vital)
    })
    .catch(() => {})

  track('app_open', { display_mode: displayMode(), launch_source: initialUrl.searchParams.has('add') ? 'shortcut' : 'normal' })

  // The settings table is the durable copy of the opt-out; localStorage is only a fast cache.
  getSetting(ENABLED_KEY)
    .then((v) => {
      if (v === undefined) return setSetting(ENABLED_KEY, enabled ? '1' : '0')
      if ((v === '1') !== enabled) apply(v === '1')
    })
    .catch(() => {})
    .finally(() => {
      settled = true
      if (enabled && script === 'idle') loadScript()
      flush()
    })
  recordFirstLaunch().catch(() => {})
  refreshUserProps()
}
