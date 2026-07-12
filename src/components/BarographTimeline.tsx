import { useViewStore } from '../store/viewStore'
import {
  PERIOD_COUNT,
  periodFromIndex,
  START_YEAR,
  END_YEAR,
} from '../lib/periods'

const W = 1000
const H = 48

/**
 * Placeholder silhouette until Phase B ships aggregate flow intensity.
 * Deterministic (module-level) so the compiler/purity rules stay happy.
 */
const AREA_PATH = (() => {
  const pts = Array.from({ length: PERIOD_COUNT }, (_, i) => {
    const v =
      0.42 +
      0.2 * Math.sin(i / 5.1) +
      0.13 * Math.sin(i / 2.17 + 1.4) +
      0.07 * Math.sin(i / 1.31 + 0.5)
    const x = (i / (PERIOD_COUNT - 1)) * W
    return `L${x.toFixed(1)},${(H - v * H).toFixed(1)}`
  }).join(' ')
  return `M0,${H} ${pts} L${W},${H} Z`
})()

const YEAR_TICKS = Array.from(
  { length: END_YEAR - START_YEAR + 1 },
  (_, i) => ({
    year: START_YEAR + i,
    x: ((i * 4) / (PERIOD_COUNT - 1)) * 100,
  }),
)

/** 하단 바로그래프 타임라인 — 슬라이더가 곧 스트립차트 (DESIGN.md §5). */
export function BarographTimeline() {
  const periodIndex = useViewStore((s) => s.periodIndex)
  const setPeriodIndex = useViewStore((s) => s.setPeriodIndex)
  const needleX = (periodIndex / (PERIOD_COUNT - 1)) * 100

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-3">
      <div className="relative h-16 border-t border-paper/10">
        {/* area silhouette */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-x-0 bottom-4 h-10 w-full"
        >
          <path d={AREA_PATH} fill="var(--pressure-1)" fillOpacity={0.55} />
          <path
            d={AREA_PATH}
            fill="none"
            stroke="var(--pressure-2)"
            strokeOpacity={0.8}
            strokeWidth={1}
          />
        </svg>

        {/* year ticks */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-4">
          {YEAR_TICKS.map((t) => (
            <span
              key={t.year}
              style={{ left: `${t.x}%` }}
              className="readout absolute bottom-0 -translate-x-1/2 text-[9px] text-paper-dim/70"
            >
              {String(t.year).slice(2)}
            </span>
          ))}
        </div>

        {/* scrub needle + quarter stamp */}
        <div
          aria-hidden="true"
          style={{ left: `${needleX}%` }}
          className="pointer-events-none absolute inset-y-0 w-px bg-flow-in"
        >
          <span className="readout absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap bg-ink-0/80 px-1.5 py-0.5 text-[11px] tracking-[0.12em] text-flow-in">
            {periodFromIndex(periodIndex)}
          </span>
        </div>

        {/* invisible native input drives interaction (keyboard + drag) */}
        <input
          type="range"
          min={0}
          max={PERIOD_COUNT - 1}
          step={1}
          value={periodIndex}
          onChange={(e) => setPeriodIndex(Number(e.target.value))}
          aria-label="Quarter"
          className="absolute inset-0 w-full cursor-ew-resize opacity-0"
        />
      </div>
    </div>
  )
}
