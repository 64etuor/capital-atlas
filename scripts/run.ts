/**
 * Pipeline orchestrator: fetch (cached, bounded-retry) → assemble → report.
 * Usage: pnpm data:fetch   (tsx scripts/run.ts)
 */
import { run as runCountries } from './fetch/countries.ts'
import { run as runWorldBank } from './fetch/worldbank.ts'
import { runIip, runBop, runPip } from './fetch/imf.ts'
import { run as runCrypto } from './fetch/crypto.ts'
import { assemble } from './build/assemble.ts'
import { failures, writeJson } from './fetch/lib.ts'

const t0 = Date.now()
const countries = runCountries()
const iso3s = countries.map((c) => c.iso3)

const wb = await runWorldBank(new Set(iso3s))
const iip = await runIip(iso3s)
const bop = await runBop(iso3s)
const pip = await runPip(iso3s)
const cryptoOk = await runCrypto()

assemble({ countries, wb, iip, bop, pip })

// source registry — every source used (or attempted) this run
writeJson('meta/sources.json', [
  {
    source_id: 'imf_iip',
    name: 'International Investment Position (IIP)',
    publisher: 'IMF',
    url: 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,IIP',
    license_note:
      'IMF terms (imf.org/external/terms.htm) — attribution; suggested citation embedded in responses',
    update_frequency: 'quarterly',
    retrieved_at: new Date().toISOString(),
  },
  {
    source_id: 'imf_bop',
    name: 'Balance of Payments (BOP) — financial account transactions',
    publisher: 'IMF',
    url: 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,BOP',
    license_note: 'IMF terms — attribution',
    update_frequency: 'quarterly',
    retrieved_at: new Date().toISOString(),
  },
  {
    source_id: 'imf_pip',
    name: 'Portfolio Investment Positions (CPIS successor)',
    publisher: 'IMF',
    url: 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,PIP',
    license_note: 'IMF terms — attribution',
    update_frequency: 'annual',
    retrieved_at: new Date().toISOString(),
  },
  {
    source_id: 'wb_wdi',
    name: 'World Development Indicators (market cap, GDP)',
    publisher: 'World Bank',
    url: 'https://api.worldbank.org/v2',
    license_note: 'CC BY-4.0',
    update_frequency: 'annual',
    retrieved_at: new Date().toISOString(),
  },
  {
    source_id: 'model_regional_median',
    name: 'Regional-median GDP-share model (internal fallback)',
    publisher: 'capital-atlas pipeline',
    url: 'docs/DATA_PIPELINE.md',
    license_note: 'internal estimate — grade E, ±35% bounds',
    update_frequency: 'quarterly',
    retrieved_at: new Date().toISOString(),
  },
  {
    source_id: 'model_gdp_ratio',
    name: 'Housing-wealth GDP-ratio heuristic (internal fallback)',
    publisher: 'capital-atlas pipeline',
    url: 'docs/DATA_PIPELINE.md',
    license_note: 'internal estimate — grade E, ±35% bounds',
    update_frequency: 'annual',
    retrieved_at: new Date().toISOString(),
  },
  ...(cryptoOk
    ? [
        {
          source_id: 'coingecko_global',
          name: 'CoinGecko global crypto market cap',
          publisher: 'CoinGecko',
          url: 'https://api.coingecko.com/api/v3/global',
          license_note: 'free API — attribution required for public display',
          update_frequency: 'daily' as const,
          retrieved_at: new Date().toISOString(),
        },
      ]
    : []),
])

console.log(
  `[run] done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ` +
    `${failures.length} terminal fetch failures (see meta/pipeline_report.json)`,
)
if (failures.length > 0) process.exitCode = 0 // failures are recorded, not fatal
