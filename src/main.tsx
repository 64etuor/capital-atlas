import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { getIndex } from './lib/dataClient'
import { initDataVintage, initPeriods, periodCount } from './lib/periods'
import { useViewStore } from './store/viewStore'
import { applyLocale, detectLocale } from './i18n'
import { applyUrlState, startUrlSync } from './lib/urlState'
import { ObservationLoader } from './components/ObservationLoader'

// 로케일: URL ?lang > localStorage > en (G2) — 첫 렌더 전에 적용
applyLocale(detectLocale())

const root = createRoot(document.getElementById('root')!)

// Paint the observatory immediately; the canonical period index is resolved
// before the interactive surface mounts so URL quarter clamping stays exact.
root.render(
  <StrictMode>
    <ObservationLoader className="atlas-grain h-full" />
  </StrictMode>,
)

// index.json is the canonical period list (DATA_CONTRACT) — sync the
// timeline to it before first render; fall back to the built-in range.
getIndex()
  .then((idx) => {
    initPeriods(idx.latest_quarter)
    initDataVintage(idx.generated_at)
    useViewStore.setState({ periodIndex: periodCount() - 1 })
  })
  .catch(() => {})
  .then(() => {
    // 딥링크 복원(P2-9)은 기간 정본 확정 후 — 클램프 정확성. 이후 상태→URL 동기화.
    applyUrlState(useViewStore)
    startUrlSync(useViewStore)
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
