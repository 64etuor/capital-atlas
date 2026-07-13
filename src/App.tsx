import { StationPlate } from './components/StationPlate'
import { InstrumentCluster } from './components/InstrumentCluster'
import { BarographTimeline } from './components/BarographTimeline'
import { ObservationReport } from './components/ObservationReport'
import { LineageDossier } from './components/LineageDossier'
import { CommandPalette } from './components/CommandPalette'
import { TutorialOverlay } from './components/TutorialOverlay'
import { MapCanvas } from './features/map/MapCanvas'
import { SynopticView } from './features/synoptic/SynopticView'
import { StationView } from './features/station/StationView'
import { dataVintageDate } from './lib/periods'

function App() {
  return (
    <div className="atlas-grain relative h-full overflow-hidden">
      <MapCanvas />
      <SynopticView />
      <StationView />
      {/* "현재 추정 기준" = 데이터 스냅샷 빈티지(index.generated_at). 월클럭
          금지 — 정적 스냅샷에 오늘 날짜를 붙이면 허위 신선도 주장(감사 F1). */}
      <StationPlate estimatedAsOf={dataVintageDate()} />
      <InstrumentCluster />
      <BarographTimeline />
      <ObservationReport />
      <LineageDossier />
      <TutorialOverlay />
      <CommandPalette />
    </div>
  )
}

export default App
