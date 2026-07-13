/**
 * 자산 구성 스트림 — 65분기 스택 area, 자산별 기압 램프 색. VIS=OBS면
 * 추정 점이 문자 그대로 소멸(§6 — null 갭). 추정 비중이 큰 시리즈는
 * 안개(투명도)로 가라앉는다. DOM 미니 범례(mono) — 카드 아님.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetClass, StationPoint } from '../../types/data'
import { indexFromPeriod } from '../../lib/periods'
import { formatUsd } from '../../lib/format'
import { rgbaCss } from '../../lib/tokens'
import {
  attributionFor,
  csvFilename,
  downloadCsv,
  exportEchartsPng,
  serializeCsv,
} from '../../lib/exportChart'
import { ChartControls } from '../../components/ChartControls'
import { useFullscreenEsc } from '../../lib/useFullscreenEsc'
import { ASSET_ABBR } from '../synoptic/shared'
import type { ChartExportCtx } from './FlowChart'
import {
  INK_SHEET_BG,
  OBSERVED_GRADES,
  STATION_ASSET_ORDER,
  assetRgb,
  echarts,
  fullPeriods,
  monoTooltip,
  needleMarkLine,
  periodAxis,
  usdAxis,
  wireClickToPeriod,
} from './shared'

export type CompositionMode = 'stream' | 'multiples' | 'realloc'

interface Props {
  series: Partial<Record<AssetClass, StationPoint[]>>
  observedOnly: boolean
  periodIndex: number
  onPickPeriod: (index: number) => void
  exportCtx: ChartExportCtx
  mode: CompositionMode
  onMode: (m: CompositionMode) => void
  /** Phase L: LCU 표시 — 이미 변환된 수의 포맷터 (기본 USD) */
  fmtValue?: (v: number, digits?: number) => string
}

export function CompositionStream({
  series,
  observedOnly,
  periodIndex,
  onPickPeriod,
  exportCtx,
  mode,
  onMode,
  fmtValue = formatUsd,
}: Props) {
  const { t } = useTranslation()
  const holder = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  // 인터랙티브 범례(P1-6) — 시리즈 숨김/고립
  const [hidden, setHidden] = useState<ReadonlySet<AssetClass>>(new Set())
  const [full, setFull] = useState(false)
  useFullscreenEsc(full, () => setFull(false))
  const pickRef = useRef(onPickPeriod)
  useEffect(() => {
    pickRef.current = onPickPeriod
  })

  const exportPng = () => {
    const chart = chartRef.current
    if (!chart) return
    void attributionFor(exportCtx.sourceIds).then((attribution) =>
      exportEchartsPng(chart, {
        filename: csvFilename(
          exportCtx.country,
          'composition',
          exportCtx.period,
        ).replace(/\.csv$/, '.png'),
        title: `${exportCtx.countryName} — composition stream`,
        attribution,
      }),
    )
  }
  const exportCsv = () => {
    const periods = fullPeriods()
    const present = STATION_ASSET_ORDER.filter((a) => series[a]?.length)
    const byAsset = new Map<AssetClass, Array<number | null>>()
    for (const a of present) {
      const data: Array<number | null> = periods.map(() => null)
      for (const p of series[a] ?? []) {
        if (observedOnly && !OBSERVED_GRADES.has(p.grade)) continue
        data[indexFromPeriod(p.period)] = p.stock
      }
      byAsset.set(a, data)
    }
    const rows = periods.map((p, i) => ({
      period: p,
      ...Object.fromEntries(present.map((a) => [a, byAsset.get(a)?.[i]])),
    }))
    void attributionFor(exportCtx.sourceIds).then((attribution) =>
      downloadCsv(
        csvFilename(exportCtx.country, 'composition', exportCtx.period),
        serializeCsv({
          meta: {
            Country: exportCtx.countryName,
            View: observedOnly ? 'observed-only' : 'observed+estimated',
            Source: attribution.replace(/^Source: /, ''),
            Generated: new Date().toISOString().slice(0, 10),
          },
          columns: [
            { key: 'period', label: 'period' },
            ...present.map((a) => ({ key: a, label: `${a}_stock_usd` })),
          ],
          rows,
        }),
      ),
    )
  }

  const assets = STATION_ASSET_ORDER.filter((a) => series[a]?.length)

  // §14 자산 구성 비중 — 범례에 현재 니들 시점의 % 병기 (nearest ≤ periodIndex)
  const stocksNow = new Map<AssetClass, number>()
  let totalNow = 0
  for (const a of assets) {
    let best: StationPoint | null = null
    for (const p of series[a] ?? []) {
      const i = indexFromPeriod(p.period)
      if (i <= periodIndex && (!best || i > indexFromPeriod(best.period)))
        best = p
    }
    if (best && best.stock > 0) {
      stocksNow.set(a, best.stock)
      totalNow += best.stock
    }
  }

  useEffect(() => {
    const el = holder.current
    // effect 내부에서 재파생 — 렌더 스코프 배열 identity에 의존하지 않는다
    const assetsIn = STATION_ASSET_ORDER.filter(
      (a) => series[a]?.length && !hidden.has(a),
    )
    if (!el || assetsIn.length === 0) return
    const chart = echarts.init(el, null, { renderer: 'canvas' })
    chartRef.current = chart
    const periods = fullPeriods()

    const chartSeries = assetsIn.map((asset) => {
      const pts = series[asset] ?? []
      const data: Array<number | null> = periods.map(() => null)
      let estimated = 0
      for (const p of pts) {
        const obs = OBSERVED_GRADES.has(p.grade)
        if (!obs) estimated++
        if (observedOnly && !obs) continue // §6 — 추정은 소멸
        data[indexFromPeriod(p.period)] = p.stock
      }
      const fog = pts.length > 0 ? estimated / pts.length : 0
      const rgb = assetRgb(asset)
      return {
        name: ASSET_ABBR[asset],
        type: 'line' as const,
        stack: 'composition',
        data,
        showSymbol: false,
        connectNulls: false,
        lineStyle: {
          color: rgbaCss(rgb, 0.9),
          width: 0.8,
          ...(fog > 0.5 && { type: [2, 5] as [number, number] }), // 모델-우세 시리즈 = 희박 파선
        },
        areaStyle: {
          color: rgbaCss(rgb, Math.max(0.5 - fog * 0.35, 0.12)),
        },
      }
    })

    chart.setOption({
      backgroundColor: 'transparent',
      animationDuration: 280,
      grid: { left: 46, right: 8, top: 8, bottom: 20 },
      tooltip: {
        ...monoTooltip(),
        trigger: 'axis',
        formatter: (
          params: Array<{ seriesName: string; dataIndex: number; value: number | null }>,
        ) => {
          const i = params[0]?.dataIndex ?? 0
          const rows = params
            .filter((p) => p.value !== null && p.value !== undefined)
            .map((p) => `${p.seriesName}&nbsp;${fmtValue(p.value ?? 0, 1)}`)
          return [`<b>${periods[i]}</b>`, ...rows].join('<br/>')
        },
      },
      xAxis: periodAxis(periods),
      yAxis: usdAxis(fmtValue),
      series: chartSeries,
    })
    wireClickToPeriod(chart, (i) => pickRef.current(i), periods.length)
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [series, observedOnly, hidden, fmtValue])

  useEffect(() => {
    chartRef.current?.setOption({
      series: [{ markLine: needleMarkLine(periodIndex) }],
    })
  }, [periodIndex, series, observedOnly])

  return (
    <section
      className={
        // 풀스크린 패딩: 명판·계기 클러스터·바로그래프를 피한다 (FlowChart와 동일)
        full
          ? 'fixed inset-0 z-40 flex flex-col gap-2 pb-24 pl-10 pr-28 pt-40'
          : 'flex min-h-0 flex-col'
      }
      style={full ? { background: INK_SHEET_BG } : undefined}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-4">
        <p className="dial-label text-paper-dim/70">
          COMPOSITION STREAM · STOCKS BY ASSET · 2010→
        </p>
        <div className="flex items-baseline gap-3">
          {assets.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={!hidden.has(a)}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev)
                  if (next.has(a)) next.delete(a)
                  else next.add(a)
                  return next
                })
              }
              className="flex items-center gap-1 transition-opacity duration-140"
              style={{ opacity: hidden.has(a) ? 0.3 : 1 }}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5"
                style={{ background: rgbaCss(assetRgb(a), 0.9) }}
              />
              <span
                className={
                  'dial-label text-[9px] text-paper-dim/70 ' +
                  (hidden.has(a) ? 'line-through' : '')
                }
              >
                {ASSET_ABBR[a]}
                {totalNow > 0 && stocksNow.has(a)
                  ? ` ${(((stocksNow.get(a) ?? 0) / totalNow) * 100).toFixed(0)}%`
                  : ''}
              </span>
            </button>
          ))}
          {/* I-5: STREAM/MULTIPLES 보기 전환 — 코드 라벨(로케일 불변) */}
          <span
            role="group"
            aria-label={t('station.viewModeAria')}
            className="flex items-baseline gap-2 border-l border-paper/10 pl-3"
          >
            {(['stream', 'multiples', 'realloc'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => onMode(m)}
                className={
                  'dial-label transition-colors duration-140 ' +
                  (mode === m
                    ? 'text-flow-in'
                    : 'text-paper-dim/50 hover:text-paper')
                }
              >
                {m === 'stream' ? 'STREAM' : m === 'multiples' ? 'MULTIPLES' : 'REALLOC'}
              </button>
            ))}
          </span>
          <span className="border-l border-paper/10 pl-3">
            <ChartControls
              onPng={exportPng}
              onCsv={exportCsv}
              full={{ active: full, toggle: () => setFull((f) => !f) }}
            />
          </span>
        </div>
      </div>
      <div ref={holder} className="min-h-0 flex-1" />
    </section>
  )
}
