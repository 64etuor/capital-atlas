/**
 * Pipeline orchestrator: fetch (cached, bounded-retry) → assemble → report.
 * Usage: pnpm data:fetch   (tsx scripts/run.ts)
 */
import { buildCountries, run as runCountries } from './fetch/countries.ts'
import { run as runWorldBank } from './fetch/worldbank.ts'
import { runIip, runBop, runPip } from './fetch/imf.ts'
import { runDip } from './fetch/imf-dip.ts'
import { runIipcc, runPipExposure } from './fetch/imf-exposure.ts'
import { COINGECKO_GLOBAL_URL, run as runCrypto } from './fetch/crypto.ts'
import { runFx } from './fetch/fx.ts'
import { runBis } from './fetch/bis.ts'
import { assemble } from './build/assemble.ts'
import { applyBankMerge } from './build/bank_merge.ts'
import { writeSourcesJson } from './build/sources.ts'
import { buildExposure } from './build/exposure.ts'
import { buildPositionClosure } from './build/position-closure.ts'
import { failures } from './fetch/lib.ts'

const t0 = Date.now()
// Pure local metadata load: publication is deferred until every required
// network stage has passed its failure and minimum-row guards.
const countries = buildCountries()
const iso3s = countries.map((c) => c.iso3)

const wb = await runWorldBank(new Set(iso3s))
const iip = await runIip(iso3s)
const bop = await runBop(iso3s)
const pip = await runPip(iso3s)
const dip = await runDip(iso3s)
await Promise.all([runIipcc(iso3s), runPipExposure(iso3s)])

// Finish every required network read before touching public/data. A later
// source failure must never leave the committed snapshot partially rebuilt.
const iso3ByIso2 = new Map(countries.map((c) => [c.iso2, c.iso3]))
const bis = await runBis(iso3ByIso2)
await runFx(iso3s) // Phase L: CURR=LCU 다이얼 근거 (required; terminal failure aborts)
runCountries(countries)

// Explicitly optional, and only attempted after every required feed is valid.
const cryptoOk = await runCrypto()

assemble({ countries, wb, iip, bop, pip, dip })
buildExposure()
buildPositionClosure()

// Phase M: BIS 은행 회랑 — assemble이 쓴 bilateral 샤드에 병합(멱등)
applyBankMerge(bis.records, {
  reporters: bis.reporters,
  droppedReporters: bis.droppedReporters,
})

// Preserve the prior CoinGecko retrieval time when its optional refresh failed.
writeSourcesJson({
  stampAll: new Date().toISOString(),
  preserveSourceIds: cryptoOk ? [] : ['coingecko_global'],
})
if (!cryptoOk) {
  console.error(
    '[run] coingecko fetch failed — meta/global_crypto.json is stale or absent (recorded, not fatal)',
  )
}

console.log(
  `[run] done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ` +
    `${failures.length} optional terminal fetch failures (see meta/pipeline_report.json)`,
)
const unexpectedFailures = failures.filter(
  (failure) => failure.url !== COINGECKO_GLOBAL_URL,
)
if (unexpectedFailures.length > 0)
  throw new Error(
    `[run] ${unexpectedFailures.length} required fetch failures escaped stage guards`,
  )
