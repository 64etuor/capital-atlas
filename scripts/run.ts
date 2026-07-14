/**
 * Pipeline orchestrator: fetch (cached, bounded-retry) → assemble → report.
 * Usage: pnpm data:fetch   (tsx scripts/run.ts)
 */
import { run as runCountries } from './fetch/countries.ts'
import { run as runWorldBank } from './fetch/worldbank.ts'
import { runIip, runBop, runPip } from './fetch/imf.ts'
import { runIipcc, runPipExposure } from './fetch/imf-exposure.ts'
import { run as runCrypto } from './fetch/crypto.ts'
import { runFx } from './fetch/fx.ts'
import { runBis } from './fetch/bis.ts'
import { assemble } from './build/assemble.ts'
import { applyBankMerge } from './build/bank_merge.ts'
import { writeSourcesJson } from './build/sources.ts'
import { failures } from './fetch/lib.ts'

const t0 = Date.now()
const countries = runCountries()
const iso3s = countries.map((c) => c.iso3)

const wb = await runWorldBank(new Set(iso3s))
const iip = await runIip(iso3s)
const bop = await runBop(iso3s)
const pip = await runPip(iso3s)
await Promise.all([runIipcc(iso3s), runPipExposure(iso3s)])
const cryptoOk = await runCrypto()
await runFx(iso3s) // Phase L: CURR=LCU 다이얼 근거 (실패는 failures에 기록)

assemble({ countries, wb, iip, bop, pip })

// Phase M: BIS 은행 회랑 — assemble이 쓴 bilateral 샤드에 병합(멱등)
{
  const iso3ByIso2 = new Map(countries.map((c) => [c.iso2, c.iso3]))
  const bis = await runBis(iso3ByIso2)
  if (bis.records.length > 0) {
    applyBankMerge(bis.records, {
      reporters: bis.reporters,
      droppedReporters: bis.droppedReporters,
    })
  }
}

// source registry — SSOT는 scripts/fetch/registry.ts, 이 run이 전부 재수집했으므로 전 소스 now 스탬프
writeSourcesJson({ stampAll: new Date().toISOString() })
if (!cryptoOk) {
  console.error(
    '[run] coingecko fetch failed — meta/global_crypto.json is stale or absent (recorded, not fatal)',
  )
}

console.log(
  `[run] done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ` +
    `${failures.length} terminal fetch failures (see meta/pipeline_report.json)`,
)
if (failures.length > 0) process.exitCode = 0 // failures are recorded, not fatal
