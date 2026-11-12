# Reimburse Me

A phone-first PWA for logging work expenses and turning them into a reimbursement claim.
Styled with Qoody's "Warm Tactile Ledger" design system. Expenses, receipts and the profile are stored only on
the device (IndexedDB); usage and expense details are always sent to Google Analytics 4, with no opt-out
(see [Analytics](#analytics)).

## Features
- Expenses with **Date, Amount (₹), Nature of expense** (optional, colour-coded presets + custom),
  **Remarks** (optional), **Billed to** (saved list + add new) and receipts: photos (compressed on-device) or PDFs
  (each page, up to 10, rendered to an image on-device and handled like a photo).
- Monthly ledger grouped by day, per-company breakdown, search, company filter.
- **Claim export**: filter by company + period → PDF claim sheet (with receipts and sign-off lines) or CSV.
- Backup / restore (JSON incl. receipts), storage-persistence request, delete-all.
- Installable, offline, update prompt; install sheet once per visit in mobile browsers.
- Portrait phones only: desktops get a QR code, landscape gets a "turn upright" notice.

## Develop
```sh
bun install
bun run dev        # http://localhost:5173 (desktop shows a QR code to open it on your phone)
bun run build      # typecheck + production build with service worker
bun run preview
bun run icons      # regenerate PWA icons from public/icon.svg
```
Use Chrome DevTools device emulation to view it on desktop. Install and the service worker need HTTPS
(or localhost); over plain-HTTP LAN the app works but can't be installed.

`public/fonts/*.ttf` are static subsets of Plus Jakarta Sans and DM Sans (OFL), used to embed ₹ in PDFs.

## Analytics

Plain gtag.js (no GTM), all in `src/lib/analytics.ts`. `initAnalytics()` runs in `main.tsx` before React renders, so
gtag sees the launch URL (UTMs, `gclid`) before `App.tsx` strips the query.

### Config
| File | Purpose |
| --- | --- |
| `.env` | `VITE_GA_MEASUREMENT_ID=G-3VLEQ7B4TM`, used by dev and production builds (committed; Measurement IDs are public) |
| `.env.local` | Local override, git-ignored (set `VITE_GA_MEASUREMENT_ID=` to turn analytics off locally) |
| `.env.example` | Template |

Dev and production share one GA4 property and web stream (`https://reimburse-me.theprinceraj.in`). An empty ID turns
analytics into a no-op: no script, no events, no notice. In dev (`import.meta.env.DEV`) every event carries
`debug_mode: true`, which GA4's built-in developer-traffic filter excludes. The `app_env` user property is `prod`
only for a production build served from `reimburse-me.theprinceraj.in`. Dev servers, `*.pages.dev` previews, LAN IPs
and `vite preview` get `dev`, so filter reports on `app_env = prod`.

- Analytics is always on and can't be turned off; the notice and the Privacy section tell people who don't want to
  share usage data to stop using the app. No consent calls are made (gtag's default is granted).
  `allow_google_signals: true`. Automatic page views are off;
  screens send virtual `page_view`s (`/expenses`, `/claim`, `/settings`, `/expense/new`, `/expense/edit`,
  `/receipt`, `/privacy`). Only campaign parameters (`utm_source|medium|campaign|term|content|id`, `gclid`) from the
  launch query reach GA, on the config and the first page view; other query parameters never leave the phone. Every
  event carries `page_location`/`page_path`/`page_title` of the screen it happened on (topmost sheet or viewer, else
  the tab), so closing a sheet restores the tab's context without an extra page view, and replayed events keep theirs.
- A one-time banner above the bottom nav says usage data is shared and to stop using the app if that's not OK
  ("OK" / "Details", which opens Settings); dismissal is stored as `analytics_notice_dismissed`.
- `analytics_*` settings and the offline queue belong to the device: backups leave them out, restore keeps the
  current ones, and "Delete all data" keeps them.

### Privacy rules
- Free text (remarks, search terms, company and custom nature names, error messages) goes through `scrubText()`.
  It redacts URLs, emails, UPI IDs, PAN, Aadhaar-like 12-digit numbers, Indian and international phone numbers and
  any run of 6+ digits or 9+ digits typed in groups, then collapses whitespace and truncates to 100 characters.
- All string params are truncated to 100 chars (`page_location` 1000, `page_title` 300), with at most 22 app params per event.
- Never sent: profile fields (name, employee ID, department, email), receipt images or PDFs, file names.

### Offline queue
Every event that can't go to gtag at once (offline, gtag.js still loading or failed,
older events still waiting) is written straight to the Dexie `analyticsQueue` store (DB version 2) with `queued_at`,
so closing the tab early can't lose it (`first_launch` is only marked reported once it is queued or sent). The queue
is replayed in order through gtag on the `online` event, when gtag.js loads, and when the app becomes visible again.
Events queued while offline or after a failed load get `queued: true` and `offline_delay_sec`; ones that only
waited for gtag.js to load don't. GA4 timestamps them at replay time. Each batch is deleted before it is
handed to gtag, so a crash mid-replay can lose events but never sends one twice. The queue keeps the newest 500
events (checked every 20th write), is excluded from backups, and survives "Delete all data". `trackNow`, used right before a reload or delete-all, waits at most 800 ms. The service worker caches `gtag/js` and `gtag/destination`
(StaleWhileRevalidate, 7 days, 200 responses only; the script is loaded with `crossorigin="anonymous"` so it is a
CORS response rather than an opaque one) so the script loads offline. Hits to `google-analytics.com/g/collect` are not routed
through the SW.

**Limitation:** "offline" means `navigator.onLine === false`. On a captive portal or a connection that is up but not
reaching Google, the browser still reports online, so hits go to gtag and may be lost; they are not queued. Retries
of a failed gtag.js load happen on the `online` event, and also whenever the app becomes visible if the load failed
while online. After two consecutive load failures while online (usually an ad blocker) analytics stops for the
session: the queue is cleared once and new events are dropped rather than queued.

### Events
Key event candidates are marked ★.

| Event | Params | Fired from |
| --- | --- | --- |
| `page_view` | `page_title`, `page_location`, `page_path` | Tab change (`App.tsx`), expense sheet open, receipt viewer, privacy sheet |
| `app_open` | `display_mode`, `launch_source` (`shortcut` for `?add=1`, else `normal`) | `initAnalytics` |
| `first_launch` | `first_source`, `first_medium`, `first_campaign`, `first_term`, `first_content`, `has_gclid`, `referrer_host`, `display_mode`, `existing_data` | First launch on the device (first touch stored as `analytics_first_touch`). Not `first_open`, which GA4 reserves |
| `expense_add` ★ | `value` (₹), `currency` INR, `nature_id` (preset id / `custom` / `none`), `nature_name`, `nature_is_custom`, `billed_to`, `remarks`, `has_remarks`, `receipt_count`, `receipt_types` (image/pdf/mixed/none), `expense_date_offset_days`, `is_backdated` | ExpenseSheet save (new) |
| `expense_edit` | `fields_changed` (amount,date,nature,remarks,billed_to,receipts), `receipt_count` | ExpenseSheet save (edit) |
| `expense_delete` | `receipt_count` | ExpenseSheet delete |
| `expense_delete_undo` | `receipt_count` | Undo on the "Expense deleted" toast |
| `receipt_attach` | `type` (image/pdf), `size_kb`, `page_count`, `truncated` (pdf) | ExpenseSheet file picker |
| `receipt_error` | `stage` (pick/image/pdf), `reason` | ExpenseSheet file picker |
| `receipt_remove` | `surface` (thumbnail/viewer) | ExpenseSheet |
| `receipt_view` | `receipt_count` | ReceiptViewer open |
| `billed_to_create` | `billed_to`, `surface` (expense_sheet/settings) | ExpenseSheet save, Settings |
| `billed_to_rename`, `billed_to_delete` | none | Settings |
| `nature_create` | `nature_name`, `tone`, `surface` | ExpenseSheet custom chip, Settings |
| `nature_edit`, `nature_delete` | `nature_is_custom` | Settings |
| `nature_reset` | `restored_count` | Settings "Restore built-in" |
| `search` | `search_term`, `results_count` | Ledger, 1.5 s after typing stops |
| `filter_company` | `billed_to` | Ledger company pill |
| `month_change` | `direction` (prev/next/current) | Ledger month arrows and "this month" links |
| `claim_export` ★ | `format` (pdf/csv), `method` (share/download), `period_type`, `period_label`, `billed_to`, `expense_count`, `value` (₹), `currency`, `include_receipts` (pdf), `receipt_count`, `duration_ms` | Claim screen, the first time a built file is shared or saved |
| `claim_export_action` | `format`, `method` | Claim screen, sharing or saving the same built claim again (no `value`, so revenue counts once) |
| `claim_export_error` | `format`, `reason` | Claim screen |
| `backup_export` | `expense_count`, `receipt_count`, `size_kb` | Settings → Backup |
| `backup_restore` | `success`, `expense_count` or `reason` | Settings → Restore |
| `data_delete_all` | `expense_count` | Settings → Delete all data |
| `storage_persist_request` | `granted` | Settings → Protect |
| `install_prompt_shown` | `surface` (sheet/settings), `install_method` (native/ios/manual) | InstallPrompt sheet, Settings install card |
| `install_prompt_result` | `outcome` (accepted/dismissed), `surface` | Native install button |
| `app_installed` ★ | `platform` | `appinstalled` window event |
| `sw_update_available`, `sw_update_applied`, `sw_update_later` | none | Update banner (`App.tsx`) |
| `device_gate_shown` | `reason` (desktop/landscape) | DeviceGate |
| `exception` | `description`, `fatal`, `context` (error_boundary/window_error/unhandled_rejection/expense_save) | ErrorBoundary, window `error`/`unhandledrejection`; deduped per session |
| `web_vitals` | `metric_name` (LCP/INP/CLS/FCP/TTFB), `metric_value` (ms; CLS unitless), no `value` so Event value stays expense rupees, `metric_rating`, `metric_id` | `web-vitals` |

### User properties
`app_env` (prod/dev), `display_mode` (standalone/browser), `app_version`, `platform` (ios/android/other), `storage_persisted` (yes/no),
`expense_count_bucket` (0, 1-5, 6-20, 21-100, 100+; refreshed after add/delete/restore).

### Register in GA4 Admin → Custom definitions
- **Event-scoped dimensions:** `nature_name`, `nature_id`, `billed_to`, `remarks`, `receipt_types`, `fields_changed`,
  `format`, `method`, `period_type`, `surface`, `outcome`, `reason`, `stage`, `context`, `direction`, `metric_name`,
  `metric_rating`, `launch_source`, `display_mode`, `is_backdated`, `has_remarks`, `queued`, `install_method`,
  `success`, `type`
- **Metrics:** `expense_count` (standard), `receipt_count` (standard), `results_count` (standard),
  `expense_date_offset_days` (standard), `duration_ms` (milliseconds), `size_kb` (standard),
  `offline_delay_sec` (seconds), `metric_value` (standard). `value` + `currency` is reported as built-in Event value.
- **User-scoped dimensions:** `app_env`, `display_mode`, `app_version`, `platform`, `storage_persisted`, `expense_count_bucket`
- Mark `expense_add`, `claim_export` and `app_installed` as key events.

### Testing with DebugView
1. Run `bun run dev` (it uses the ID in `.env`).
2. Open the app on a phone or in Chrome device emulation. Every event has `debug_mode: true`, so it appears in
   GA4 → Admin → DebugView within seconds.
3. Offline check: DevTools → Network → Offline, use the app, then go back online. The replayed events show
   `queued: true` and `offline_delay_sec`. You can inspect `analyticsQueue` under Application → IndexedDB.
4. Production builds (`bun run build`) send no `debug_mode`. Their `app_env` is `prod` only on the live domain.
