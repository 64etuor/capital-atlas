import { StationPlate } from './components/StationPlate'
import { InstrumentCluster } from './components/InstrumentCluster'
import { BarographTimeline } from './components/BarographTimeline'
import { ObservationReport } from './components/ObservationReport'
import { LineageDossier } from './components/LineageDossier'
import { MapCanvas } from './features/map/MapCanvas'
import { SynopticView } from './features/synoptic/SynopticView'
import { StationView } from './features/station/StationView'

/** "현재 추정 기준" 스탬프 — 모듈 초기화 시 1회 (렌더 순수성 유지) */
const ESTIMATED_AS_OF = new Date().toISOString().slice(0, 10)

function App() {
  return (
    <div className="atlas-grain relative h-full overflow-hidden">
      <MapCanvas />
      <SynopticView />
      <StationView />
      <StationPlate estimatedAsOf={ESTIMATED_AS_OF} />
      <InstrumentCluster />
      <BarographTimeline />
      <ObservationReport />
      <LineageDossier />
    </div>
  )
}

export default App
