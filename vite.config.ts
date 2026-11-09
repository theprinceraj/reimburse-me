import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { networkInterfaces } from 'node:os'
import pkg from './package.json' with { type: 'json' }

/** First private IPv4 on Wi-Fi/Ethernet, so the desktop QR code can point a phone at the dev server. */
function lanHost(): string {
  const all = Object.entries(networkInterfaces()).filter(([name]) => !/vEthernet|WSL|docker|vmnet|VirtualBox/i.test(name))
  for (const [, addrs] of all) for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  return ''
}

export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEV_LAN_HOST__: JSON.stringify(command === 'serve' ? lanHost() : ''),
  },
  server: { host: true, port: 5173 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png', 'fonts/*.ttf'],
      manifest: {
        id: '/',
        name: 'Reimburse Me',
        short_name: 'Reimburse',
        description: 'Log work expenses on your phone and turn them into a reimbursement claim.',
        lang: 'en-IN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#FCF9F4',
        theme_color: '#FCF9F4',
        categories: ['finance', 'business', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Add expense', short_name: 'Add', url: '/?add=1', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2,ttf,webmanifest}'],
        // pdf.js worker (~1.3 MB) must be precached so PDF receipts work offline.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // gtag.js (and the destination script it pulls in) must load when the app starts offline so queued analytics can replay later.
        // Hits to google-analytics.com/g/collect are deliberately not routed through the SW.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/www\.googletagmanager\.com\/gtag\/(js|destination)/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'gtag',
              expiration: { maxEntries: 2, maxAgeSeconds: 7 * 24 * 60 * 60 },
              // The script is loaded with crossorigin, so responses are CORS (200), never opaque (0) with quota padding.
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
}))
