/**
 * SYNOPTIC 사전 집계 — 커밋된 public/data/ 샤드에서 대시보드용 단일 파일
 * meta/synoptic.json을 생성한다. 네트워크 없음. 대시보드는 이 파일 하나만
 * lazy-load 한다 (65분기 샤드 순회 금지).
 *
 * 정직성: 모든 셀은 관측(A/B)-한정 변형을 함께 가진다 — VIS=OBS 다이얼이
 * 추정 없는 값을 그대로 보여줄 수 있도록. 등급·산식·범위는 원 레코드에서
 * 그대로 운반한다(§1.5 — 계보 없는 숫자 금지).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUT_DIR, writeJson } from '../fetch/lib.ts'
import {
  corridorConcentration,
  type CorridorConcentration,
} from './concentration.ts'

export const CORRIDOR_LIMIT = 20
export const ANOMALY_LIMIT = 12

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
const OBSERVED = new Set<Grade>(['A', 'B'])

interface Lineage {
  source_id: string
  effective_date: string
  confidence_grade: Grade
  estimate_method?: string
  lower_bound?: number
  upper_bound?: number
}

export interface StockRecord extends Lineage {
  country: string
  asset: string
  period: string
  measure: 'stock'
  value_usd: number
}

export interface FlowRecord extends Lineage {
  country: string
  asset: string
  period: string
  measure: 'flow' | 'valuation'
  entry: 'assets' | 'liabilities'
  value_usd: number
}

export interface BilateralRecord extends Lineage {
  owner_country: string
  issuer_country: string
  asset: string
  period: string
  measure: 'stock' | 'flow'
  value_usd: number
}

export interface SynopticCell {
  stock: number
  stock_obs: number
  flow_in: number // Σ liabilities-side (nonresident inflow, signed)
  flow_in_obs: number
  flow_out: number // Σ assets-side (resident outflow, signed)
  flow_out_obs: number
  flow_gross: number // Σ|value| both sides — circulation intensity
  flow_gross_obs: number
  valuation: number // Σ signed valuation change (grade C)
  records: number
  obs_share: number // value-weighted stock A/B share, 0..1
  share: number // asset stock ÷ quarter total stock (§14 자산 비중)
  share_obs: number // observed-only variant (VIS=OBS 근거)
}

export interface Corridor {
  owner: string
  issuer: string
  asset: string
  value: number
  grade: Grade
  source_id: string
  effective_date: string
  method?: string
  lower?: number
  upper?: number
}

export interface Anomaly {
  country: string
  asset: string
  entry: 'assets' | 'liabilities'
  value: number
  grade: Grade
  source_id: string
  effective_date: string
  method?: string
  lower?: number
  upper?: number
}

const emptyCell = (): SynopticCell => ({
  stock: 0,
  stock_obs: 0,
  flow_in: 0,
  flow_in_obs: 0,
  flow_out: 0,
  flow_out_obs: 0,
  flow_gross: 0,
  flow_gross_obs: 0,
  valuation: 0,
  records: 0,
  obs_share: 0,
  share: 0,
  share_obs: 0,
})

export function aggregateQuarter(
  stocks: readonly StockRecord[],
  flows: readonly FlowRecord[],
): { cells: Record<string, SynopticCell>; gradeMix: Partial<Record<Grade, number>> } {
  const cells: Record<string, SynopticCell> = {}
  const gradeMix: Partial<Record<Grade, number>> = {}
  const cell = (asset: string) => (cells[asset] ??= emptyCell())
  const count = (g: Grade) => (gradeMix[g] = (gradeMix[g] ?? 0) + 1)

  for (const r of stocks) {
    const c = cell(r.asset)
    c.stock += r.value_usd
    if (OBSERVED.has(r.confidence_grade)) c.stock_obs += r.value_usd
    c.records++
    count(r.confidence_grade)
  }
  for (const r of flows) {
    const c = cell(r.asset)
    const obs = OBSERVED.has(r.confidence_grade)
    if (r.measure === 'valuation') {
      c.valuation += r.value_usd
    } else if (r.entry === 'liabilities') {
      c.flow_in += r.value_usd
      if (obs) c.flow_in_obs += r.value_usd
      c.flow_gross += Math.abs(r.value_usd)
      if (obs) c.flow_gross_obs += Math.abs(r.value_usd)
    } else {
      c.flow_out += r.value_usd
      if (obs) c.flow_out_obs += r.value_usd
      c.flow_gross += Math.abs(r.value_usd)
      if (obs) c.flow_gross_obs += Math.abs(r.value_usd)
    }
    c.records++
    count(r.confidence_grade)
  }
  let totalStock = 0
  let totalObs = 0
  for (const c of Object.values(cells)) {
    totalStock += c.stock
    totalObs += c.stock_obs
  }
  for (const c of Object.values(cells)) {
    c.obs_share = c.stock > 0 ? Math.min(c.stock_obs / c.stock, 1) : 0
    c.share = totalStock > 0 ? c.stock / totalStock : 0
    c.share_obs = totalObs > 0 ? c.stock_obs / totalObs : 0
  }
  return { cells, gradeMix }
}

const toCorridor = (r: BilateralRecord): Corridor => ({
  owner: r.owner_country,
  issuer: r.issuer_country,
  asset: r.asset,
  value: r.value_usd,
  grade: r.confidence_grade,
  source_id: r.source_id,
  effective_date: r.effective_date,
  ...(r.estimate_method !== undefined && { method: r.estimate_method }),
  ...(r.lower_bound !== undefined && { lower: r.lower_bound }),
  ...(r.upper_bound !== undefined && { upper: r.upper_bound }),
})

export function topCorridors(records: readonly BilateralRecord[]): {
  stock: Corridor[]
  flow: Corridor[]
} {
  const pick = (measure: 'stock' | 'flow') =>
    records
      .filter((r) => r.measure === measure)
      .sort((a, b) => Math.abs(b.value_usd) - Math.abs(a.value_usd))
      .slice(0, CORRIDOR_LIMIT)
      .map(toCorridor)
  return { stock: pick('stock'), flow: pick('flow') }
}

/**
 * 자산별 top-N — 대시보드의 자산 필터가 "구성상 빈 화면"이 되지 않게
 * 자산군마다 상한을 따로 가진다. 전역 표시는 UI가 앞에서 N개만 자른다.
 */
export function topAnomalies(flows: readonly FlowRecord[]): Anomaly[] {
  const perAsset = new Map<string, number>()
  return flows
    .filter((r) => r.measure === 'flow')
    .sort((a, b) => Math.abs(b.value_usd) - Math.abs(a.value_usd))
    .filter((r) => {
      const n = perAsset.get(r.asset) ?? 0
      if (n >= ANOMALY_LIMIT) return false
      perAsset.set(r.asset, n + 1)
      return true
    })
    .map((r) => ({
      country: r.country,
      asset: r.asset,
      entry: r.entry,
      value: r.value_usd,
      grade: r.confidence_grade,
      source_id: r.source_id,
      effective_date: r.effective_date,
      ...(r.estimate_method !== undefined && { method: r.estimate_method }),
      ...(r.lower_bound !== undefined && { lower: r.lower_bound }),
      ...(r.upper_bound !== undefined && { upper: r.upper_bound }),
    }))
}

// ------------------------------------------------------------------ CLI ----

function readShard<T>(dir: string, period: string): T[] {
  const path = join(OUT_DIR, dir, `${period}.json`)
  if (!existsSync(path)) return []
  return (JSON.parse(readFileSync(path, 'utf8')) as { records: T[] }).records
}

export function buildSynoptic(): void {
  const index = JSON.parse(
    readFileSync(join(OUT_DIR, 'index.json'), 'utf8'),
  ) as { periods: Record<string, string[]> }
  const periods = index.periods.stocks_owner
  const bilateralPeriods = new Set(index.periods.flows_bilateral ?? [])

  const per_quarter: Record<string, Record<string, SynopticCell>> = {}
  const corridors: Record<string, { stock: Corridor[]; flow: Corridor[] }> = {}
  const corridor_concentration: Record<string, CorridorConcentration> = {}
  const anomalies: Record<string, Anomaly[]> = {}
  const grade_mix: Record<string, Partial<Record<Grade, number>>> = {}
  const assets = new Set<string>()

  for (const p of periods) {
    const stocks = readShard<StockRecord>('stocks_owner', p)
    const flows = readShard<FlowRecord>('flows_country', p)
    const { cells, gradeMix } = aggregateQuarter(stocks, flows)
    per_quarter[p] = cells
    grade_mix[p] = gradeMix
    anomalies[p] = topAnomalies(flows)
    for (const a of Object.keys(cells)) assets.add(a)
    if (bilateralPeriods.has(p)) {
      const bilat = readShard<BilateralRecord>('flows_bilateral', p)
      corridors[p] = topCorridors(bilat)
      // §14 회랑 집중도 — 분모는 샤드 전체 gross (top-20 리스트가 아님)
      corridor_concentration[p] = corridorConcentration(bilat)
    }
  }

  const bytes = writeJson('meta/synoptic.json', {
    generated_at: new Date().toISOString(),
    periods,
    assets: [...assets].sort(),
    per_quarter,
    corridors,
    corridor_concentration,
    anomalies,
    grade_mix,
  })
  console.log(
    `[synoptic] meta/synoptic.json — ${periods.length} quarters, ` +
      `${assets.size} assets, ${(bytes / 1024).toFixed(0)}KiB`,
  )
  if (bytes >= 5 * 1024 * 1024) {
    throw new Error('[synoptic] 5MB sharding clause triggered — shard by decade')
  }
}

if (process.argv[1]?.endsWith('synoptic.ts')) buildSynoptic()
