/**
 * 흐름 분해 차트 — 유동 판단의 핵심(§15.2). 분기 발산 바(유입 amber ↑ /
 * 유출 cyan ↓) + 순흐름 라인. 평가변동은 **별도 시각층**(파선, §6 C-등급
 * 어법) — 실거래 막대에 절대 합산하지 않는다. 클릭 = 그 분기로 스크럽.
 * 수치 리드아웃은 버튼 — 어떤 숫자든 계보 도시에(§1.5).
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatUsd, formatUsdNet } from '../../lib/format'
import { rgbVar, rgbaCss } from '../../lib/tokens'
import {
  attributionFor,
  csvFilename,
  downloadCsv,
  exportEchartsPng,
  serializeCsv,
} from '../../lib/exportChart'
import { ChartControls } from '../../components/ChartControls'
import { useFullscreenEsc } from '../../lib/useFullscreenEsc'
import type { PeriodKey } from '../../types/data'
import {
  INK_SHEET_BG,
  annotationMarkLine,
  echarts,
  fullPeriods,
  monoTooltip,
  needleMarkLine,
  periodAxis,
  usdAxis,
  wireClickToPeriod,
} from './shared'

export interface FlowReadout {
  label: string
  value: string
  tone: 'in' | 'out' | 'paper' | 'dim'
  onClick: () => void
}

/** 내보내기 파일명·메타·출처 해석에 필요한 맥락 (I-1). */
export interface ChartExportCtx {
  country: string
  countryName: string
  asset: string
  period: PeriodKey
  sourceIds: string[]
}

interface Props {
  title: string
  flowIn: Array<number | null>
  flowOut: Array<number | null>
  valuation: Array<number | null>
  observedOnly: boolean
  periodIndex: number
  onPickPeriod: (index: number) => void
  readouts: FlowReadout[]
  exportCtx: ChartExportCtx
  /** Phase L: LCU 표시 — 이미 변환된 수의 포맷터 (기본 USD) */
  fmtNet?: (v: number, digits?: number) => string
  fmtValue?: (v: number, digits?: number) => string
}

const TONE: Record<FlowReadout['tone'], string> = {
  in: 'text-flow-in',
  out: 'text-flow-out',
  paper: 'text-paper',
  dim: 'text-paper-dim',
}

export function FlowChart({
  title,
  flowIn,
  flowOut,
  valuation,
  observedOnly,
  periodIndex,
  onPickPeriod,
  readouts,
  exportCtx,
  fmtNet = formatUsdNet,
  fmtValue = formatUsd,
}: Props) {
  const { t, i18n } = useTranslation()
  const holder = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const pickRef = useRef(onPickPeriod)
  // 브러시 드래그 직후의 zr click 오발동 차단 (P1-8)
  const brushRef = useRef(false)
  const [zoomed, setZoomed] = useState(false)
  // 풀스크린 시트 (I-3) — 인스턴스 로컬, Esc는 오버레이 계층 존중
  const [full, setFull] = useState(false)
  useFullscreenEsc(full, () => setFull(false))

  const exportPng = () => {
    const chart = chartRef.current
    if (!chart) return
    void attributionFor(exportCtx.sourceIds).then((attribution) =>
      exportEchartsPng(chart, {
        filename: csvFilename(
          exportCtx.country,
          exportCtx.asset,
          exportCtx.period,
        ).replace(/\.csv$/, '.png'),
        title: `${exportCtx.countryName} — flow decomposition`,
        attribution,
      }),
    )
  }
  const exportCsv = () => {
    const periods = fullPeriods()
    const rows = periods.map((p, i) => ({
      period: p,
      flow_in: flowIn[i],
      flow_out: flowOut[i],
      net:
        flowIn[i] === null && flowOut[i] === null
          ? null
          : (flowIn[i] ?? 0) - (flowOut[i] ?? 0),
      valuation: observedOnly ? null : valuation[i],
    }))
    void attributionFor(exportCtx.sourceIds).then((attribution) =>
      downloadCsv(
        csvFilename(exportCtx.country, exportCtx.asset, exportCtx.period),
        serializeCsv({
          meta: {
            Country: exportCtx.countryName,
            Asset: exportCtx.asset,
            View: observedOnly ? 'observed-only' : 'observed+estimated',
            Source: attribution.replace(/^Source: /, ''),
            Generated: new Date().toISOString().slice(0, 10),
          },
          columns: [
            { key: 'period', label: 'period' },
            { key: 'flow_in', label: 'flow_in_usd' },
            { key: 'flow_out', label: 'flow_out_usd' },
            { key: 'net', label: 'net_usd' },
            { key: 'valuation', label: 'valuation_usd_derived_C' },
          ],
          rows,
        }),
      ),
    )
  }
  useEffect(() => {
    pickRef.current = onPickPeriod
  })

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const chart = echarts.init(el, null, { renderer: 'canvas' })
    chartRef.current = chart
    const periods = fullPeriods()
    const amber = rgbVar('--color-flow-in')
    const cyan = rgbVar('--color-flow-out')
    const paper = rgbVar('--color-paper')
    const net = periods.map((_, i) =>
      flowIn[i] === null && flowOut[i] === null
        ? null
        : (flowIn[i] ?? 0) - (flowOut[i] ?? 0),
    )

    chart.setOption({
      backgroundColor: 'transparent',
      animationDuration: 280,
      grid: { left: 46, right: 8, top: 10, bottom: 20 },
      tooltip: {
        ...monoTooltip(),
        trigger: 'axis',
        axisPointer: {
          type: 'line',
          lineStyle: { color: rgbaCss(rgbVar('--color-paper'), 0.25) },
        },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const i = params[0]?.dataIndex ?? 0
          const rows = [
            `<b>${periods[i]}</b>`,
            `IN&nbsp;&nbsp;${fmtNet(flowIn[i] ?? 0)}`,
            `OUT&nbsp;${fmtNet(flowOut[i] ?? 0)}`,
            `NET&nbsp;${fmtNet(net[i] ?? 0)}`,
          ]
          if (!observedOnly && valuation[i] !== null)
            rows.push(`VAL&nbsp;${fmtNet(valuation[i] ?? 0)} · derived C`)
          return rows.join('<br/>')
        },
      },
      xAxis: periodAxis(periods),
      yAxis: usdAxis(fmtValue),
      // 브러시 전용 줌 창(P1-8) — 휠/팬은 비활성, dispatchAction으로만 구동
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'none',
          zoomOnMouseWheel: false,
          moveOnMouseMove: false,
          moveOnMouseWheel: false,
        },
      ],
      series: [
        {
          name: 'IN',
          type: 'bar',
          data: flowIn,
          itemStyle: { color: rgbaCss(rgbVar('--color-flow-in'), 0.85) },
          barCategoryGap: '35%',
          emphasis: { itemStyle: { color: amber } },
        },
        {
          name: 'OUT',
          type: 'bar',
          // 유출은 아래로 발산 — BPM6 부호(양수=거주자 해외자산 취득) 유지한 채 렌더만 반전
          data: flowOut.map((v) => (v === null ? null : -v)),
          barGap: '-100%',
          itemStyle: { color: rgbaCss(rgbVar('--color-flow-out'), 0.8) },
          emphasis: { itemStyle: { color: cyan } },
        },
        {
          name: 'NET',
          type: 'line',
          data: net,
          showSymbol: false,
          lineStyle: { color: rgbaCss(paper, 0.9), width: 1.4 },
          // 역사적 이벤트 주석 (P2-13) — 흐름 급변 판독 앵커
          markLine: annotationMarkLine({
            euro: t('station.annotations.euro'),
            covid: t('station.annotations.covid'),
            tightening: t('station.annotations.tightening'),
          }),
        },
        {
          name: 'VAL',
          type: 'line',
          data: observedOnly ? [] : valuation,
          showSymbol: false,
          lineStyle: {
            color: rgbaCss(rgbVar('--color-paper-dim'), 0.9),
            width: 1,
            type: [7, 4], // §6 — 파생(C) = 파선
          },
        },
      ],
    })
    wireClickToPeriod(
      chart,
      (i) => pickRef.current(i),
      periods.length,
      () => brushRef.current,
    )

    // ── 기간 브러시(P1-8): 수평 드래그 ≥8px = 구간 확대, 클릭은 스크럽 유지 ──
    const sel = document.createElement('div')
    sel.style.cssText =
      'position:absolute;top:0;bottom:20px;display:none;pointer-events:none;' +
      `background:${rgbaCss(amber, 0.07)};` +
      `border-left:1px solid ${rgbaCss(amber, 0.5)};` +
      `border-right:1px solid ${rgbaCss(amber, 0.5)};`
    el.appendChild(sel)
    const zr = chart.getZr()
    let downX: number | null = null
    let dragging = false
    const toIndex = (x: number): number => {
      const conv = chart.convertFromPixel({ gridIndex: 0 }, [x, 0]) as unknown as
        | [number, number]
        | null
      const idx = conv ? Math.round(conv[0]) : 0
      return Math.min(Math.max(idx, 0), periods.length - 1)
    }
    const onDown = (e: { offsetX: number }) => {
      downX = e.offsetX
      dragging = false
      brushRef.current = false
    }
    const onMove = (e: { offsetX: number }) => {
      if (downX === null) return
      if (Math.abs(e.offsetX - downX) > 8) {
        dragging = true
        sel.style.display = 'block'
        sel.style.left = `${Math.min(downX, e.offsetX)}px`
        sel.style.width = `${Math.abs(e.offsetX - downX)}px`
      }
    }
    const onUp = (e: { offsetX: number }) => {
      if (downX !== null && dragging) {
        const a = toIndex(downX)
        const b = toIndex(e.offsetX)
        if (Math.abs(b - a) >= 1) {
          chart.dispatchAction({
            type: 'dataZoom',
            startValue: Math.min(a, b),
            endValue: Math.max(a, b),
          })
          setZoomed(true)
        }
        brushRef.current = true // 이어지는 zr click 1회 무시
      }
      sel.style.display = 'none'
      downX = null
      dragging = false
    }
    zr.on('mousedown', onDown)
    zr.on('mousemove', onMove)
    zr.on('mouseup', onUp)

    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      sel.remove()
      chart.dispose()
      chartRef.current = null
    }
  }, [flowIn, flowOut, valuation, observedOnly, t, i18n.language, fmtNet, fmtValue])

  useEffect(() => {
    chartRef.current?.setOption({
      series: [{ markLine: needleMarkLine(periodIndex) }],
    })
  }, [periodIndex, flowIn, flowOut, valuation, observedOnly])

  return (
    <section
      className={
        // 풀스크린 패딩: 명판(pt-40)·계기 클러스터(pr-28)·바로그래프(pb-24)를
        // 피한다 — 다른 계기는 풀스크린에서도 살아 있는 게 §1.3의 결
        full
          ? 'fixed inset-0 z-40 flex flex-col gap-2 pb-24 pl-10 pr-28 pt-40'
          : 'flex min-h-0 flex-col'
      }
      style={full ? { background: INK_SHEET_BG } : undefined}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-4">
        <p className="dial-label text-paper-dim/70">
          {title}
          {/* I-0: 명시적 · 구분자 — 기간 라벨과 힌트가 로케일 무관하게 분리 */}
          <span className="ml-3 normal-case tracking-normal text-paper-dim/40">
            · {t('station.brushHint')}
          </span>
        </p>
        <div className="flex items-baseline gap-4">
          {zoomed && (
            <button
              type="button"
              onClick={() => {
                chartRef.current?.dispatchAction({
                  type: 'dataZoom',
                  start: 0,
                  end: 100,
                })
                setZoomed(false)
              }}
              className="dial-label whitespace-nowrap text-flow-in transition-colors duration-140 hover:text-paper"
            >
              {t('station.brushReset')}
            </button>
          )}
          {readouts.map((r) => (
            <button
              key={r.label}
              type="button"
              onClick={r.onClick}
              className="group flex items-baseline gap-1.5"
            >
              <span className="dial-label text-paper-dim/60">{r.label}</span>
              <span
                className={`readout text-[11px] ${TONE[r.tone]} group-hover:underline group-hover:decoration-dotted group-hover:underline-offset-2`}
              >
                {r.value}
              </span>
            </button>
          ))}
          <span className="border-l border-paper/10 pl-3">
            <ChartControls
              onPng={exportPng}
              onCsv={exportCsv}
              full={{ active: full, toggle: () => setFull((f) => !f) }}
            />
          </span>
        </div>
      </div>
      <div ref={holder} className="relative min-h-0 flex-1" />
    </section>
  )
}
