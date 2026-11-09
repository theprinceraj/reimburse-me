declare const __APP_VERSION__: string
declare const __DEV_LAN_HOST__: string

interface ImportMetaEnv {
  /** GA4 web stream Measurement ID (G-XXXXXXXXXX). Empty turns analytics off entirely. */
  readonly VITE_GA_MEASUREMENT_ID?: string
}
