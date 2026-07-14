/**
 * Source registry SSOT — every dataset that reaches public/data/ is declared
 * here with an honest collection classification:
 *
 *   live_market      실시간·일중 시장 데이터 (폴링/스트림 대상, 발표 지연 없음)
 *   batch_official   공식 통계 배치 (분기/연간 + 발표 지연이 본질 — 실시간 없음)
 *   derived_model    파이프라인 내부 파생·모델 (수집이 아니라 계산; grade C–E)
 *   static_reference 정적 참조 (지오메트리·국가 마스터 — vendored 패키지)
 *
 * Rule (tested): live_market/static_reference sources must never back a
 * stocks/flows record — 시장 데이터가 공식 통계로 위장하지 않는다.
 */

export type CollectionMode =
  | 'live_market'
  | 'batch_official'
  | 'derived_model'
  | 'static_reference'

export type Cadence =
  | 'intraday'
  | 'daily'
  | 'monthly'
  | 'quarterly'
  | 'annual'
  | 'static'

/** Cadences each mode may declare — mode↔cadence 정합은 테스트가 강제한다. */
export const MODE_CADENCES: Record<CollectionMode, readonly Cadence[]> = {
  live_market: ['intraday', 'daily'],
  batch_official: ['monthly', 'quarterly', 'annual'],
  derived_model: ['quarterly', 'annual'],
  static_reference: ['static'],
}

export interface SourceDef {
  source_id: string
  name: string
  publisher: string
  url: string
  license_note: string
  collection_mode: CollectionMode
  update_frequency: Cadence
  /** 공식 발표 지연의 정직한 기대치 (사용자에게 그대로 노출 가능한 표현) */
  expected_release_lag: string
}

export const SOURCE_REGISTRY: readonly SourceDef[] = [
  {
    source_id: 'imf_iip',
    name: 'International Investment Position (IIP)',
    publisher: 'IMF',
    url: 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,IIP',
    license_note:
      'IMF terms (imf.org/external/terms.htm) — attribution; suggested citation embedded in responses',
    collection_mode: 'batch_official',
    update_frequency: 'quarterly',
    expected_release_lag: '~1 quarter after period end',
  },
  {
    source_id: 'imf_bop',
    name: 'Balance of Payments (BOP) — financial account transactions',
    publisher: 'IMF',
    url: 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,BOP',
    license_note: 'IMF terms — attribution',
    collection_mode: 'batch_official',
    update_frequency: 'quarterly',
    expected_release_lag: '~1 quarter after period end',
  },
  {
    source_id: 'imf_pip',
    name: 'Portfolio Investment Positions (PIP, CPIS successor) — bilateral',
    publisher: 'IMF',
    url: 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,PIP',
    license_note: 'IMF terms — attribution',
    collection_mode: 'batch_official',
    update_frequency: 'annual',
    expected_release_lag: '~2–3 quarters after year end',
  },
  {
    source_id: 'imf_iipcc',
    name: 'Currency Composition of the International Investment Position (IIPCC)',
    publisher: 'IMF',
    url: 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,IIPCC',
    license_note: 'IMF terms — attribution',
    collection_mode: 'batch_official',
    update_frequency: 'quarterly',
    expected_release_lag: '~1–3 quarters after period end; reporting coverage varies',
  },
  {
    source_id: 'imf_ifs_fx',
    name: 'Exchange Rates (ER, IFS successor) — end-of-period LCU per USD',
    publisher: 'IMF',
    url: 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,ER',
    license_note: 'IMF terms — attribution',
    collection_mode: 'batch_official',
    update_frequency: 'quarterly',
    expected_release_lag: '~1 month after quarter end',
  },
  {
    source_id: 'bis_lbs',
    name: 'Locational Banking Statistics (LBS) — cross-border loans & deposits, bilateral',
    publisher: 'BIS',
    url: 'https://stats.bis.org/api/v2/data/dataflow/BIS/WS_LBS_D_PUB/1.0',
    license_note:
      'BIS terms — reproduction permitted with attribution (bis.org/terms_conditions.htm)',
    collection_mode: 'batch_official',
    update_frequency: 'quarterly',
    expected_release_lag: '~1–2 quarters after period end',
  },
  {
    source_id: 'wb_wdi',
    name: 'World Development Indicators (market cap, GDP)',
    publisher: 'World Bank',
    url: 'https://api.worldbank.org/v2',
    license_note: 'CC BY-4.0',
    collection_mode: 'batch_official',
    update_frequency: 'annual',
    expected_release_lag: '~2–4 quarters after year end',
  },
  {
    source_id: 'model_regional_median',
    name: 'Regional-median GDP-share model (internal fallback)',
    publisher: 'capital-atlas pipeline',
    url: 'docs/DATA_PIPELINE.md',
    license_note: 'internal estimate — grade E, ±35% bounds',
    collection_mode: 'derived_model',
    update_frequency: 'quarterly',
    expected_release_lag: 'derived at assembly time',
  },
  {
    source_id: 'model_gdp_ratio',
    name: 'Housing-wealth GDP-ratio heuristic (internal fallback)',
    publisher: 'capital-atlas pipeline',
    url: 'docs/DATA_PIPELINE.md',
    license_note: 'internal estimate — grade D/E, ±20–35% bounds',
    collection_mode: 'derived_model',
    update_frequency: 'annual',
    expected_release_lag: 'derived at assembly time',
  },
  {
    source_id: 'model_flow_reallocation',
    name: 'Asset-to-asset flow reallocation — max-entropy/IPF model (§8)',
    publisher: 'capital-atlas pipeline',
    url: 'docs/DATA_PIPELINE.md',
    license_note:
      'internal model allocation — grade E, Frechet bounds; margins are observed BOP (grade A)',
    collection_mode: 'derived_model',
    update_frequency: 'quarterly',
    expected_release_lag: 'derived at assembly time',
  },
  {
    source_id: 'model_constant_fx',
    name: 'Currency-bucket constant-FX model',
    publisher: 'capital-atlas pipeline',
    url: 'docs/DATA_CONTRACT.md',
    license_note: 'internal derived view — grade C/D with explicit residual bounds',
    collection_mode: 'derived_model',
    update_frequency: 'quarterly',
    expected_release_lag: 'derived at assembly time',
  },
  {
    source_id: 'coingecko_global',
    name: 'CoinGecko global crypto market cap',
    publisher: 'CoinGecko',
    url: 'https://api.coingecko.com/api/v3/global',
    license_note: 'free API — attribution required for public display',
    collection_mode: 'live_market',
    update_frequency: 'daily',
    expected_release_lag: 'near-real-time (minutes)',
  },
  {
    source_id: 'natural_earth',
    name: 'Natural Earth 110m country polygons (via world-atlas npm)',
    publisher: 'Natural Earth / topojson world-atlas',
    url: 'https://www.npmjs.com/package/world-atlas',
    license_note: 'public domain (Natural Earth)',
    collection_mode: 'static_reference',
    update_frequency: 'static',
    expected_release_lag: 'vendored package — updated on dependency bump',
  },
  {
    source_id: 'world_countries',
    name: 'Country master — ISO codes, names, centroids (world-countries npm)',
    publisher: 'mledoze/world-countries',
    url: 'https://www.npmjs.com/package/world-countries',
    license_note: 'ODbL-1.0',
    collection_mode: 'static_reference',
    update_frequency: 'static',
    expected_release_lag: 'vendored package — updated on dependency bump',
  },
]

export const sourceById: ReadonlyMap<string, SourceDef> = new Map(
  SOURCE_REGISTRY.map((s) => [s.source_id, s]),
)
