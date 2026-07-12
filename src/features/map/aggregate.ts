/**
 * Per-country aggregation for the choropleth and the observation report.
 * Fog is value-weighted so a country whose figure is mostly modelled reads
 * hazier than one with one small estimated tail (DESIGN.md §6).
 */
import type {
  ConfidenceGrade,
  FlowRecord,
  StockRecord,
} from '../../types/data'
import { fogAlpha } from '../../lib/tokens'

export const OBSERVED_GRADES: ReadonlySet<ConfidenceGrade> = new Set([
  'A',
  'B',
])

export interface CountryReading {
  iso3: string
  /** magnitude driving the pressure scale (stocks total or gross flow) */
  value: number
  /** signed net for flow/valuation: Σliabilities − Σassets */
  net?: number
  /** value-weighted fog alpha 0 … 0.45 */
  fog: number
  /** grade carrying the largest share of |value| */
  grade: ConfidenceGrade
  n: number
}

interface Acc {
  total: number
  net: number
  fogW: number
  byGrade: Map<ConfidenceGrade, number>
  n: number
}

function finish(iso3: string, a: Acc, withNet: boolean): CountryReading {
  let grade: ConfidenceGrade = 'E'
  let max = -1
  for (const [g, v] of a.byGrade) {
    if (v > max) {
      max = v
      grade = g
    }
  }
  return {
    iso3,
    value: a.total,
    net: withNet ? a.net : undefined,
    fog: a.total > 0 ? a.fogW / a.total : 0,
    grade,
    n: a.n,
  }
}

function add(acc: Map<string, Acc>, iso3: string): Acc {
  let a = acc.get(iso3)
  if (!a) {
    a = { total: 0, net: 0, fogW: 0, byGrade: new Map(), n: 0 }
    acc.set(iso3, a)
  }
  return a
}

export function summarizeStocks(
  records: readonly StockRecord[],
  includeEstimates: boolean,
): Map<string, CountryReading> {
  const acc = new Map<string, Acc>()
  for (const r of records) {
    if (!includeEstimates && !OBSERVED_GRADES.has(r.confidence_grade)) continue
    const a = add(acc, r.country)
    const v = Math.abs(r.value_usd)
    a.total += v
    a.fogW += fogAlpha(r.confidence_grade) * v
    a.byGrade.set(
      r.confidence_grade,
      (a.byGrade.get(r.confidence_grade) ?? 0) + v,
    )
    a.n += 1
  }
  const out = new Map<string, CountryReading>()
  for (const [iso3, a] of acc) out.set(iso3, finish(iso3, a, false))
  return out
}

export function summarizeFlows(
  records: readonly FlowRecord[],
  measure: 'flow' | 'valuation',
  includeEstimates: boolean,
): Map<string, CountryReading> {
  const acc = new Map<string, Acc>()
  for (const r of records) {
    if (r.measure !== measure) continue
    if (!includeEstimates && !OBSERVED_GRADES.has(r.confidence_grade)) continue
    const a = add(acc, r.country)
    const v = Math.abs(r.value_usd)
    a.total += v
    a.net += r.entry === 'liabilities' ? r.value_usd : -r.value_usd
    a.fogW += fogAlpha(r.confidence_grade) * v
    a.byGrade.set(
      r.confidence_grade,
      (a.byGrade.get(r.confidence_grade) ?? 0) + v,
    )
    a.n += 1
  }
  const out = new Map<string, CountryReading>()
  for (const [iso3, a] of acc) out.set(iso3, finish(iso3, a, true))
  return out
}

/**
 * Robust log scale over positive magnitudes (p05–p95) → t ∈ [0, 1].
 * Keeps USA/LUX outliers from flattening everyone else into --pressure-1.
 */
export function logScale(values: Iterable<number>): (v: number) => number {
  const logs: number[] = []
  for (const v of values) if (v > 0) logs.push(Math.log10(v))
  if (logs.length === 0) return () => 0
  logs.sort((a, b) => a - b)
  const lo = logs[Math.floor(logs.length * 0.05)]
  const hi = logs[Math.min(logs.length - 1, Math.floor(logs.length * 0.95))]
  const span = Math.max(hi - lo, 0.5)
  return (v) => {
    if (v <= 0) return 0
    return Math.min(Math.max((Math.log10(v) - lo) / span, 0), 1)
  }
}
