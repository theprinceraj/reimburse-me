# Reimburse Me

A phone-first PWA for logging work expenses and turning them into a reimbursement claim.
Styled with Qoody's "Warm Tactile Ledger" design system. Everything stays on the device (IndexedDB).

## Features
- Expenses with **Date, Amount (₹), Nature of expense** (optional, colour-coded presets + custom),
  **Remarks** (optional), **Billed to** (saved list + add new) and receipt photos (compressed on-device).
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
