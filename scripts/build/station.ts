/**
 * STATION 사전 집계 — 커밋된 public/data/ 샤드에서 국가별 관측 분석 파일
 * public/data/station/{ISO3}.json + station/WLD.json(세계 집계)을 생성한다.
 * 네트워크 없음. STATION 뷰는 국가당 파일 하나만 lazy-load 한다.
 *
 * 정직성: 잔액 등급·산식·범위(D/E 신뢰구간 밴드)를 레코드에서 그대로 운반.
 * WLD 집계 등급은 가치가중 관측 비중의 매핑값(§6 안개 근거) — obs_share 동반.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUT_DIR, writeJson } from '../fetch/lib.ts'
import type { ReconstructedLiability } from '../../src/types/data.ts'
import type { BilateralRecord, FlowRecord, StockRecord } from './synoptic.ts'
import {
  counterpartyConcentration,
  quarterlyConcentration,
} from './concentration.ts'

export const PARTNER_LIMIT = 15

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
const GRADE_ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 }
const OBSERVED = new Set<Grade>(['A', 'B'])
const worst = (a: Grade | undefined, b: Grade): Grade =>
  a === undefined || GRADE_ORDER[b] > GRADE_ORDER[a] ? b : a

export interface StationPoint {
  period: string
  stock: number
  grade: Grade
  /** D/E 추정 잔액의 신뢰구간 밴드 — 관측(A/B)에선 없음 */
  stock_lower?: number
  stock_upper?: number
  /** 발행자(issuer) basis 병렬 잔액 (의미는 DATA_CONTRACT.md 표) */
  stock_issuer?: number
  issuer_grade?: Grade
  /** BOP: liabilities = 비거주자 유입측, assets = 거주자 유출측 (부호 보존) */
  flow_in: number
  flow_out: number
  flow_grade?: Grade
  valuation: number
  /** §1.5 — 점 단위 계보: 잔액 레코드의 출처(없으면 흐름 출처로 폴백) */
  source_id?: string
  method?: string
  /** WLD 집계 전용: 가치가중 관측(A/B) 비중 */
  obs_share?: number
}

export type StationSeries = Partial<Record<string, StationPoint[]>>

export interface StationPartner {
  country: string
  value: number
  grade: Grade
  source_id: string
  source_ids?: string[]
  effective_date: string
  method?: string
  lower?: number
  upper?: number
  range_label?: string
  coverage_share?: number
}

export interface PartnerSides {
  holdings: StationPartner[]
  holders: StationPartner[]
}

export interface StationSummary {
  latest: string | null
  first: string | null
  stock_total: number
  flow_in: number
  flow_out: number
  valuation: number
  composition: Record<string, number>
  /** 최신 분기 잔액의 가치가중 관측(A/B) 비중 */
  obs_share: number
  n_points: number
}

// ------------------------------------------------------------- series ----

function pointAt(
  byAsset: Map<string, Map<string, StationPoint>>,
  asset: string,
  period: string,
): StationPoint {
  let periods = byAsset.get(asset)
  if (!periods) byAsset.set(asset, (periods = new Map()))
  let p = periods.get(period)
  if (!p) {
    p = { period, stock: 0, grade: 'E', flow_in: 0, flow_out: 0, valuation: 0 }
    periods.set(period, p)
  }
  return p
}

/** 국가 하나의 시계열: owner 잔액 + issuer 병렬 + BOP 흐름·평가변동 병합. */
export function stationSeries(
  owner: readonly StockRecord[],
  issuer: readonly StockRecord[],
  flows: readonly FlowRecord[],
): StationSeries {
  const byAsset = new Map<string, Map<string, StationPoint>>()
  const stockGrade = new Map<StationPoint, Grade>()
  const flowGrade = new Map<StationPoint, Grade>()
  const issuerGrade = new Map<StationPoint, Grade>()

  for (const r of owner) {
    const p = pointAt(byAsset, r.asset, r.period)
    p.stock = r.value_usd
    p.source_id = r.source_id
    stockGrade.set(p, r.confidence_grade)
    if (!OBSERVED.has(r.confidence_grade)) {
      if (r.estimate_method !== undefined) p.method = r.estimate_method
      if (r.lower_bound !== undefined) p.stock_lower = r.lower_bound
      if (r.upper_bound !== undefined) p.stock_upper = r.upper_bound
    }
  }
  for (const r of issuer) {
    const p = pointAt(byAsset, r.asset, r.period)
    p.stock_issuer = r.value_usd
    p.issuer_grade = r.confidence_grade
    issuerGrade.set(p, r.confidence_grade)
  }
  for (const r of flows) {
    const p = pointAt(byAsset, r.asset, r.period)
    if (r.measure === 'valuation') {
      p.valuation += r.value_usd
    } else {
      if (r.entry === 'liabilities') p.flow_in += r.value_usd
      else p.flow_out += r.value_usd
      p.flow_grade = worst(p.flow_grade, r.confidence_grade)
      flowGrade.set(p, p.flow_grade)
      p.source_id ??= r.source_id // 잔액 없는 점은 흐름 출처로 폴백
    }
  }

  const out: StationSeries = {}
  for (const [asset, periods] of byAsset) {
    const pts = [...periods.values()].sort((a, b) =>
      a.period.localeCompare(b.period),
    )
    for (const p of pts) {
      // 잔액 등급 우선, 없으면 흐름/발행자 등급으로 정직하게 폴백
      p.grade =
        stockGrade.get(p) ?? flowGrade.get(p) ?? issuerGrade.get(p) ?? 'E'
    }
    out[asset] = pts
  }
  return out
}

// ----------------------------------------------------------- partners ----

const toPartner = (r: BilateralRecord, country: string): StationPartner => ({
  country,
  value: r.value_usd,
  grade: r.confidence_grade,
  source_id: r.source_id,
  effective_date: r.effective_date,
  ...(r.estimate_method !== undefined && { method: r.estimate_method }),
  ...(r.lower_bound !== undefined && { lower: r.lower_bound }),
  ...(r.upper_bound !== undefined && { upper: r.upper_bound }),
})

const toReconstructedPartner = (
  r: BilateralRecord,
  country: string,
  bottomUpTotal: number,
  aggregate: ReconstructedLiability,
): StationPartner => {
  const share = r.value_usd / bottomUpTotal
  const scaled = [aggregate.lower_bound * share, aggregate.upper_bound * share]
  return {
    country,
    value: aggregate.value_usd * share,
    grade: 'C',
    source_id: r.source_id,
    source_ids: aggregate.source_ids,
    effective_date: r.effective_date,
    method: 'counterparty_assets_transposed_with_proportional_top_down_corridor',
    lower: Math.min(...scaled),
    upper: Math.max(...scaled),
    range_label: 'proportional bottom-up ↔ top-down corridor',
    coverage_share: aggregate.coverage_share,
  }
}

const capSort = (rows: StationPartner[]): StationPartner[] =>
  rows
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, PARTNER_LIMIT)

/** 방향별 상대국 합산(ALL 의사-자산): 등급은 구성 레코드의 worst — 정직성. */
function aggregateAll(rows: readonly StationPartner[]): StationPartner[] {
  const byCountry = new Map<string, { sum: StationPartner; n: number }>()
  for (const r of rows) {
    const acc = byCountry.get(r.country)
    if (!acc) {
      byCountry.set(r.country, { sum: { ...r }, n: 1 })
    } else {
      acc.sum.value += r.value
      acc.sum.grade = worst(acc.sum.grade, r.grade)
      acc.n++
    }
  }
  return capSort(
    [...byCountry.values()].map(({ sum, n }) => {
      if (n === 1) return sum
      const components = rows.filter((row) => row.country === sum.country)
      for (const component of components) {
        if (
          !OBSERVED.has(component.grade) &&
          (component.lower === undefined || component.upper === undefined)
        )
          throw new Error(
            `[station] derived partner ${component.country} lacks a finite range`,
          )
      }
      return {
        country: sum.country,
        value: sum.value,
        grade: sum.grade,
        source_id: sum.source_id,
        source_ids: [
          ...new Set(
            components.flatMap((component) =>
              component.source_ids ?? [component.source_id],
            ),
          ),
        ].sort(),
        effective_date: sum.effective_date,
        method: 'sum_of_partner_positions_across_assets',
        lower: components.reduce(
          (total, component) => total + (component.lower ?? component.value),
          0,
        ),
        upper: components.reduce(
          (total, component) => total + (component.upper ?? component.value),
          0,
        ),
        range_label: 'sum of component corridors; observed components are exact',
      }
    }),
  )
}

/**
 * CPIS 포지션(measure=stock)만 사용 — 파생 flow(D)는 상대국 매트릭스에
 * 싣지 않는다. holdings = 이 나라가 보유한 상대 / holders = 이 나라를 보유.
 */
export function stationPartners(
  bilat: readonly BilateralRecord[],
  iso3: string,
  reconstructed: readonly ReconstructedLiability[] = [],
): Record<string, { all: PartnerSides; assets: Record<string, PartnerSides> }> {
  const reconstructedByKey = new Map(
    reconstructed.map((row) => [`${row.period}|${row.asset}`, row]),
  )
  const reconstructedTotals = new Map<string, number>()
  for (const r of bilat) {
    if (r.measure !== 'stock' || r.source_id !== 'imf_pip') continue
    const key = `${r.issuer_country}|${r.period}|${r.asset}`
    reconstructedTotals.set(key, (reconstructedTotals.get(key) ?? 0) + r.value_usd)
  }
  const byPeriod = new Map<
    string,
    Map<string, { holdings: StationPartner[]; holders: StationPartner[] }>
  >()
  for (const r of bilat) {
    if (r.measure !== 'stock') continue
    const mine = r.owner_country === iso3
    if (!mine && r.issuer_country !== iso3) continue
    let assets = byPeriod.get(r.period)
    if (!assets) byPeriod.set(r.period, (assets = new Map()))
    let sides = assets.get(r.asset)
    if (!sides) assets.set(r.asset, (sides = { holdings: [], holders: [] }))
    if (mine) sides.holdings.push(toPartner(r, r.issuer_country))
    else if (r.source_id === 'imf_pip') {
      const total = reconstructedTotals.get(`${iso3}|${r.period}|${r.asset}`) ?? r.value_usd
      const aggregate = reconstructedByKey.get(`${r.period}|${r.asset}`)
      if (aggregate && total > 0)
        sides.holders.push(
          toReconstructedPartner(r, r.owner_country, total, aggregate),
        )
    } else sides.holders.push(toPartner(r, r.owner_country))
  }

  const out: Record<
    string,
    { all: PartnerSides; assets: Record<string, PartnerSides> }
  > = {}
  for (const [period, assets] of byPeriod) {
    const allHoldings: StationPartner[] = []
    const allHolders: StationPartner[] = []
    const perAsset: Record<string, PartnerSides> = {}
    for (const [asset, sides] of assets) {
      allHoldings.push(...sides.holdings)
      allHolders.push(...sides.holders)
      perAsset[asset] = {
        holdings: capSort([...sides.holdings]),
        holders: capSort([...sides.holders]),
      }
    }
    out[period] = {
      all: {
        holdings: aggregateAll(allHoldings),
        holders: aggregateAll(allHolders),
      },
      assets: perAsset,
    }
  }
  return out
}

// -------------------------------------------------------------- world ----

/** 가치가중 관측 비중 → 집계 등급 (WLD 전용, obs_share 동반 노출). */
function shareGrade(share: number): Grade {
  if (share >= 0.95) return 'A'
  if (share >= 0.8) return 'B'
  if (share >= 0.5) return 'C'
  if (share >= 0.25) return 'D'
  return 'E'
}

export function worldSeries(perCountry: readonly StationSeries[]): StationSeries {
  const byAsset = new Map<
    string,
    Map<string, { p: StationPoint; stockObs: number }>
  >()
  for (const series of perCountry) {
    for (const [asset, pts] of Object.entries(series)) {
      if (!pts) continue
      let periods = byAsset.get(asset)
      if (!periods) byAsset.set(asset, (periods = new Map()))
      for (const src of pts) {
        let acc = periods.get(src.period)
        if (!acc) {
          acc = {
            p: {
              period: src.period,
              stock: 0,
              grade: 'E',
              flow_in: 0,
              flow_out: 0,
              valuation: 0,
            },
            stockObs: 0,
          }
          periods.set(src.period, acc)
        }
        acc.p.stock += src.stock
        if (OBSERVED.has(src.grade)) acc.stockObs += src.stock
        acc.p.flow_in += src.flow_in
        acc.p.flow_out += src.flow_out
        acc.p.valuation += src.valuation
        if (src.flow_grade !== undefined)
          acc.p.flow_grade = worst(acc.p.flow_grade, src.flow_grade)
      }
    }
  }
  const out: StationSeries = {}
  for (const [asset, periods] of byAsset) {
    out[asset] = [...periods.values()]
      .map(({ p, stockObs }) => {
        const share = p.stock > 0 ? Math.min(stockObs / p.stock, 1) : 0
        p.obs_share = share
        p.grade = shareGrade(share)
        return p
      })
      .sort((a, b) => a.period.localeCompare(b.period))
  }
  return out
}

// ------------------------------------------------------------ summary ----

export function stationSummary(series: StationSeries): StationSummary {
  let latest: string | null = null
  let first: string | null = null
  let n = 0
  for (const pts of Object.values(series)) {
    for (const p of pts ?? []) {
      n++
      if (latest === null || p.period > latest) latest = p.period
      if (first === null || p.period < first) first = p.period
    }
  }
  const summary: StationSummary = {
    latest,
    first,
    stock_total: 0,
    flow_in: 0,
    flow_out: 0,
    valuation: 0,
    composition: {},
    obs_share: 0,
    n_points: n,
  }
  if (latest === null) return summary
  let obsStock = 0
  for (const [asset, pts] of Object.entries(series)) {
    const p = pts?.find((x) => x.period === latest)
    if (!p) continue
    summary.stock_total += p.stock
    summary.composition[asset] = p.stock
    summary.flow_in += p.flow_in
    summary.flow_out += p.flow_out
    summary.valuation += p.valuation
    obsStock += OBSERVED.has(p.grade) ? p.stock : (p.obs_share ?? 0) * p.stock
  }
  summary.obs_share =
    summary.stock_total > 0 ? Math.min(obsStock / summary.stock_total, 1) : 0
  return summary
}

// ---------------------------------------------------------------- CLI ----

function readShard<T>(dir: string, period: string): T[] {
  const path = join(OUT_DIR, dir, `${period}.json`)
  if (!existsSync(path)) return []
  return (JSON.parse(readFileSync(path, 'utf8')) as { records: T[] }).records
}

function readReconstructed(iso3: string): ReconstructedLiability[] {
  const path = join(OUT_DIR, 'exposure', `${iso3}.json`)
  if (!existsSync(path)) return []
  return (
    JSON.parse(readFileSync(path, 'utf8')) as {
      reconstructed_liabilities?: ReconstructedLiability[]
    }
  ).reconstructed_liabilities ?? []
}

function bucket<T>(map: Map<string, T[]>, key: string, row: T): void {
  const arr = map.get(key)
  if (arr) arr.push(row)
  else map.set(key, [row])
}

export function buildStation(): void {
  const index = JSON.parse(
    readFileSync(join(OUT_DIR, 'index.json'), 'utf8'),
  ) as { periods: Record<string, string[]> }

  const ownerBy = new Map<string, StockRecord[]>()
  const issuerBy = new Map<string, StockRecord[]>()
  const flowsBy = new Map<string, FlowRecord[]>()
  const bilatBy = new Map<string, BilateralRecord[]>()

  for (const p of index.periods.stocks_owner ?? [])
    for (const r of readShard<StockRecord>('stocks_owner', p))
      bucket(ownerBy, r.country, r)
  for (const p of index.periods.stocks_issuer ?? [])
    for (const r of readShard<StockRecord>('stocks_issuer', p))
      bucket(issuerBy, r.country, r)
  for (const p of index.periods.flows_country ?? [])
    for (const r of readShard<FlowRecord>('flows_country', p))
      bucket(flowsBy, r.country, r)
  for (const p of index.periods.flows_bilateral ?? [])
    for (const r of readShard<BilateralRecord>('flows_bilateral', p)) {
      bucket(bilatBy, r.owner_country, r)
      if (r.issuer_country !== r.owner_country)
        bucket(bilatBy, r.issuer_country, r)
    }

  const countries = [
    ...new Set([...ownerBy.keys(), ...issuerBy.keys(), ...flowsBy.keys()]),
  ].sort()

  // 결정론(Phase N): station 파생 파일에 타임스탬프 금지 — 빈티지는 index.json
  let totalBytes = 0

  // 1패스: 시리즈 계산 (세계 집계가 concentration 분모라 쓰기 전에 필요)
  const seriesBy = new Map<string, StationSeries>()
  for (const iso3 of countries) {
    seriesBy.set(
      iso3,
      stationSeries(
        ownerBy.get(iso3) ?? [],
        issuerBy.get(iso3) ?? [],
        flowsBy.get(iso3) ?? [],
      ),
    )
  }
  const wld = worldSeries([...seriesBy.values()])

  // 2패스: concentration(§14 — 세계 대비·자산 구성·상대국 HHI) 포함 쓰기
  for (const iso3 of countries) {
    const series = seriesBy.get(iso3)!
    const bytes = writeJson(`station/${iso3}.json`, {
      iso3,
      summary: stationSummary(series),
      series,
      partners: stationPartners(
        bilatBy.get(iso3) ?? [],
        iso3,
        readReconstructed(iso3),
      ),
      concentration: {
        quarterly: quarterlyConcentration(series, wld),
        // 발행 샤드 전체에서 계산 — top-15 partners 리스트 기반 금지
        counterparty: counterpartyConcentration(bilatBy.get(iso3) ?? [], iso3),
      },
    })
    totalBytes += bytes
    if (bytes >= 5 * 1024 * 1024)
      throw new Error(`[station] ${iso3}.json exceeds the 5MB clause`)
  }

  const wldBytes = writeJson('station/WLD.json', {
    iso3: 'WLD',
    summary: stationSummary(wld),
    series: wld,
    partners: {},
    concentration: {
      quarterly: quarterlyConcentration(wld, wld), // share_of_world ≡ 1
      counterparty: [], // 세계의 '상대국' 집중도는 정의 불가 — 정직한 공백
    },
  })
  totalBytes += wldBytes
  if (wldBytes >= 5 * 1024 * 1024)
    throw new Error('[station] WLD.json exceeds the 5MB clause')

  writeJson('station/index.json', { countries })
  console.log(
    `[station] ${countries.length} countries + WLD — ` +
      `${(totalBytes / 1024 / 1024).toFixed(1)}MiB total`,
  )
}

if (process.argv[1]?.endsWith('station.ts')) buildStation()
