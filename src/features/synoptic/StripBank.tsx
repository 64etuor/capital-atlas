/**
 * ③ 스트립차트 뱅크 — 자산군별 65분기 흐름 강도(총거래 규모) 미니 지진계.
 * 현재 분기 니들 동기화(바로그래프 스크럽과 연동), 행 클릭 = 자산 필터.
 */
import { ASSET_LABELS } from '../../lib/assetLabels'
import { formatUsd } from '../../lib/format'
import type {
  AssetClass,
  PeriodKey,
  SynopticCell,
  SynopticFile,
} from '../../types/data'
import { ASSET_ABBR } from './shared'

interface Props {
  syn: SynopticFile
  periodIndex: number
  observedOnly: boolean
  filter: AssetClass | null
  onFilter: (asset: AssetClass | null) => void
}

const gross = (c: SynopticCell | undefined, obs: boolean): number =>
  c ? (obs ? c.flow_gross_obs : c.flow_gross) : 0

export function StripBank({ syn, periodIndex, observedOnly, filter, onFilter }: Props) {
  const periods = syn.periods
  const needleX = ((periodIndex + 0.5) / periods.length) * 100

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <p className="dial-label shrink-0 text-paper-dim/70">
        SEISMOGRAPH · GROSS FLOW BY ASSET · 2010→
      </p>
      <div className="mt-1 flex min-h-0 flex-1 flex-col justify-between gap-1">
        {syn.assets.map((asset) => {
          const series = periods.map((p: PeriodKey) =>
            gross(syn.per_quarter[p]?.[asset], observedOnly),
          )
          const max = Math.max(...series, 1)
          const pts = series
            .map(
              (v, i) =>
                `${((i + 0.5) / periods.length) * 100},${30 - (v / max) * 28}`,
            )
            .join(' ')
          const dimmed = filter !== null && filter !== asset
          const current = series[Math.min(periodIndex, series.length - 1)]
          return (
            <button
              key={asset}
              type="button"
              aria-pressed={filter === asset}
              onClick={() => onFilter(filter === asset ? null : asset)}
              title={`${ASSET_LABELS[asset]} — filter`}
              className={
                'flex min-h-0 flex-1 items-center gap-2 text-left transition-opacity duration-140 ' +
                (dimmed ? 'opacity-35' : 'opacity-100')
              }
            >
              <span
                className={
                  'dial-label w-11 shrink-0 ' +
                  (filter === asset ? 'text-flow-in' : 'text-paper-dim')
                }
              >
                {ASSET_ABBR[asset]}
              </span>
              <svg
                className="h-full min-h-0 w-full flex-1"
                viewBox="0 0 100 30"
                preserveAspectRatio="none"
                aria-hidden
              >
                <polyline
                  points={`0,30 ${pts} 100,30`}
                  fill="var(--pressure-2)"
                  fillOpacity={0.22}
                  stroke="none"
                />
                <polyline
                  points={pts}
                  fill="none"
                  stroke="var(--atlas-paper)"
                  strokeOpacity={0.45}
                  strokeWidth={0.7}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={needleX}
                  x2={needleX}
                  y1={0}
                  y2={30}
                  stroke="var(--flow-in)"
                  strokeOpacity={0.8}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className="readout w-14 shrink-0 text-right text-[10px] text-paper-dim">
                {current > 0 ? formatUsd(current, 0) : '—'}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
