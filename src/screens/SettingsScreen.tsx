import { useLiveQuery } from 'dexie-react-hooks'
import { Building2, Check, ChevronRight, Download, HardDrive, Pencil, Plus, RotateCcw, ShieldCheck, Smartphone, Tag as TagIcon, Trash2, Upload, User, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { Card, Field, IconButton, Inset, PaperButton, PrimaryButton, SectionLabel, Sheet, TONE_CLASSES, cx, inputClass } from '../components/ui'
import { db, newId, PRESET_NATURES, requestPersistence, setSetting, TONES, wipeAllData } from '../db'
import { isStandalone, useBilledTo, useInstallPrompt, useNatures, useProfile } from '../hooks'
import { isAnalyticsConfigured, overlayView, refreshUserProps, scrubText, track, trackNow } from '../lib/analytics'
import { exportBackup, importBackup } from '../lib/backup'
import type { Profile } from '../lib/claim'
import { todayIso } from '../lib/format'
import { download } from '../lib/share'

/** The Settings install card reports being shown once per app session. */
let installCardShown = false

export function SettingsScreen() {
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const sharing = isAnalyticsConfigured()
  return (
    <div className="flex flex-col gap-6 px-4 pt-[max(20px,env(safe-area-inset-top))]">
      <header className="pt-2">
        <h1 className="t-headline-lg">Settings</h1>
      </header>
      <InstallCard />
      <ProfileSection />
      <BilledToSection />
      <NatureSection />
      <DataSection />
      {isAnalyticsConfigured() && <PrivacySection onOpenPrivacy={() => setPrivacyOpen(true)} />}
      <p className="pb-4 text-center t-body-sm text-tertiary">
        Reimburse Me · v{__APP_VERSION__}
        <br />
        Expenses and receipts are stored on this phone.{' '}
        {sharing && 'Usage and expense details are shared with Google Analytics to improve the app.'}
        {isAnalyticsConfigured() && (
          <>
            {' '}
            <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={() => setPrivacyOpen(true)}>
              Privacy
            </button>
          </>
        )}
      </p>
      <PrivacySheet open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  )
}

function Section({ icon, title, children, hint }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1 text-secondary">
        {icon}
        <SectionLabel>{title}</SectionLabel>
      </div>
      {children}
      {hint && <p className="px-1 t-body-sm text-tertiary">{hint}</p>}
    </section>
  )
}

function InstallCard() {
  const { canInstall, install } = useInstallPrompt()
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const visible = !isStandalone() && window.isSecureContext
  // Wait a moment so a late `beforeinstallprompt` still reports the right method.
  useEffect(() => {
    if (!visible || installCardShown) return
    const t = setTimeout(() => {
      installCardShown = true
      track('install_prompt_shown', { surface: 'settings', install_method: canInstall ? 'native' : ios ? 'ios' : 'manual' })
    }, 1500)
    return () => clearTimeout(t)
  }, [visible, canInstall, ios])
  if (!visible) return null
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-field bg-accent-soft text-primary">
        <Smartphone size={22} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="t-title-md">Add to home screen</span>
        <span className="t-body-sm text-secondary">{canInstall ? 'Opens like an app and works offline.' : ios ? 'In Safari, tap Share, then "Add to Home Screen".' : 'Open the browser menu, then "Install app" or "Add to Home screen".'}</span>
      </div>
      {canInstall && (
        <PrimaryButton
          compact
          onClick={async () => {
            const accepted = await install()
            track('install_prompt_result', { outcome: accepted ? 'accepted' : 'dismissed', surface: 'settings' })
          }}
        >
          Install
        </PrimaryButton>
      )}
    </Card>
  )
}

function ProfileSection() {
  const saved = useProfile()
  const [p, setP] = useState<Profile>(saved)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setP(saved)
  }, [saved])
  const latest = useRef(p)
  latest.current = p
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => {
      setSetting('profile', JSON.stringify(p))
      dirty.current = false
    }, 400)
    return () => clearTimeout(t)
  }, [p])
  // Switching tab within the debounce window must not lose what was typed.
  useEffect(
    () => () => {
      if (dirty.current) setSetting('profile', JSON.stringify(latest.current))
    },
    [],
  )

  const field = (k: keyof Profile, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label} htmlFor={`p-${k}`}>
      <input
        id={`p-${k}`}
        value={p[k]}
        onChange={(e) => {
          dirty.current = true
          setP({ ...p, [k]: e.target.value })
        }}
        className={inputClass}
        {...props}
      />
    </Field>
  )

  return (
    <Section icon={<User size={16} />} title="You" hint="Printed at the top of every claim PDF.">
      <Card className="flex flex-col gap-4 p-4">
        {field('name', 'Full name', { autoComplete: 'name', autoCapitalize: 'words', placeholder: 'Priya Sharma' })}
        <div className="grid grid-cols-2 gap-3">
          {field('employeeId', 'Employee ID', { placeholder: 'EMP-1042', autoCapitalize: 'characters' })}
          {field('department', 'Department', { placeholder: 'Sales', autoCapitalize: 'words' })}
        </div>
        {field('email', 'Work email', { type: 'email', inputMode: 'email', autoComplete: 'email', placeholder: 'priya@company.com' })}
      </Card>
    </Section>
  )
}

function EditableRow({ label, meta, onRename, onDelete, leading }: { label: string; meta?: string; leading?: ReactNode; onRename: (v: string) => Promise<string | void>; onDelete?: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(label)
  const [err, setErr] = useState<string>()
  const [confirm, setConfirm] = useState(false)

  async function commit() {
    const v = value.trim()
    if (!v || v === label) return setEditing(false)
    const e = await onRename(v)
    if (e) return setErr(e)
    setEditing(false)
  }

  if (editing)
    return (
      <div className="flex flex-col gap-1 py-2">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setErr(undefined)
            }}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            maxLength={60}
            className={cx(inputClass, 'min-h-11 t-body-md')}
          />
          <IconButton label="Save" onClick={commit} className="bg-ink text-surface">
            <Check size={18} />
          </IconButton>
          <IconButton
            label="Cancel"
            onClick={() => {
              setEditing(false)
              setValue(label)
              setErr(undefined)
            }}
          >
            <X size={18} />
          </IconButton>
        </div>
        {err && <p className="t-body-sm text-error">{err}</p>}
      </div>
    )

  return (
    <div className="flex min-h-14 items-center gap-3">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate t-body-md font-medium">{label}</span>
        {meta && <span className="t-body-sm text-secondary">{meta}</span>}
      </div>
      {confirm ? (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setConfirm(false)} className="min-h-9 rounded-full px-3 t-body-sm text-secondary">
            Keep
          </button>
          <button type="button" onClick={onDelete} className="min-h-9 rounded-full bg-error px-3 t-body-sm font-semibold text-white">
            Delete
          </button>
        </div>
      ) : (
        <>
          <IconButton label={`Rename ${label}`} onClick={() => setEditing(true)} className="text-secondary">
            <Pencil size={17} />
          </IconButton>
          {onDelete && (
            <IconButton label={`Delete ${label}`} onClick={() => setConfirm(true)} className="text-secondary">
              <Trash2 size={17} />
            </IconButton>
          )}
        </>
      )}
    </div>
  )
}

function BilledToSection() {
  const { list } = useBilledTo()
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>()
    for (const k of (await db.expenses.orderBy('billedToId').keys()) as string[]) m.set(k, (m.get(k) ?? 0) + 1)
    return m
  }, [])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const toast = useToast()

  async function add() {
    const v = name.trim()
    if (!v) return setAdding(false)
    if (list.some((b) => b.name.toLowerCase() === v.toLowerCase())) return toast(`"${v}" is already in the list`)
    await db.billedTo.add({ id: newId(), name: v, createdAt: Date.now(), lastUsedAt: 0 })
    track('billed_to_create', { billed_to: scrubText(v), surface: 'settings' })
    setName('')
    setAdding(false)
  }

  return (
    <Section icon={<Building2 size={16} />} title="Billed to" hint="Companies, clients or projects you claim from. One in use can be renamed but not deleted.">
      <Card className="px-4 py-1">
        {list.length === 0 && !adding && <p className="py-4 t-body-md text-secondary">None yet. They're saved as you add expenses.</p>}
        <div className="divide-y divide-hairline">
          {list.map((b) => {
            const n = counts?.get(b.id) ?? 0
            return (
              <EditableRow
                key={b.id}
                label={b.name}
                meta={counts === undefined ? ' ' : n ? `${n} expense${n === 1 ? '' : 's'}` : 'Not used yet'}
                onRename={async (v) => {
                  if (list.some((x) => x.id !== b.id && x.name.toLowerCase() === v.toLowerCase())) return 'That name is already in the list'
                  await db.billedTo.update(b.id, { name: v })
                  track('billed_to_rename')
                }}
                onDelete={counts === undefined || n ? undefined : () => db.billedTo.delete(b.id).then(() => track('billed_to_delete'))}
              />
            )
          })}
        </div>
        {adding ? (
          <div className="flex items-center gap-2 border-t border-hairline py-3">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Company, client or project" maxLength={60} className={cx(inputClass, 'min-h-11 t-body-md')} />
            <IconButton label="Add" onClick={add} className="bg-ink text-surface">
              <Check size={18} />
            </IconButton>
            <IconButton
              label="Cancel"
              onClick={() => {
                setAdding(false)
                setName('')
              }}
            >
              <X size={18} />
            </IconButton>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={cx('flex min-h-12 w-full items-center gap-2 t-button-sm text-primary', list.length > 0 && 'border-t border-hairline')}>
            <Plus size={18} /> Add company
          </button>
        )}
      </Card>
    </Section>
  )
}

const EMOJI_CHOICES = ['🏷️', '🚗', '🚆', '✈️', '🅿️', '☕', '🍽️', '🖨️', '💻', '📚', '🎓', '🏥', '📮', '🎁', '🧾', '🛠️']

function NatureSection() {
  const { list } = useNatures()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🏷️')
  const toast = useToast()
  const presetIds = new Set(PRESET_NATURES.map((n) => n.id))
  const missingPresets = PRESET_NATURES.filter((p) => !list.some((n) => n.id === p.id))

  async function restorePresets() {
    await db.natures.bulkAdd(missingPresets.map((p, i) => ({ ...p, order: list.length + i })))
    toast('Built-in natures restored')
    track('nature_reset', { restored_count: missingPresets.length })
  }

  async function add() {
    const v = name.trim()
    if (!v) return
    if (list.some((n) => n.name.toLowerCase() === v.toLowerCase())) return toast(`"${v}" already exists`)
    const tone = TONES[list.length % TONES.length] ?? 'slate'
    await db.natures.add({ id: newId(), name: v, emoji, tone, builtIn: false, order: list.length })
    track('nature_create', { nature_name: scrubText(v), tone, surface: 'settings' })
    setName('')
    setEmoji('🏷️')
    setAdding(false)
  }

  async function remove(id: string) {
    await db.transaction('rw', db.natures, db.expenses, async () => {
      await db.expenses.where('natureId').equals(id).modify((e) => {
        delete e.natureId
      })
      await db.natures.delete(id)
    })
    track('nature_delete', { nature_is_custom: !presetIds.has(id) })
  }

  return (
    <Section icon={<TagIcon size={16} />} title="Nature of expense" hint="Deleting one clears it from past expenses; the expenses themselves stay.">
      <Card className="px-4 py-1">
        <div className="divide-y divide-hairline">
          {list.map((n) => (
            <EditableRow
              key={n.id}
              label={n.name}
              meta={presetIds.has(n.id) ? 'Built in' : 'Custom'}
              leading={<span className={cx('flex size-9 shrink-0 items-center justify-center rounded-full', TONE_CLASSES[n.tone].tint)}>{n.emoji}</span>}
              onRename={async (v) => {
                if (list.some((x) => x.id !== n.id && x.name.toLowerCase() === v.toLowerCase())) return 'That name already exists'
                await db.natures.update(n.id, { name: v })
                track('nature_edit', { nature_is_custom: !presetIds.has(n.id) })
              }}
              onDelete={() => remove(n.id)}
            />
          ))}
        </div>
        {missingPresets.length > 0 && !adding && (
          <button type="button" onClick={restorePresets} className="flex min-h-12 w-full items-center gap-2 border-t border-hairline t-button-sm text-secondary">
            <RotateCcw size={16} /> Restore {missingPresets.length} built-in {missingPresets.length === 1 ? 'nature' : 'natures'}
          </button>
        )}
        {adding ? (
          <div className="flex flex-col gap-3 border-t border-hairline py-3">
            <div className="flex items-center gap-2">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="e.g. Parking" maxLength={30} className={cx(inputClass, 'min-h-11 t-body-md')} />
              <IconButton label="Add" onClick={add} className="bg-ink text-surface">
                <Check size={18} />
              </IconButton>
              <IconButton label="Cancel" onClick={() => setAdding(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((e) => (
                <button key={e} type="button" onClick={() => setEmoji(e)} aria-pressed={emoji === e} className={cx('flex size-10 items-center justify-center rounded-full text-lg', emoji === e ? 'bg-ink/10 ring-2 ring-ink' : 'bg-surface-low')}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="flex min-h-12 w-full items-center gap-2 border-t border-hairline t-button-sm text-primary">
            <Plus size={18} /> Add nature
          </button>
        )}
      </Card>
    </Section>
  )
}

function DataSection() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [usage, setUsage] = useState<string>()
  const [persisted, setPersisted] = useState<boolean>()
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<File>()
  const count = useLiveQuery(() => db.expenses.count(), [])

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => e.usage !== undefined && setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB`))
    navigator.storage?.persisted?.().then(setPersisted)
  }, [count])

  return (
    <Section icon={<HardDrive size={16} />} title="Your data">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between">
          <span className="t-body-md">
            {count ?? 0} expense{count === 1 ? '' : 's'}
            {usage && <span className="text-secondary"> · {usage} used</span>}
          </span>
          {persisted === true && <span className="t-body-sm text-positive">● Protected storage</span>}
        </div>
        {persisted === false && (
          <Inset className="flex items-center gap-3">
            <p className="flex-1 t-body-sm text-secondary">Your browser may clear this data if the phone runs low on space.</p>
            <button
              type="button"
              className="min-h-10 shrink-0 rounded-full bg-ink px-4 t-button-sm text-surface"
              onClick={async () => {
                const ok = await requestPersistence()
                setPersisted(ok)
                track('storage_persist_request', { granted: ok })
                refreshUserProps()
                toast(ok ? 'Storage protected' : isStandalone() ? 'Your browser declined. Keep regular backups.' : 'Install the app first, then try again.')
              }}
            >
              Protect
            </button>
          </Inset>
        )}
        <Inset>
          <p className="t-body-sm text-secondary">Expenses and receipts are kept only on this phone, with no cloud copy. Make a backup now and then, especially before changing phones or clearing browser data.</p>
        </Inset>
        <div className="grid grid-cols-2 gap-2">
          <PaperButton
            icon={<Download size={17} />}
            onClick={async () => {
              try {
                const blob = await exportBackup()
                download(blob, `reimburse-me-backup-${todayIso()}.json`)
                toast('Backup saved to downloads')
                track('backup_export', { expense_count: count ?? 0, receipt_count: await db.receipts.count(), size_kb: Math.round(blob.size / 1024) })
              } catch {
                toast("Couldn't create the backup. Please try again.")
              }
            }}
          >
            Backup
          </PaperButton>
          <PaperButton icon={<Upload size={17} />} onClick={() => fileRef.current?.click()}>
            Restore
          </PaperButton>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            setPendingRestore(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {pendingRestore && (
          <Inset className="flex flex-col gap-2 bg-accent-soft/60">
            <p className="t-body-sm text-on-accent-soft">Restoring replaces everything on this phone with the backup "{pendingRestore.name}".</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="min-h-10 rounded-full px-4 t-button-sm text-secondary" onClick={() => setPendingRestore(undefined)}>
                Cancel
              </button>
              <button
                type="button"
                className="min-h-10 rounded-full bg-ink px-4 t-button-sm text-surface"
                onClick={async () => {
                  try {
                    const n = await importBackup(pendingRestore)
                    toast(`Restored ${n} expense${n === 1 ? '' : 's'}`)
                    track('backup_restore', { success: true, expense_count: n })
                    refreshUserProps()
                  } catch (err) {
                    toast((err as Error).message)
                    track('backup_restore', { success: false, reason: scrubText((err as Error).message) })
                  }
                  setPendingRestore(undefined)
                }}
              >
                Replace & restore
              </button>
            </div>
          </Inset>
        )}
        <div className="border-t border-hairline pt-3">
          {confirmWipe ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 t-body-sm text-error">Delete all expenses, receipts and settings?</span>
              <button type="button" className="min-h-10 rounded-full px-3 t-button-sm text-secondary" onClick={() => setConfirmWipe(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="min-h-10 rounded-full bg-error px-4 t-button-sm text-white"
                onClick={async () => {
                  try {
                    await wipeAllData()
                    await trackNow('data_delete_all', { expense_count: count ?? 0 })
                    location.reload()
                  } catch {
                    toast("Couldn't delete your data. Close other tabs of this app and try again.")
                  }
                }}
              >
                Delete
              </button>
            </div>
          ) : (
            <button type="button" className="flex min-h-10 items-center gap-2 t-button-sm text-error" onClick={() => setConfirmWipe(true)}>
              <Trash2 size={17} /> Delete all data
            </button>
          )}
        </div>
      </Card>
    </Section>
  )
}

function PrivacySection({ onOpenPrivacy }: { onOpenPrivacy: () => void }) {
  return (
    <Section icon={<ShieldCheck size={16} />} title="Privacy">
      <Card className="px-4 py-1">
        <div className="flex flex-col gap-0.5 py-3">
          <span className="t-body-md font-medium">Usage analytics</span>
          <span className="t-body-sm text-secondary">
            Reimburse Me sends what you do in the app to Google Analytics: amounts, natures, companies and remarks (with personal info removed), plus your
            device and approximate location. Receipts and your profile are never sent. If you don't want to share this, please stop using the app.
          </span>
        </div>
        <button type="button" onClick={onOpenPrivacy} className="flex min-h-12 w-full items-center justify-between border-t border-hairline t-button-sm text-primary">
          What's shared and what isn't <ChevronRight size={16} />
        </button>
      </Card>
    </Section>
  )
}

function PrivacySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (open) return overlayView('privacy')
  }, [open])
  const item = (title: string, body: string) => (
    <div className="flex flex-col gap-1">
      <h3 className="t-title-md text-ink">{title}</h3>
      <p className="t-body-md text-secondary">{body}</p>
    </div>
  )
  return (
    <Sheet open={open} onClose={onClose} title="Privacy">
      <div className="flex flex-col gap-5 pt-1 pb-[max(8px,env(safe-area-inset-bottom))]">
        {item('Stored on this phone', "Your expenses, receipts and profile are kept in this browser's storage. There's no account and no cloud copy, so keep backups.")}
        {item(
          'Shared with Google Analytics',
          'The app sends the screens you open and the actions you take, including expense amounts, nature of expense, the company billed and remarks. Emails, phone numbers, PAN, Aadhaar, UPI IDs, links and long numbers are removed from text first. Google also receives your device, browser and approximate location (from your IP address), and may use this data for advertising measurement.',
        )}
        {item('Never sent', 'Receipt photos and PDFs, file names, and your name, employee ID, department and email.')}
        {item(
          'Your choice',
          "Sharing usage data is part of using Reimburse Me and can't be turned off. If you don't want to share it, please stop using the app. You can save a backup and use \"Delete all data\" in Settings first.",
        )}
      </div>
    </Sheet>
  )
}
