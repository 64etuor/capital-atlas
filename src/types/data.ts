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

/**
 * CURR 다이얼 (Phase L): 'usd' | 'lcu'(선택 국가의 현지통화 — 분기 환율 곱).
 * LCU는 국가 스코프에서만 유효; 글로벌 집계는 통화 합산이 무의미해 USD 고정.
 * 고정환율 USD(constant-FX)는 IIP 통화구성 데이터가 없어 가정 없이 계산
 * 불가(허위 정밀도 금지) — 통화구성 확보(v3) 전까지 도입하지 않는다.
 */
export type CurrencyView = 'usd' | 'lcu'

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
  /** 미산출 — IIP 통화구성 확보(v3) 전까지 constant-FX는 계산하지 않는다 */
  value_usd_constant_fx?: number
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

// ------------------------------------------------------------------- fx ----

/**
 * public/data/meta/fx_rates.json — 분기 환율(LCU per USD, 기말) (Phase L).
 * IMF ER(XDC_USD·EOP_RT) grade A quarterly / WB PA.NUS.FCRF 연간 Q4 폴백
 * grade B(method 공개). 어느 쪽도 없으면 국가 자체가 없다(정직 공백).
 */
export interface FxRateEntry {
  rate: number // LCU per USD
  grade: 'A' | 'B'
  source_id: string
  effective_date: string
  method?: string
}

export interface FxCountry {
  currency: string // ISO 4217
  /** true = IMF 분기 시계열 / false = WB 연간 Q4만 */
  quarterly: boolean
  rates: Partial<Record<PeriodKey, FxRateEntry>>
}

export interface FxRatesFile {
  generated_at: string
  base: 'USD'
  countries: Record<string, FxCountry>
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
  /** asset stock ÷ quarter total stock (§14 자산 비중) */
  share: number
  /** observed-only variant (VIS=OBS 근거) */
  share_obs: number
}

/** §14 회랑 집중도 — 분모는 샤드 전체 gross(top-20 리스트 아님) */
export interface SynopticCorridorConcentration {
  top10_share: number
  top20_share: number
  gross_usd: number
  top10_share_obs: number
  top20_share_obs: number
  gross_obs_usd: number
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

// -------------------------------------------------------------- station ----

/**
 * public/data/station/{ISO3}.json — 국가별 관측 분석 사전 집계
 * (scripts/build/station.ts, `pnpm data:station`). STATION 뷰는 국가당
 * 파일 하나만 lazy-load 한다(LRU 샤드 취급). WLD.json = 세계 집계.
 */
export interface StationPoint {
  period: PeriodKey
  stock: number
  grade: ConfidenceGrade
  /** D/E 추정 잔액의 신뢰구간 밴드 — 관측(A/B)에선 없음 */
  stock_lower?: number
  stock_upper?: number
  stock_issuer?: number
  issuer_grade?: ConfidenceGrade
  /** BOP 부호 보존: flow_in=비거주자 유입측, flow_out=거주자 유출측 */
  flow_in: number
  flow_out: number
  flow_grade?: ConfidenceGrade
  valuation: number
  source_id?: string
  method?: string
  /** WLD 집계 전용: 가치가중 관측(A/B) 비중 (grade는 이 비중의 매핑) */
  obs_share?: number
}

export interface StationPartner {
  country: string
  value: number
  grade: ConfidenceGrade
  source_id: string
  effective_date: string
  method?: string
  lower?: number
  upper?: number
}

export interface StationPartnerSides {
  holdings: StationPartner[]
  holders: StationPartner[]
}

export interface StationPartnersEntry {
  all: StationPartnerSides
  assets: Partial<Record<AssetClass, StationPartnerSides>>
}

export interface StationSummary {
  latest: PeriodKey | null
  first: PeriodKey | null
  stock_total: number
  flow_in: number
  flow_out: number
  valuation: number
  composition: Partial<Record<AssetClass, number>>
  obs_share: number
  n_points: number
}

/** §14 상대국 집중도 — 발행 bilateral 샤드 전체에서 계산 (top-15 리스트 아님) */
export interface StationCpConcentration {
  period: PeriodKey
  scope: 'all' | AssetClass
  hhi: number
  top5_share: number
  top5: Array<{ country: string; share: number }>
  gross_usd: number
  n_partners: number
  grade: ConfidenceGrade
  source_ids: string[]
  method: string
}

/** §14 분기별 세계 대비·자산 구성 비중 */
export interface StationQuarterlyConcentration {
  period: PeriodKey
  share_of_world: number
  share_of_world_assets: Partial<Record<AssetClass, number>>
  asset_shares: Partial<Record<AssetClass, number>>
  grade: ConfidenceGrade
  source_ids: string[]
  method: string
}

export interface StationConcentration {
  quarterly: StationQuarterlyConcentration[]
  counterparty: StationCpConcentration[]
}

export interface StationFile {
  iso3: string
  generated_at: string
  summary: StationSummary
  series: Partial<Record<AssetClass, StationPoint[]>>
  partners: Record<PeriodKey, StationPartnersEntry>
  concentration: StationConcentration
}

export interface StationIndexFile {
  generated_at: string
  countries: string[]
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
  corridor_concentration: Record<PeriodKey, SynopticCorridorConcentration>
  anomalies: Record<PeriodKey, SynopticAnomaly[]>
  grade_mix: Record<PeriodKey, Partial<Record<ConfidenceGrade, number>>>
}
