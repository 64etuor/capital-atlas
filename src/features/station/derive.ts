/**
 * STATION 파생 계산 — StationFile → 차트 배열/계기 값. 순수 함수만.
 * VIS=OBS 규칙: 잔액은 관측(A/B) 점만, 흐름은 flow_grade 관측만,
 * 평가변동(파생 C)은 전부 소멸(§6).
 */
import type {
  AssetClass,
  StationCpConcentration,
  StationFile,
  StationPoint,
  StationQuarterlyConcentration,
} from '../../types/data'
import { indexFromPeriod, periodCount } from '../../lib/periods'
import { OBSERVED_GRADES, STATION_ASSET_ORDER } from './shared'
import type { AssetTab } from './AssetRail'

export type NullableSeries = Array<number | null>

export function assetsPresent(file: StationFile): AssetClass[] {
  return STATION_ASSET_ORDER.filter((a) => file.series[a]?.length)
}

/**
 * LCU 차트 데이터 (Phase L): 전 금액 필드를 그 점의 분기 환율로 변환한 사본.
 * 환율이 없는 분기의 점은 드랍(정직한 갭 — 통화 혼합 금지). USD 모드에선
 * 호출하지 않는다. 도시에 원값은 항상 원본(USD) 파일에서 만든다.
 */
export function convertStationFile(
  file: StationFile,
  convertAt: (valueUsd: number, period: StationPoint['period']) => number | null,
): StationFile {
  const series: StationFile['series'] = {}
  for (const [asset, points] of Object.entries(file.series) as Array<
    [AssetClass, StationPoint[]]
  >) {
    series[asset] = points.flatMap((p) => {
      const rate1 = convertAt(1, p.period)
      if (rate1 === null) return []
      const cv = (v: number) => v * rate1
      return [
        {
          ...p,
          stock: cv(p.stock),
          stock_lower: p.stock_lower !== undefined ? cv(p.stock_lower) : undefined,
          stock_upper: p.stock_upper !== undefined ? cv(p.stock_upper) : undefined,
          stock_issuer:
            p.stock_issuer !== undefined ? cv(p.stock_issuer) : undefined,
          flow_in: cv(p.flow_in),
          flow_out: cv(p.flow_out),
          valuation: cv(p.valuation),
        },
      ]
    })
  }
  return { ...file, series }
}

const tabAssets = (file: StationFile, tab: AssetTab): AssetClass[] =>
  tab === 'all' ? assetsPresent(file) : [tab]

/** 흐름 분해 배열 — x축은 전체 분기, 없는 분기는 null(정직한 갭). */
export function flowArrays(
  file: StationFile,
  tab: AssetTab,
  observedOnly: boolean,
): { flowIn: NullableSeries; flowOut: NullableSeries; valuation: NullableSeries } {
  const n = periodCount()
  const flowIn: NullableSeries = Array.from({ length: n }, () => null)
  const flowOut: NullableSeries = Array.from({ length: n }, () => null)
  const valuation: NullableSeries = Array.from({ length: n }, () => null)
  for (const asset of tabAssets(file, tab)) {
    for (const p of file.series[asset] ?? []) {
      const i = indexFromPeriod(p.period)
      if (i < 0 || i >= n) continue
      if (
        p.flow_grade !== undefined &&
        (!observedOnly || OBSERVED_GRADES.has(p.flow_grade))
      ) {
        flowIn[i] = (flowIn[i] ?? 0) + p.flow_in
        flowOut[i] = (flowOut[i] ?? 0) + p.flow_out
      }
      if (!observedOnly && p.valuation !== 0) {
        valuation[i] = (valuation[i] ?? 0) + p.valuation
      }
    }
  }
  return { flowIn, flowOut, valuation }
}

/** 그 분기(index) 이하 가장 가까운 점 — 연간 시리즈(발행자 시총 등) 대응. */
export function nearestPoint(
  points: readonly StationPoint[],
  periodIndex: number,
): StationPoint | null {
  let best: StationPoint | null = null
  for (const p of points) {
    const i = indexFromPeriod(p.period)
    if (i <= periodIndex && (best === null || i > indexFromPeriod(best.period)))
      best = p
  }
  return best
}

export interface StockReading {
  total: number
  obsTotal: number
  points: StationPoint[]
}

/** 현재 분기 잔액 합(자산별 nearest≤) + 가치가중 관측분. */
export function stockAt(
  file: StationFile,
  tab: AssetTab,
  periodIndex: number,
  observedOnly: boolean,
): StockReading {
  let total = 0
  let obsTotal = 0
  const points: StationPoint[] = []
  for (const asset of tabAssets(file, tab)) {
    const p = nearestPoint(file.series[asset] ?? [], periodIndex)
    if (!p) continue
    const obs =
      OBSERVED_GRADES.has(p.grade) ||
      (p.obs_share !== undefined && p.obs_share >= 0.8)
    if (observedOnly && !obs && p.obs_share === undefined) continue
    const value = p.obs_share !== undefined && observedOnly
      ? p.stock * p.obs_share // WLD 집계: 관측분만
      : p.stock
    total += value
    obsTotal += p.obs_share !== undefined ? p.stock * p.obs_share : obs ? p.stock : 0
    points.push(p)
  }
  return { total, obsTotal, points }
}

/** 흐름 강도(초안 §14): 최근 4분기 순흐름 / 기초·기말 평균 잔액. */
export function flowIntensity(
  file: StationFile,
  tab: AssetTab,
  periodIndex: number,
  observedOnly: boolean,
): { intensity: number | null; net4: number } {
  const { flowIn, flowOut } = flowArrays(file, tab, observedOnly)
  let net4 = 0
  let seen = false
  for (let i = Math.max(periodIndex - 3, 0); i <= periodIndex; i++) {
    if (flowIn[i] === null && flowOut[i] === null) continue
    seen = true
    net4 += (flowIn[i] ?? 0) - (flowOut[i] ?? 0)
  }
  const open = stockAt(file, tab, Math.max(periodIndex - 4, 0), observedOnly).total
  const close = stockAt(file, tab, periodIndex, observedOnly).total
  const avg = (open + close) / 2
  return { intensity: seen && avg > 0 ? net4 / avg : null, net4 }
}

/** §14 집중도 — PIP/DIP/BIS 가용 샤드의 nearest≤ 시점을 선택. */
export function concentrationAt(
  file: StationFile,
  tab: AssetTab,
  periodIndex: number,
): {
  quarterly: StationQuarterlyConcentration | null
  cp: StationCpConcentration | null
} {
  let quarterly: StationQuarterlyConcentration | null = null
  for (const q of file.concentration.quarterly) {
    const i = indexFromPeriod(q.period)
    if (i <= periodIndex && (!quarterly || i > indexFromPeriod(quarterly.period)))
      quarterly = q
  }
  const scope = tab === 'all' ? 'all' : tab
  let cp: StationCpConcentration | null = null
  for (const c of file.concentration.counterparty) {
    if (c.scope !== scope) continue
    const i = indexFromPeriod(c.period)
    if (i <= periodIndex && (!cp || i > indexFromPeriod(cp.period))) cp = c
  }
  return { quarterly, cp }
}

/** HHI 관용 구간 (미 법무부 합병 가이드라인 관행: 0.15/0.25). */
export function hhiClass(hhi: number): 'CONCENTRATED' | 'MODERATE' | 'DIVERSE' {
  return hhi >= 0.25 ? 'CONCENTRATED' : hhi >= 0.15 ? 'MODERATE' : 'DIVERSE'
}

/** YoY 잔액 변화율 — 4분기 전 nearest≤ 대비. */
export function yoyStock(
  file: StationFile,
  tab: AssetTab,
  periodIndex: number,
  observedOnly: boolean,
): number | null {
  const now = stockAt(file, tab, periodIndex, observedOnly).total
  const prev = stockAt(file, tab, periodIndex - 4, observedOnly).total
  return prev > 0 && now > 0 ? now / prev - 1 : null
}
