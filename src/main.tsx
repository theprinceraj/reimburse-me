import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DeviceGate } from './components/DeviceGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initAnalytics } from './lib/analytics'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

// Before render: App.tsx strips the launch URL's query, and gtag must see its UTMs first.
initAnalytics()

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <DeviceGate>
        <App />
      </DeviceGate>
    </ErrorBoundary>
  </StrictMode>,
)
