/**
 * Country master from the `world-countries` package (Natural Earth-derived,
 * no network). Emits public/data/countries.json per the data contract.
 */
import { createRequire } from 'node:module'
import { writeJson, writeRawJson } from './lib.ts'

interface WorldCountry {
  cca2: string
  cca3: string
  name: { common: string }
  region: string
  subregion?: string
  latlng?: number[]
  independent?: boolean
  unMember: boolean
}

// CJS/JSON package — createRequire avoids nodenext default-import interop issues
const countries = createRequire(import.meta.url)('world-countries') as WorldCountry[]

// Non-UN-member economies that are first-class reporters in IMF/WB data.
const EXTRA = new Set(['TWN', 'HKG', 'MAC', 'XKX', 'PSE'])

export interface CountryRow {
  iso3: string
  iso2: string
  name: string
  region: string
  centroid: [number, number]
}

export function buildCountries(): CountryRow[] {
  const rows: CountryRow[] = []
  for (const c of countries) {
    if (!(c.unMember || c.independent || EXTRA.has(c.cca3))) continue
    if (!c.latlng || c.latlng.length !== 2) continue
    rows.push({
      iso3: c.cca3,
      iso2: c.cca2,
      name: c.name.common,
      region: c.subregion || c.region || 'Unclassified',
      centroid: [c.latlng[1], c.latlng[0]], // [lon, lat]
    })
  }
  rows.sort((a, b) => a.iso3.localeCompare(b.iso3))
  return rows
}

export function run(rows: CountryRow[] = buildCountries()): CountryRow[] {
  const bytes = writeJson('countries.json', rows)
  writeRawJson('countries_master.json', rows)
  console.log(`[countries] ${rows.length} economies → countries.json (${(bytes / 1024).toFixed(1)}KB)`)
  return rows
}
