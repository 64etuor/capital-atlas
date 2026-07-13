import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewStore } from '../store/viewStore'
import { getFlowIntensity } from '../lib/dataClient'
import {
  START_YEAR,
  indexFromPeriod,
  latestPeriod,
  periodCount,
  periodFromIndex,
} from '../lib/periods'
import { formatUsd } from '../lib/format'
import type { FlowIntensityPoint } from '../types/data'

const W = 1000
const H = 48

function buildAreaPath(series: FlowIntensityPoint[], count: number): string {
  if (series.length === 0) return ''
  const max = Math.max(...series.map((p) => p.gross_flow_usd))
  if (max <= 0) return ''
  const pts = series
    .map((p) => {
      const x = (indexFromPeriod(p.period) / (count - 1)) * W
      const v = Math.pow(p.gross_flow_usd / max, 0.8)
      return `L${x.toFixed(1)},${(H - 3 - v * (H - 8)).toFixed(1)}`
    })
    .join(' ')
  const x0 = (indexFromPeriod(series[0].period) / (count - 1)) * W
  const x1 =
    (indexFromPeriod(series[series.length - 1].period) / (count - 1)) * W
  return `M${x0.toFixed(1)},${H} ${pts} L${x1.toFixed(1)},${H} Z`
}

/**
 * 하단 바로그래프 타임라인 — 슬라이더가 곧 스트립차트 (DESIGN.md §5).
 * The silhouette is the real global gross-flow series (meta/flow_intensity,
 * IMF BOP grade A) — not decoration.
 */
export function BarographTimeline() {
  const { t } = useTranslation()
  const periodIndex = useViewStore((s) => s.periodIndex)
  const setPeriodIndex = useViewStore((s) => s.setPeriodIndex)
  const reportOpen = useViewStore(
    (s) => s.selectedCountry !== null && s.appView === 'globe',
  )
  const [series, setSeries] = useState<FlowIntensityPoint[]>([])

  useEffect(() => {
    let alive = true
    getFlowIntensity()
      .then((f) => {
        if (alive) setSeries(f.series)
      })
      .catch(() => {
        /* barograph silhouette stays empty; scrubbing still works */
      })
    return () => {
      alive = false
    }
  }, [])

  const count = periodCount()
  const areaPath = buildAreaPath(series, count)
  const needleX = (periodIndex / (count - 1)) * 100
  const point = series.find(
    (p) => indexFromPeriod(p.period) === periodIndex,
  )

  const lastYear = START_YEAR + Math.floor((count - 1) / 4)
  const ticks: Array<{ year: number; x: number }> = []
  for (let y = START_YEAR; y <= lastYear; y += 2) {
    ticks.push({ year: y, x: (((y - START_YEAR) * 4) / (count - 1)) * 100 })
  }

  return (
    <div
      className={
        // shrink to the remaining width so the observation report (§5, 420px)
        // never clips the right edge of the strip chart
        'absolute bottom-0 left-0 z-10 px-6 pb-3 transition-[right] duration-280 ease-(--ease-baro) ' +
        (reportOpen ? 'right-[420px]' : 'right-0')
      }
    >
      <div className="relative h-16 border-t border-paper/10">
        {/* area silhouette — global gross cross-border flow per quarter */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-x-0 bottom-4 h-10 w-full"
        >
          {areaPath && (
            <>
              <path d={areaPath} fill="var(--pressure-1)" fillOpacity={0.55} />
              <path
                d={areaPath}
                fill="none"
                stroke="var(--pressure-2)"
                strokeOpacity={0.8}
                strokeWidth={1}
              />
            </>
          )}
        </svg>

        {/* year ticks */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-4">
          {ticks.map((t) => (
            <span
              key={t.year}
              style={{ left: `${t.x}%` }}
              className="readout absolute bottom-0 -translate-x-1/2 text-[9px] text-paper-dim/70"
            >
              {String(t.year).slice(2)}
            </span>
          ))}
        </div>

        {/* scrub needle + quarter stamp + live reading */}
        <div
          aria-hidden="true"
          style={{ left: `${needleX}%` }}
          className="pointer-events-none absolute inset-y-0 w-px bg-flow-in"
        >
          <span
            className={
              'readout absolute -top-1 whitespace-nowrap bg-ink-0/80 px-1.5 py-0.5 text-[11px] tracking-[0.12em] text-flow-in ' +
              (needleX > 82
                ? 'right-0'
                : needleX < 8
                  ? 'left-0'
                  : 'left-1/2 -translate-x-1/2')
            }
          >
            {periodFromIndex(periodIndex)}
            {point ? ` · ${formatUsd(point.gross_flow_usd, 1)}` : ''}
          </span>
        </div>

        {/* invisible native input drives interaction (keyboard + drag) */}
        <input
          type="range"
          min={0}
          max={count - 1}
          step={1}
          value={periodIndex}
          onChange={(e) => setPeriodIndex(Number(e.target.value))}
          aria-label={t('common.quarterAria')}
          aria-valuetext={`${periodFromIndex(periodIndex)} — latest ${latestPeriod()}`}
          className="absolute inset-0 w-full cursor-ew-resize opacity-0"
        />
      </div>
    </div>
  )
}
