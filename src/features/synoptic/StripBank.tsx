/**
 * ③ 스트립차트 뱅크 — 자산군별 65분기 흐름 강도(총거래 규모) 미니 지진계.
 * 현재 분기 니들 동기화(바로그래프 스크럽과 연동), 행 클릭 = 자산 필터.
 */
import { ASSET_LABELS } from '../../lib/assetLabels'
import { useTranslation } from 'react-i18next'
import { formatUsd } from '../../lib/format'
import { periodFromIndex } from '../../lib/periods'
import { rgbVar, rgbaCss } from '../../lib/tokens'
import {
  attributionFor,
  csvFilename,
  downloadCsv,
  exportSvgPng,
  serializeCsv,
} from '../../lib/exportChart'
import { ChartControls } from '../../components/ChartControls'
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
  const { t } = useTranslation()
  const periods = syn.periods
  const needleX = ((periodIndex + 0.5) / periods.length) * 100

  const grossSeries = (asset: AssetClass): number[] =>
    periods.map((p: PeriodKey) => gross(syn.per_quarter[p]?.[asset], observedOnly))

  const exportCsv = () => {
    const rows = periods.map((p, i) => ({
      period: p,
      ...Object.fromEntries(
        syn.assets.map((a) => [a, grossSeries(a)[i] || null]),
      ),
    }))
    void attributionFor(['imf_bop']).then((attribution) =>
      downloadCsv(
        csvFilename('WLD', 'gross-flow', periodFromIndex(periodIndex)),
        serializeCsv({
          meta: {
            Scope: 'World — gross flow by asset (SYNOPTIC seismograph)',
            View: observedOnly ? 'observed-only' : 'observed+estimated',
            Source: attribution.replace(/^Source: /, ''),
            Generated: new Date().toISOString().slice(0, 10),
          },
          columns: [
            { key: 'period', label: 'period' },
            ...syn.assets.map((a) => ({ key: a, label: `${a}_gross_flow_usd` })),
          ],
          rows,
        }),
      ),
    )
  }

  const exportPng = () => {
    // 정적 SVG 재조립 — CSS 변수는 rasterize 시 해석되지 않으므로 색을 인라인
    const W = 1200
    const ROW = 64
    const LABEL_W = 96
    const paper = rgbaCss(rgbVar('--color-paper'), 0.5)
    const label = rgbaCss(rgbVar('--color-paper'), 0.75)
    const fill = rgbaCss(rgbVar('--color-pressure-2'), 0.22)
    const needle = rgbaCss(rgbVar('--color-flow-in'), 0.8)
    const plotW = W - LABEL_W - 8
    const rowsSvg = syn.assets
      .map((asset, r) => {
        const series = grossSeries(asset)
        const max = Math.max(...series, 1)
        const y0 = r * ROW + 8
        const h = ROW - 18
        const pts = series
          .map(
            (v, i) =>
              `${LABEL_W + ((i + 0.5) / periods.length) * plotW},${y0 + h - (v / max) * h}`,
          )
          .join(' ')
        const nx = LABEL_W + ((periodIndex + 0.5) / periods.length) * plotW
        return (
          `<text x="8" y="${y0 + h / 2}" fill="${label}" font-family="monospace" font-size="13" letter-spacing="2">${ASSET_ABBR[asset]}</text>` +
          `<polyline points="${LABEL_W},${y0 + h} ${pts} ${W - 8},${y0 + h}" fill="${fill}" stroke="none"/>` +
          `<polyline points="${pts}" fill="none" stroke="${paper}" stroke-width="1.2"/>` +
          `<line x1="${nx}" x2="${nx}" y1="${y0}" y2="${y0 + h}" stroke="${needle}" stroke-width="1.5"/>`
        )
      })
      .join('')
    void attributionFor(['imf_bop']).then((attribution) =>
      exportSvgPng(rowsSvg, W, syn.assets.length * ROW + 8, {
        filename: csvFilename(
          'WLD',
          'gross-flow',
          periodFromIndex(periodIndex),
        ).replace(/\.csv$/, '.png'),
        title: 'World — gross flow by asset (seismograph)',
        attribution,
      }),
    )
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-baseline justify-between gap-4">
        <p className="dial-label text-paper-dim/70">
          SEISMOGRAPH · GROSS FLOW BY ASSET · 2010→
        </p>
        <ChartControls onPng={exportPng} onCsv={exportCsv} />
      </div>
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
              title={t('synoptic.filterTitle', { label: ASSET_LABELS[asset] })}
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
