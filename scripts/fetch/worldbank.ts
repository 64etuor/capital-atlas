/**
 * World Bank API v2 — annual country series, no auth.
 *   CM.MKT.LCAP.CD  market capitalization of listed domestic companies (US$)
 *   NY.GDP.MKTP.CD  GDP (current US$)
 *
 * Values are absolute USD. Aggregates (region rows) are filtered out by
 * matching against the country master; the WLD aggregate is kept separately
 * as a top-down control total for sanity checks.
 */
import { fetchCached, writeRawJson } from './lib.ts'

export interface WbObs {
  iso3: string
  year: number
  value: number
}

interface WbApiRow {
  countryiso3code: string
  date: string
  value: number | null
}

async function fetchIndicator(indicator: string): Promise<{ rows: WbObs[]; world: WbObs[] } | null> {
  const rows: WbObs[] = []
  const world: WbObs[] = []
  for (let page = 1; page <= 10; page++) {
    const url =
      `https://api.worldbank.org/v2/country/all/indicator/${indicator}` +
      `?format=json&date=2010:2026&per_page=20000&page=${page}`
    const body = await fetchCached(`wb/${indicator}_p${page}.json`, url)
    if (body === null) return rows.length ? { rows, world } : null
    const parsed = JSON.parse(body) as [{ pages: number }, WbApiRow[] | null]
    for (const r of parsed[1] ?? []) {
      if (r.value === null || !r.countryiso3code) continue
      const obs = { iso3: r.countryiso3code, year: Number(r.date), value: r.value }
      if (r.countryiso3code === 'WLD') world.push(obs)
      else rows.push(obs)
    }
    if (page >= parsed[0].pages) break
  }
  return { rows, world }
}

export interface WbData {
  marketCap: WbObs[]
  marketCapWorld: WbObs[]
  gdp: WbObs[]
}

export async function run(validIso3: Set<string>): Promise<WbData> {
  const mkt = await fetchIndicator('CM.MKT.LCAP.CD')
  const gdp = await fetchIndicator('NY.GDP.MKTP.CD')
  const data: WbData = {
    marketCap: (mkt?.rows ?? []).filter((r) => validIso3.has(r.iso3)),
    marketCapWorld: mkt?.world ?? [],
    gdp: (gdp?.rows ?? []).filter((r) => validIso3.has(r.iso3)),
  }
  writeRawJson('wb/normalized.json', data)
  console.log(
    `[worldbank] marketCap ${data.marketCap.length} obs / gdp ${data.gdp.length} obs` +
      ` / world control ${data.marketCapWorld.length}`,
  )
  return data
}
