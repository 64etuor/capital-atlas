/**
 * Static-dataset client: shard fetch + in-memory cache (deliberately just a
 * Map of promises — DATA_CONTRACT.md sharding assumes lazy loads like this).
 */
import type {
  Basis,
  BilateralFile,
  CountryMaster,
  FlowIntensityFile,
  FlowMatrixFile,
  FlowMatrixIndexFile,
  FlowsCountryFile,
  FxRatesFile,
  PeriodIndexFile,
  PeriodKey,
  ReconciliationShard,
  SourceRegistryEntry,
  StationFile,
  StationIndexFile,
  StocksFile,
  SynopticFile,
  VintageDigestFile,
  VintagesIndexFile,
} from '../types/data'
import { indexFromPeriod } from './periods'

export interface CountryFeatureProps {
  iso3: string | null
  name: string
  /** representative longitude, annotated client-side for the sweep reveal */
  lon?: number
}

export interface CountriesGeo {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: unknown
    properties: CountryFeatureProps
  }>
}

/**
 * Bounded LRU for period shards — timeline scrubbing across 65 quarters must
 * not grow memory forever. Meta files (index/countries/geometry/sources/
 * flow_intensity) are pinned: tiny, needed everywhere, never evicted.
 */
export const MAX_SHARD_CACHE = 16

const isShardPath = (path: string) =>
  /^\/data\/(stocks_|flows_)/.test(path) ||
  (/^\/data\/(station|flowmatrix|reconciliation)\//.test(path) &&
    !path.endsWith('/index.json'))

const inflight = new Map<string, Promise<unknown>>()

function fetchJson<T>(path: string): Promise<T> {
  const cached = inflight.get(path)
  if (cached) {
    if (isShardPath(path)) {
      // LRU refresh: re-insert as most recent (Map preserves insertion order)
      inflight.delete(path)
      inflight.set(path, cached)
    }
    return cached as Promise<T>
  }
  const p = fetch(path).then((res) => {
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
    return res.json() as Promise<T>
  })
  // allow retry after a failed load — identity-guarded so a late rejection
  // of an evicted promise cannot delete a newer entry under the same path
  p.catch(() => {
    if (inflight.get(path) === p) inflight.delete(path)
  })
  inflight.set(path, p)
  if (isShardPath(path)) {
    let excess = -MAX_SHARD_CACHE
    for (const k of inflight.keys()) if (isShardPath(k)) excess++
    for (const k of inflight.keys()) {
      if (excess <= 0) break
      if (k !== path && isShardPath(k)) {
        inflight.delete(k)
        excess--
      }
    }
  }
  return p
}

export const getIndex = () => fetchJson<PeriodIndexFile>('/data/index.json')

export const getGeometry = () =>
  fetchJson<CountriesGeo>('/data/countries_geo.json')

export const getFlowIntensity = () =>
  fetchJson<FlowIntensityFile>('/data/meta/flow_intensity.json')

/** SYNOPTIC 사전 집계 — meta 경로라 핀 고정(LRU 비대상), 단일 lazy-load */
export const getSynoptic = () =>
  fetchJson<SynopticFile>('/data/meta/synoptic.json')

/**
 * 빈티지 다이제스트 (Phase N §15.5) — 도시에 REVISIONS 행 전용.
 * 파일당 ~150KB·수 개 수준이라 핀 고정 허용, 열릴 때만 lazy-load.
 */
export const getVintagesIndex = () =>
  fetchJson<VintagesIndexFile>('/data/vintages/index.json')

export const getVintage = (date: string) =>
  fetchJson<VintageDigestFile>(`/data/vintages/${date}.json`)

/** 분기 환율 (Phase L, CURR=LCU 근거) — meta 핀 고정, 단일 lazy-load */
export const getFxRates = () => fetchJson<FxRatesFile>('/data/meta/fx_rates.json')

/** STATION 인덱스(가용 국가 목록) — 핀 고정 */
export const getStationIndex = () =>
  fetchJson<StationIndexFile>('/data/station/index.json')

/** STATION 국가 파일 — 샤드 취급(LRU 대상). 'WLD' = 세계 집계 */
export const getStation = (iso3: string) =>
  fetchJson<StationFile>(`/data/station/${iso3}.json`)

/** Phase O — 자산 간 재배분 행렬 인덱스(가용 분기) — 핀 고정 */
export const getFlowMatrixIndex = () =>
  fetchJson<FlowMatrixIndexFile>('/data/flowmatrix/index.json')

/** Phase P — §12-3 미러 폐합 샤드(LRU 대상). bis_lbs 양방향 관측 쌍 */
export const getReconciliation = (period: PeriodKey) =>
  fetchJson<ReconciliationShard>(`/data/reconciliation/${period}.json`)

/** Phase O — 분기 재배분 행렬 샤드(LRU 대상). 전 셀 grade E 모델 배분 */
export const getFlowMatrix = (period: PeriodKey) =>
  fetchJson<FlowMatrixFile>(`/data/flowmatrix/${period}.json`)

let countriesP: Promise<Map<string, CountryMaster>> | null = null
export function getCountries(): Promise<Map<string, CountryMaster>> {
  if (!countriesP) {
    const p = fetchJson<CountryMaster[]>('/data/countries.json').then(
      (arr) => new Map(arr.map((c) => [c.iso3, c])),
    )
    // a transient failure must not poison the singleton — clear for retry
    p.catch(() => {
      if (countriesP === p) countriesP = null
    })
    countriesP = p
  }
  return countriesP
}

let sourcesP: Promise<Map<string, SourceRegistryEntry>> | null = null
export function getSources(): Promise<Map<string, SourceRegistryEntry>> {
  if (!sourcesP) {
    const p = fetchJson<SourceRegistryEntry[]>(
      '/data/meta/sources.json',
    ).then((arr) => new Map(arr.map((s) => [s.source_id, s])))
    p.catch(() => {
      if (sourcesP === p) sourcesP = null
    })
    sourcesP = p
  }
  return sourcesP
}

export const getStocks = (basis: Basis, period: PeriodKey) =>
  fetchJson<StocksFile>(`/data/stocks_${basis}/${period}.json`)

export const getFlowsCountry = (period: PeriodKey) =>
  fetchJson<FlowsCountryFile>(`/data/flows_country/${period}.json`)

export const getBilateral = (period: PeriodKey) =>
  fetchJson<BilateralFile>(`/data/flows_bilateral/${period}.json`)

/**
 * Greatest available period ≤ target (shards are sparse for some families:
 * bilateral = annual Q4, location = annual). Null if target predates data.
 */
export function nearestAvailable(
  available: readonly PeriodKey[],
  target: PeriodKey,
): PeriodKey | null {
  const t = indexFromPeriod(target)
  let best: PeriodKey | null = null
  for (const p of available) {
    if (indexFromPeriod(p) <= t) best = p
    else break
  }
  return best
}
