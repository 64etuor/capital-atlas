import { latestPeriod } from '../lib/periods'
import { useViewStore } from '../store/viewStore'

const SURFACES = [
  { value: 'globe', label: 'GLOBE' },
  { value: 'synoptic', label: 'SYNOPTIC' },
] as const

/** 좌상 관측소 명판 — 워드마크 + 이중 시각 스탬프 + 관측 표면 전환 (§5). */
export function StationPlate({ estimatedAsOf }: { estimatedAsOf: string }) {
  const appView = useViewStore((s) => s.appView)
  const setAppView = useViewStore((s) => s.setAppView)
  return (
    <div className="pointer-events-none absolute left-6 top-5 z-10 select-none">
      <h1 className="font-display text-[28px] leading-none tracking-wide text-paper">
        Capital <span className="italic">Atlas</span>
      </h1>
      <div className="readout mt-2 space-y-0.5 text-[11px] leading-tight text-paper-dim">
        <p>
          <span className="opacity-60">LAST OFFICIAL OBS</span> {latestPeriod()}
        </p>
        <p>
          <span className="opacity-60">ESTIMATED AS OF</span> {estimatedAsOf}
        </p>
      </div>
      <div className="pointer-events-auto mt-3 flex gap-px">
        {SURFACES.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={appView === s.value}
            onClick={() => setAppView(s.value)}
            className={
              'dial-label border-y border-paper/10 bg-ink-1/70 px-2.5 py-1.5 transition-colors duration-140 ' +
              (appView === s.value
                ? 'text-flow-in'
                : 'text-paper-dim hover:text-paper')
            }
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
