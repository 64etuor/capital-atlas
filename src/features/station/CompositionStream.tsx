/**
 * 자산 구성 스트림 — 65분기 스택 area, 자산별 기압 램프 색. VIS=OBS면
 * 추정 점이 문자 그대로 소멸(§6 — null 갭). 추정 비중이 큰 시리즈는
 * 안개(투명도)로 가라앉는다. DOM 미니 범례(mono) — 카드 아님.
 */
import { useEffect, useRef, useState } from 'react'
import type { AssetClass, StationPoint } from '../../types/data'
import { indexFromPeriod } from '../../lib/periods'
import { formatUsd } from '../../lib/format'
import { rgbaCss } from '../../lib/tokens'
import { ASSET_ABBR } from '../synoptic/shared'
import {
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

interface Props {
  series: Partial<Record<AssetClass, StationPoint[]>>
  observedOnly: boolean
  periodIndex: number
  onPickPeriod: (index: number) => void
}

export function CompositionStream({
  series,
  observedOnly,
  periodIndex,
  onPickPeriod,
}: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  // 인터랙티브 범례(P1-6) — 시리즈 숨김/고립
  const [hidden, setHidden] = useState<ReadonlySet<AssetClass>>(new Set())
  const pickRef = useRef(onPickPeriod)
  useEffect(() => {
    pickRef.current = onPickPeriod
  })

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
            .map((p) => `${p.seriesName}&nbsp;${formatUsd(p.value ?? 0, 1)}`)
          return [`<b>${periods[i]}</b>`, ...rows].join('<br/>')
        },
      },
      xAxis: periodAxis(periods),
      yAxis: usdAxis(),
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
  }, [series, observedOnly, hidden])

  useEffect(() => {
    chartRef.current?.setOption({
      series: [{ markLine: needleMarkLine(periodIndex) }],
    })
  }, [periodIndex, series, observedOnly])

  return (
    <section className="flex min-h-0 flex-col">
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
        </div>
      </div>
      <div ref={holder} className="min-h-0 flex-1" />
    </section>
  )
}
