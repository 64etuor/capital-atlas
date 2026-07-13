/**
 * Canonical TypeScript contract for the static datasets under `public/data/`.
 * Mirrors docs/DATA_CONTRACT.md — keep the two in sync (contract doc wins).
 *
 * Core principles encoded here (from the product charter):
 * - stocks, transaction flows, valuation changes and turnover are DISTINCT
 *   measures, never a single "money in" number;
 * - every numeric record carries lineage: source, dates, confidence grade,
 *   estimation method and bounds when estimated;
 * - country attribution is explicit via `basis` (owner / issuer / location).
 */

export type Basis = 'owner' | 'issuer' | 'location'

export type MeasureType = 'stock' | 'flow' | 'valuation' | 'turnover'

export type CurrencyView = 'usd_current' | 'usd_constant_fx'

/** v1 asset classes (coarse; refined universes come later). */
export type AssetClass =
  | 'deposits'
  | 'loans'
  | 'debt_securities'
  | 'listed_equity'
  | 'unlisted_equity_fdi'
  | 'funds'
  | 'reserves_gold'
  | 'residential_property'
  | 'commodities'
  | 'crypto'

/** A = official direct observation … E = low-confidence residual estimate. */
export type ConfidenceGrade = 'A' | 'B' | 'C' | 'D' | 'E'

/** Quarter key, e.g. "2024-Q3". Range starts at 2010-Q1. */
export type PeriodKey = `${number}-Q${1 | 2 | 3 | 4}`

/** Lineage attached to every numeric record (draft §6). */
export interface Lineage {
  source_id: string
  /** reference date of the underlying figure (ISO date) */
  effective_date: string
  confidence_grade: ConfidenceGrade
  /** present iff the value is estimated rather than observed */
  estimate_method?: string
  lower_bound?: number
  upper_bound?: number
}

/** public/data/countries.json */
export interface CountryMaster {
  iso3: string
  iso2: string
  name: string
  region: string
  /** [lon, lat] representative point for map markers / flow arcs */
  centroid: [number, number]
}

/** public/data/stocks_{basis}.json — one file per Basis. */
export interface StockRecord extends Lineage {
  country: string // ISO3, attributed per the file's basis
  asset: AssetClass
  period: PeriodKey
  measure: 'stock'
  value_usd: number // current USD
  value_usd_constant_fx?: number // base-period exchange rates
}

/** public/data/flows_bilateral.json — country-pair positions/flows (CPIS-derived). */
export interface BilateralRecord extends Lineage {
  owner_country: string // ISO3 (asset holder)
  issuer_country: string // ISO3 (asset issuer / destination)
  asset: AssetClass
  period: PeriodKey
  /** CPIS gives positions (stock); derived net transactions are 'flow' */
  measure: 'stock' | 'flow'
  value_usd: number
}

/**
 * 수집 분류 — 실시간 시장 데이터와 공식 통계를 데이터 계층에서 구분한다.
 * live_market: 실시간·일중 시장 데이터 (발표 지연 없음, 폴링/스트림 대상)
 * batch_official: 공식 통계 배치 (분기/연간 + 발표 지연이 본질 — 실시간 없음)
 * derived_model: 파이프라인 내부 파생·모델 (수집이 아니라 계산, grade C–E)
 * static_reference: 정적 참조 (지오메트리·국가 마스터 — vendored 패키지)
 */
export type CollectionMode =
  | 'live_market'
  | 'batch_official'
  | 'derived_model'
  | 'static_reference'

/** public/data/meta/sources.json */
export interface SourceRegistryEntry {
  source_id: string
  name: string
  publisher: string
  url: string
  license_note: string
  collection_mode: CollectionMode
  update_frequency:
    | 'intraday'
    | 'daily'
    | 'monthly'
    | 'quarterly'
    | 'annual'
    | 'static'
  /** 공식 발표 지연의 정직한 기대치 (그대로 표시 가능한 문구) */
  expected_release_lag: string
  retrieved_at: string // ISO datetime the snapshot was fetched
}

/**
 * public/data/flows_country/{period}.json — observed BOP transactions
 * (grade A) plus derived valuation changes (ΔIIP − transactions, grade C).
 * `entry`: 'assets' = resident net acquisition of foreign assets (outflow-
 * side), 'liabilities' = nonresident net investment into the country
 * (inflow-side). BPM6 sign conventions preserved.
 */
export interface FlowRecord extends Lineage {
  country: string // ISO3
  asset: AssetClass
  period: PeriodKey
  measure: 'flow' | 'valuation'
  entry: 'assets' | 'liabilities'
  value_usd: number
}

/**
 * Files are sharded per period (contract sharding clause, activated in
 * Phase B): stocks_{basis}/{period}.json etc. public/data/index.json lists
 * available periods per family and the latest quarter.
 */
export interface PeriodIndexFile {
  generated_at: string
  latest_quarter: PeriodKey
  periods: {
    stocks_owner: PeriodKey[]
    stocks_issuer: PeriodKey[]
    stocks_location: PeriodKey[]
    flows_country: PeriodKey[]
    flows_bilateral: PeriodKey[]
  }
}

/** public/data/meta/flow_intensity.json — barograph series (global gross). */
export interface FlowIntensityPoint {
  period: PeriodKey
  gross_flow_usd: number
  n_countries: number
  source_id: string
  confidence_grade: ConfidenceGrade
}

export interface FlowIntensityFile {
  generated_at: string
  series: FlowIntensityPoint[]
}

export interface StocksFile {
  basis: Basis
  generated_at: string
  records: StockRecord[]
}

export interface FlowsCountryFile {
  generated_at: string
  records: FlowRecord[]
}

export interface BilateralFile {
  generated_at: string
  records: BilateralRecord[]
}

// ------------------------------------------------------------- synoptic ----

/**
 * public/data/meta/synoptic.json — SYNOPTIC 대시보드 전용 사전 집계
 * (scripts/build/synoptic.ts, `pnpm data:synoptic`). 대시보드는 이 파일
 * 하나만 로드한다. 모든 셀은 관측(A/B)-한정 변형을 함께 갖는다.
 */
export interface SynopticCell {
  stock: number
  stock_obs: number
  flow_in: number
  flow_in_obs: number
  flow_out: number
  flow_out_obs: number
  flow_gross: number
  flow_gross_obs: number
  valuation: number
  records: number
  /** value-weighted A/B share of stock, 0..1 */
  obs_share: number
}

export interface SynopticCorridor {
  owner: string
  issuer: string
  asset: AssetClass
  value: number
  grade: ConfidenceGrade
  source_id: string
  effective_date: string
  method?: string
  lower?: number
  upper?: number
}

export interface SynopticAnomaly {
  country: string
  asset: AssetClass
  entry: 'assets' | 'liabilities'
  value: number
  grade: ConfidenceGrade
  source_id: string
  effective_date: string
  method?: string
  lower?: number
  upper?: number
}

export interface SynopticFile {
  generated_at: string
  periods: PeriodKey[]
  assets: AssetClass[]
  per_quarter: Record<PeriodKey, Partial<Record<AssetClass, SynopticCell>>>
  corridors: Record<
    PeriodKey,
    { stock: SynopticCorridor[]; flow: SynopticCorridor[] }
  >
  anomalies: Record<PeriodKey, SynopticAnomaly[]>
  grade_mix: Record<PeriodKey, Partial<Record<ConfidenceGrade, number>>>
}
