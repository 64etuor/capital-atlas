/**
 * STATION 공용 — ECharts 코어 등록(1회), BAROMETER 스킨 조각(§2·§3:
 * 잉크 툴팁·mono 축), 전체-분기 x축 정본, 자산 색(기압 램프 고정 위치),
 * 차트 클릭→분기 스크럽 변환.
 */
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type {
  AssetClass,
  ConfidenceGrade,
  PeriodKey,
} from '../../types/data'
import {
  indexFromPeriod,
  periodCount,
  periodFromIndex,
} from '../../lib/periods'
import { formatUsd } from '../../lib/format'
import { pressureColor, rgbVar, rgbaCss, type RGB } from '../../lib/tokens'

echarts.use([
  BarChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  CanvasRenderer,
])
export { echarts }

export const OBSERVED_GRADES: ReadonlySet<ConfidenceGrade> = new Set([
  'A',
  'B',
])

/** 잉크 시트 배경(§2) — STATION 루트·풀스크린 차트 시트 공용. */
export const INK_SHEET_BG =
  'linear-gradient(180deg, var(--atlas-ink-0) 0%, var(--atlas-ink-1) 55%, var(--atlas-ink-2) 130%)'

/** x축 정본: 타임라인 전체 분기 — 시리즈는 없는 분기를 null로 둔다. */
export function fullPeriods(): PeriodKey[] {
  return Array.from({ length: periodCount() }, (_, i) => periodFromIndex(i))
}

export function quarterEnd(period: PeriodKey): string {
  const [y, q] = period.split('-Q')
  return `${y}-${['03-31', '06-30', '09-30', '12-31'][Number(q) - 1]}`
}

/** 자산 → 기압 램프(심해→여명) 고정 위치. 색만으로 겹치지 않게 분산. */
const ASSET_T: Record<AssetClass, number> = {
  debt_securities: 0.04,
  deposits: 0.22,
  commodities: 0.33,
  listed_equity: 0.46,
  residential_property: 0.55,
  loans: 0.64,
  funds: 0.72,
  unlisted_equity_fdi: 0.82,
  crypto: 0.9,
  reserves_gold: 0.98,
}
export const assetRgb = (asset: AssetClass): RGB => pressureColor(ASSET_T[asset])

export const STATION_ASSET_ORDER: readonly AssetClass[] = [
  'debt_securities',
  'deposits',
  'listed_equity',
  'loans',
  'unlisted_equity_fdi',
  'funds',
  'reserves_gold',
  'residential_property',
  'commodities',
  'crypto',
]

// ---------------------------------------------------------- skin pieces ----

export function monoTooltip() {
  return {
    backgroundColor: rgbaCss(rgbVar('--color-ink-0'), 0.95),
    borderColor: rgbaCss(rgbVar('--color-paper'), 0.15),
    borderWidth: 1,
    padding: [4, 8] as [number, number],
    textStyle: {
      color: rgbaCss(rgbVar('--color-paper'), 0.92),
      fontFamily: '"Spline Sans Mono Variable", monospace',
      fontSize: 11,
    },
    extraCssText: 'border-radius:0;box-shadow:none;',
  }
}

const monoAxisLabel = () => ({
  color: rgbaCss(rgbVar('--color-paper-dim'), 0.85),
  fontFamily: '"Spline Sans Mono Variable", monospace',
  fontSize: 9,
})

/** 카테고리 x축: 짝수 해 Q1에만 'YY 라벨 — 바로그래프 눈금과 같은 어법. */
export function periodAxis(periods: readonly PeriodKey[]) {
  return {
    type: 'category' as const,
    data: [...periods],
    axisTick: { show: false },
    axisLine: {
      lineStyle: { color: rgbaCss(rgbVar('--color-paper'), 0.12) },
    },
    axisLabel: {
      ...monoAxisLabel(),
      interval: 0,
      formatter: (v: string) =>
        v.endsWith('Q1') && Number(v.slice(0, 4)) % 2 === 0
          ? `'${v.slice(2, 4)}`
          : '',
    },
  }
}

export function usdAxis(fmt?: (v: number, digits?: number) => string) {
  return {
    type: 'value' as const,
    axisLabel: {
      ...monoAxisLabel(),
      formatter: (v: number) => (fmt ?? formatUsd)(v, 0),
    },
    axisLine: { show: false },
    splitLine: {
      lineStyle: { color: rgbaCss(rgbVar('--color-paper'), 0.06) },
    },
  }
}

/** 현재 분기 니들 — 바로그래프와 동기화되는 수직 마크라인. */
export function needleMarkLine(periodIndex: number) {
  return {
    silent: true,
    symbol: 'none',
    animation: false,
    label: { show: false },
    lineStyle: { color: rgbaCss(rgbVar('--color-flow-in'), 0.45), width: 1 },
    data: [{ xAxis: periodIndex }],
  }
}

/**
 * 차트 여백 클릭 = 그 분기로 스크럽 (지도 빨리감기와 같은 문법).
 * suppressed: 직전 제스처가 브러시 드래그였을 때 클릭 오발동 차단 (P1-8).
 */
export function wireClickToPeriod(
  chart: echarts.ECharts,
  onPick: (index: number) => void,
  count: number,
  suppressed?: () => boolean,
): void {
  chart.getZr().on('click', (e: { offsetX: number; offsetY: number }) => {
    if (suppressed?.()) return
    const converted = chart.convertFromPixel({ gridIndex: 0 }, [
      e.offsetX,
      e.offsetY,
    ]) as unknown as [number, number] | null
    const idx = converted ? Math.round(converted[0]) : Number.NaN
    if (Number.isFinite(idx) && idx >= 0 && idx < count) onPick(idx)
  })
}

// ------------------------------------------------------- event pins (P2-13) ----

/** 흐름 급변 판독 앵커 — 라벨 번역은 호출부(t) 책임. */
export const EVENT_PINS = [
  { period: '2011-Q3' as PeriodKey, key: 'euro' as const },
  { period: '2020-Q1' as PeriodKey, key: 'covid' as const },
  { period: '2022-Q1' as PeriodKey, key: 'tightening' as const },
]

export function annotationMarkLine(labels: Record<string, string>) {
  return {
    silent: true,
    symbol: 'none',
    animation: false,
    lineStyle: {
      color: rgbaCss(rgbVar('--color-paper-dim'), 0.3),
      width: 1,
      type: [2, 4] as [number, number],
    },
    label: {
      show: true,
      position: 'insideEndTop' as const,
      color: rgbaCss(rgbVar('--color-paper-dim'), 0.75),
      fontFamily: '"Spline Sans Mono Variable", monospace',
      fontSize: 8,
      formatter: (p: { name?: string }) => p.name ?? '',
    },
    data: EVENT_PINS.map((pin, i) => ({
      name: labels[pin.key],
      xAxis: indexFromPeriod(pin.period),
      // I-0: 첫 핀(2011)은 y축과 근접 — 라벨을 선 오른쪽으로 정렬
      ...(i === 0 && { label: { align: 'left' as const, padding: [0, 0, 0, 3] } }),
    })),
  }
}
