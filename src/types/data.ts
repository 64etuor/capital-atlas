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

/** public/data/meta/sources.json */
export interface SourceRegistryEntry {
  source_id: string
  name: string
  publisher: string
  url: string
  license_note: string
  update_frequency: 'daily' | 'monthly' | 'quarterly' | 'annual'
  retrieved_at: string // ISO datetime the snapshot was fetched
}

export interface StocksFile {
  basis: Basis
  generated_at: string
  records: StockRecord[]
}

export interface BilateralFile {
  generated_at: string
  records: BilateralRecord[]
}
