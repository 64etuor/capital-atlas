/**
 * Static-dataset client: shard fetch + in-memory cache (deliberately just a
 * Map of promises — DATA_CONTRACT.md sharding assumes lazy loads like this).
 */
import type {
  Basis,
  BilateralFile,
  CountryMaster,
  FlowIntensityFile,
  FlowsCountryFile,
  PeriodIndexFile,
  PeriodKey,
  SourceRegistryEntry,
  StocksFile,
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

const inflight = new Map<string, Promise<unknown>>()

function fetchJson<T>(path: string): Promise<T> {
  let p = inflight.get(path)
  if (!p) {
    p = fetch(path).then((res) => {
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
      return res.json() as Promise<T>
    })
    p.catch(() => inflight.delete(path)) // allow retry after a failed load
    inflight.set(path, p)
  }
  return p as Promise<T>
}

export const getIndex = () => fetchJson<PeriodIndexFile>('/data/index.json')

export const getGeometry = () =>
  fetchJson<CountriesGeo>('/data/countries_geo.json')

export const getFlowIntensity = () =>
  fetchJson<FlowIntensityFile>('/data/meta/flow_intensity.json')

let countriesP: Promise<Map<string, CountryMaster>> | null = null
export function getCountries(): Promise<Map<string, CountryMaster>> {
  countriesP ??= fetchJson<CountryMaster[]>('/data/countries.json').then(
    (arr) => new Map(arr.map((c) => [c.iso3, c])),
  )
  return countriesP
}

let sourcesP: Promise<Map<string, SourceRegistryEntry>> | null = null
export function getSources(): Promise<Map<string, SourceRegistryEntry>> {
  sourcesP ??= fetchJson<SourceRegistryEntry[]>('/data/meta/sources.json').then(
    (arr) => new Map(arr.map((s) => [s.source_id, s])),
  )
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
