/**
 * 자산 상세 — 잔액 추이 + D/E 신뢰구간 밴드. 불확실성이 차트에 그려지는
 * 이 뷰의 서명: 관측(A/B)=실선, 추정(C–E)=파선 + lower/upper 밴드(§6).
 * VIS=OBS면 추정 선·밴드가 문자 그대로 소멸한다. 발행자 basis 병렬 잔액은
 * 점선 보조선 (의미는 DATA_CONTRACT.md의 issuer 표).
 */
import { useEffect, useRef } from 'react'
import type { StationPoint } from '../../types/data'
import { indexFromPeriod } from '../../lib/periods'
import { formatUsd } from '../../lib/format'
import { rgbVar, rgbaCss } from '../../lib/tokens'
import {
  OBSERVED_GRADES,
  echarts,
  fullPeriods,
  monoTooltip,
  needleMarkLine,
  periodAxis,
  usdAxis,
  wireClickToPeriod,
} from './shared'

interface Props {
  points: StationPoint[]
  observedOnly: boolean
  periodIndex: number
  onPickPeriod: (index: number) => void
  /** 현재 분기 잔액 리드아웃 클릭 → 계보 도시에 (§1.5) */
  onOpenCurrent: (() => void) | null
  currentLabel: string | null
}

export function StockBandChart({
  points,
  observedOnly,
  periodIndex,
  onPickPeriod,
  onOpenCurrent,
  currentLabel,
}: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const pickRef = useRef(onPickPeriod)
  useEffect(() => {
    pickRef.current = onPickPeriod
  })

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const chart = echarts.init(el, null, { renderer: 'canvas' })
    chartRef.current = chart
    const periods = fullPeriods()
    const n = periods.length
    const paperDim = rgbVar('--color-paper-dim')
    const p2 = rgbVar('--color-pressure-2')
    const p3 = rgbVar('--color-pressure-3')

    const observed: Array<number | null> = Array.from({ length: n }, () => null)
    const estimated: Array<number | null> = Array.from({ length: n }, () => null)
    const lower: Array<number | null> = Array.from({ length: n }, () => null)
    const diff: Array<number | null> = Array.from({ length: n }, () => null)
    const issuer: Array<number | null> = Array.from({ length: n }, () => null)
    const byIdx = new Map(points.map((p) => [indexFromPeriod(p.period), p]))

    for (const [i, p] of byIdx) {
      const obs = OBSERVED_GRADES.has(p.grade)
      if (obs) observed[i] = p.stock
      else if (!observedOnly) {
        estimated[i] = p.stock
        if (p.stock_lower !== undefined && p.stock_upper !== undefined) {
          lower[i] = p.stock_lower
          diff[i] = p.stock_upper - p.stock_lower
        }
      }
      if (p.stock_issuer !== undefined && (!observedOnly || OBSERVED_GRADES.has(p.issuer_grade ?? 'E')))
        issuer[i] = p.stock_issuer
    }
    // 관측→추정 경계 연결: 추정 파선이 마지막 관측점에서 이어져 보이게
    if (!observedOnly) {
      for (let i = 0; i < n; i++) {
        if (estimated[i] !== null) {
          if (i > 0 && observed[i - 1] !== null && estimated[i - 1] === null)
            estimated[i - 1] = observed[i - 1]
          if (i + 1 < n && observed[i + 1] !== null && estimated[i + 1] === null)
            estimated[i + 1] = observed[i + 1]
        }
      }
    }

    chart.setOption({
      backgroundColor: 'transparent',
      animationDuration: 280,
      grid: { left: 46, right: 8, top: 10, bottom: 20 },
      tooltip: {
        ...monoTooltip(),
        trigger: 'axis',
        formatter: (params: Array<{ dataIndex: number }>) => {
          const i = params[0]?.dataIndex ?? 0
          const p = byIdx.get(i)
          if (!p) return periods[i]
          const rows = [
            `<b>${periods[i]}</b>`,
            `STOCK ${formatUsd(p.stock, 1)} · ${p.grade}`,
          ]
          if (p.stock_lower !== undefined && p.stock_upper !== undefined)
            rows.push(
              `BAND ${formatUsd(p.stock_lower, 1)}–${formatUsd(p.stock_upper, 1)}`,
            )
          if (p.stock_issuer !== undefined)
            rows.push(`ISSUER ${formatUsd(p.stock_issuer, 1)}`)
          return rows.join('<br/>')
        },
      },
      xAxis: periodAxis(periods),
      yAxis: usdAxis(),
      series: [
        // D/E 신뢰구간 밴드 — lower(투명) 위에 diff를 쌓는 고전 기법
        {
          name: 'band-lower',
          type: 'line',
          data: lower,
          stack: 'band',
          showSymbol: false,
          silent: true,
          lineStyle: { width: 0, opacity: 0 },
        },
        {
          name: 'band',
          type: 'line',
          data: diff,
          stack: 'band',
          showSymbol: false,
          silent: true,
          lineStyle: { width: 0, opacity: 0 },
          areaStyle: { color: rgbaCss(p2, 0.22) },
        },
        {
          name: 'observed',
          type: 'line',
          data: observed,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: rgbaCss(p3, 1), width: 1.6 },
        },
        {
          name: 'estimated',
          type: 'line',
          data: estimated,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: rgbaCss(p3, 0.75), width: 1.2, type: [2, 5] },
        },
        {
          name: 'issuer',
          type: 'line',
          data: issuer,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: rgbaCss(paperDim, 0.7), width: 1, type: [1, 3] },
        },
      ],
    })
    wireClickToPeriod(chart, (i) => pickRef.current(i), n)
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [points, observedOnly])

  useEffect(() => {
    chartRef.current?.setOption({
      series: [{ markLine: needleMarkLine(periodIndex) }],
    })
  }, [periodIndex, points, observedOnly])

  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline justify-between gap-4">
        <p className="dial-label text-paper-dim/70">
          STOCK TRAJECTORY · CONFIDENCE BAND
        </p>
        {currentLabel && onOpenCurrent && (
          <button
            type="button"
            onClick={onOpenCurrent}
            className="readout text-[11px] text-paper hover:underline hover:decoration-dotted hover:underline-offset-2"
          >
            {currentLabel}
          </button>
        )}
      </div>
      <div ref={holder} className="min-h-0 flex-1" />
    </section>
  )
}
