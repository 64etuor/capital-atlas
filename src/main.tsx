import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { getIndex } from './lib/dataClient'
import { initPeriods, periodCount } from './lib/periods'
import { useViewStore } from './store/viewStore'

const root = createRoot(document.getElementById('root')!)

// index.json is the canonical period list (DATA_CONTRACT) — sync the
// timeline to it before first render; fall back to the built-in range.
getIndex()
  .then((idx) => {
    initPeriods(idx.latest_quarter)
    useViewStore.setState({ periodIndex: periodCount() - 1 })
  })
  .catch(() => {})
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
