/**
 * Contract + plausibility gate for public/data (pnpm data:check).
 * Fails (exit 1) on schema violations or implausible world totals.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { OUT_DIR, readRawJson } from '../fetch/lib.ts'
import {
  currencyExposureRecordSchema,
  fxdResultSchema,
  positionClosureCellSchema,
  reconstructedLiabilitySchema,
  sectorPositionRecordSchema,
} from '../build/exposure-contract.ts'
import { rasClose } from '../build/position-closure.ts'

const grade = z.enum(['A', 'B', 'C', 'D', 'E'])
const period = z.string().regex(/^\d{4}-Q[1-4]$/)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const boundsWhenEstimated = (r: {
  confidence_grade: string
  estimate_method?: string
  lower_bound?: number
  upper_bound?: number
}) =>
  ['D', 'E'].includes(r.confidence_grade)
    ? !!r.estimate_method && r.lower_bound !== undefined && r.upper_bound !== undefined
    : true

const stockBase = z.object({
  country: z.string().length(3),
  asset: z.enum([
    'deposits', 'loans', 'debt_securities', 'listed_equity', 'unlisted_equity_fdi',
    'funds', 'reserves_gold', 'residential_property', 'commodities', 'crypto',
  ]),
  period,
  measure: z.literal('stock'),
  value_usd: z.number().finite(),
  source_id: z.string(),
  effective_date: isoDate,
  confidence_grade: grade,
  estimate_method: z.string().optional(),
  lower_bound: z.number().optional(),
  upper_bound: z.number().optional(),
})

const stockRecord = stockBase.refine(boundsWhenEstimated, {
  message: 'D/E records require estimate_method + bounds',
})

const flowRecord = stockBase
  .omit({ measure: true })
  .extend({
    measure: z.enum(['flow', 'valuation']),
    entry: z.enum(['assets', 'liabilities']),
  })
  .refine(boundsWhenEstimated, { message: 'D/E records require estimate_method + bounds' })

const bilateralRecord = z
  .object({
    owner_country: z.string().length(3),
    issuer_country: z.string().length(3),
    // Phase M: 은행 채널(BIS LBS) 합류 — loans/deposits는 bis_lbs 전용(refine)
    asset: z.enum(['listed_equity', 'debt_securities', 'loans', 'deposits']),
    period,
    measure: z.enum(['stock', 'flow']),
    value_usd: z.number().finite(),
    source_id: z.string(),
    effective_date: isoDate,
    confidence_grade: grade,
    estimate_method: z.string().optional(),
    lower_bound: z.number().optional(),
    upper_bound: z.number().optional(),
  })
  .refine(
    (r) =>
      ['loans', 'deposits'].includes(r.asset) ? r.source_id === 'bis_lbs' : true,
    { message: 'banking-channel assets must come from bis_lbs' },
  )

let errors = 0
const fail = (msg: string) => {
  errors++
  console.error(`  ✗ ${msg}`)
}
const ok = (msg: string) => console.log(`  ✓ ${msg}`)

function loadShards(dir: string): { period: string; records: unknown[] }[] {
  const full = join(OUT_DIR, dir)
  if (!existsSync(full)) {
    fail(`${dir}/ missing`)
    return []
  }
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const body = JSON.parse(readFileSync(join(full, f), 'utf8'))
      const size = statSync(join(full, f)).size
      if (size > 5 * 1024 * 1024) fail(`${dir}/${f} exceeds 5MB (${(size / 1e6).toFixed(1)}MB)`)
      return { period: f.replace('.json', ''), records: body.records as unknown[] }
    })
}

const gradeDist: Record<string, number> = {}
const bump = (g: string) => (gradeDist[g] = (gradeDist[g] ?? 0) + 1)

// ---- countries ------------------------------------------------------------
const countries = JSON.parse(readFileSync(join(OUT_DIR, 'countries.json'), 'utf8')) as {
  iso3: string
  centroid: [number, number]
}[]
if (countries.length < 150) fail(`countries.json only ${countries.length} rows`)
else ok(`countries.json ${countries.length} economies`)

// ---- stocks ---------------------------------------------------------------
const index = JSON.parse(readFileSync(join(OUT_DIR, 'index.json'), 'utf8'))
const latest: string = index.latest_quarter
let stockTotal = 0 // Phase P — facts 정합 게이트용 누계
for (const basis of ['owner', 'issuer', 'location'] as const) {
  const shards = loadShards(`stocks_${basis}`)
  let n = 0
  const countriesSeen = new Set<string>()
  for (const s of shards) {
    for (const r of s.records) {
      const p = stockRecord.safeParse(r)
      if (!p.success) {
        if (errors < 5) fail(`stocks_${basis}/${s.period}: ${p.error.issues[0].message}`)
        errors++
        continue
      }
      if (p.data.period !== s.period) fail(`stocks_${basis}/${s.period}: record period mismatch`)
      bump(p.data.confidence_grade)
      countriesSeen.add(p.data.country)
      n++
    }
  }
  ok(`stocks_${basis}: ${shards.length} shards, ${n} records, ${countriesSeen.size} countries`)
  if (basis === 'owner' && countriesSeen.size < 60) fail(`owner coverage ${countriesSeen.size} < 60 countries`)
  stockTotal += n
}

// world total plausibility: owner-basis external assets at latest quarter
const latestOwner = JSON.parse(
  readFileSync(join(OUT_DIR, `stocks_owner/${latest}.json`), 'utf8'),
) as { records: { asset: string; value_usd: number; country: string; confidence_grade: string }[] }
const totalExternal = latestOwner.records.reduce((s, r) => s + r.value_usd, 0)
if (totalExternal < 60e12 || totalExternal > 400e12)
  fail(`global external assets ${(totalExternal / 1e12).toFixed(0)}T outside plausible 60–400T`)
else ok(`global cross-border assets @${latest}: $${(totalExternal / 1e12).toFixed(1)}T (plausible)`)

// ---- flows ------------------------------------------------------------------
const flowShards = loadShards('flows_country')
let flowN = 0
for (const s of flowShards)
  for (const r of s.records) {
    const p = flowRecord.safeParse(r)
    if (!p.success) {
      if (errors < 10) fail(`flows_country/${s.period}: ${p.error.issues[0].message}`)
      errors++
      continue
    }
    bump(p.data.confidence_grade)
    flowN++
  }
ok(`flows_country: ${flowShards.length} shards, ${flowN} records`)

// ---- bilateral --------------------------------------------------------------
const biShards = loadShards('flows_bilateral')
let biN = 0
let korUsaEquityLatest: number | null = null
const pairTotals = new Map<string, number>()
for (const s of biShards)
  for (const r of s.records) {
    const p = bilateralRecord.safeParse(r)
    if (!p.success) {
      if (errors < 15) fail(`flows_bilateral/${s.period}: ${p.error.issues[0].message}`)
      errors++
      continue
    }
    bump(p.data.confidence_grade)
    biN++
    if (p.data.measure === 'stock') {
      const k = `${p.data.owner_country}→${p.data.issuer_country}`
      if (s.period === index.periods.flows_bilateral.at(-1))
        pairTotals.set(k, (pairTotals.get(k) ?? 0) + p.data.value_usd)
      if (k === 'KOR→USA' && p.data.asset === 'listed_equity') korUsaEquityLatest = p.data.value_usd
    }
  }
ok(`flows_bilateral: ${biShards.length} shards, ${biN} records`)
if (korUsaEquityLatest !== null) {
  if (korUsaEquityLatest < 5e10 || korUsaEquityLatest > 2e12)
    fail(`KOR→USA equity ${(korUsaEquityLatest / 1e9).toFixed(0)}B outside plausible 50B–2T`)
  else ok(`KOR→USA equity position: $${(korUsaEquityLatest / 1e9).toFixed(0)}B (plausible)`)
}
const topPairs = [...pairTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log('  top pairs (latest):', topPairs.map(([k, v]) => `${k} $${(v / 1e12).toFixed(2)}T`).join(' · '))

// ---- exposure (v3 — 직접 통화·부문 + 명시적 파생) ----------------------------
let currencyN = 0
let sectorN = 0
let reconstructedN = 0
let fxdN = 0
const currencyCountriesSeen = new Set<string>()
const sectorCountriesSeen = new Set<string>()
const exposureDir = join(OUT_DIR, 'exposure')
const exposureIndexPath = join(exposureDir, 'index.json')
if (!existsSync(exposureIndexPath)) {
  fail('exposure/index.json missing — run pnpm data:exposure')
} else {
  const exposureIndex = JSON.parse(readFileSync(exposureIndexPath, 'utf8')) as {
    countries?: unknown
    periods?: unknown
    base_period?: unknown
  }
  const exposureCountries = z.array(z.string().length(3)).safeParse(exposureIndex.countries)
  const exposurePeriods = z.array(period).safeParse(exposureIndex.periods)
  if (!exposureCountries.success) fail('exposure/index.json: invalid countries')
  else if (exposureCountries.data.length < 80)
    fail(`exposure coverage ${exposureCountries.data.length} < 80 countries`)
  if (!exposurePeriods.success) fail('exposure/index.json: invalid periods')
  else if (exposurePeriods.data.length < 12)
    fail(`exposure history ${exposurePeriods.data.length} < 12 quarters`)
  if (!period.safeParse(exposureIndex.base_period).success)
    fail('exposure/index.json: invalid base_period')

  for (const country of exposureCountries.success ? exposureCountries.data : []) {
    const path = join(exposureDir, `${country}.json`)
    if (!existsSync(path)) {
      fail(`exposure/${country}.json missing`)
      continue
    }
    const size = statSync(path).size
    if (size > 5 * 1024 * 1024)
      fail(`exposure/${country}.json exceeds 5MB (${(size / 1e6).toFixed(1)}MB)`)
    const body = JSON.parse(readFileSync(path, 'utf8')) as {
      country?: unknown
      currency?: unknown
      sectors?: unknown
      fxd?: unknown
      reconstructed_liabilities?: unknown
    }
    if (body.country !== country) fail(`exposure/${country}.json: country mismatch`)

    const currencyRows = z.array(currencyExposureRecordSchema).safeParse(body.currency)
    if (!currencyRows.success) {
      fail(`exposure/${country}.json currency: ${currencyRows.error.issues[0].message}`)
    } else {
      currencyN += currencyRows.data.length
      for (const row of currencyRows.data) {
        currencyCountriesSeen.add(row.country)
        bump(row.confidence_grade)
      }
    }
    const sectorRows = z.array(sectorPositionRecordSchema).safeParse(body.sectors)
    if (!sectorRows.success) {
      fail(`exposure/${country}.json sectors: ${sectorRows.error.issues[0].message}`)
    } else {
      sectorN += sectorRows.data.length
      for (const row of sectorRows.data) {
        sectorCountriesSeen.add(row.country)
        bump(row.confidence_grade)
      }
    }
    const reconstructedRows = z
      .array(reconstructedLiabilitySchema)
      .safeParse(body.reconstructed_liabilities)
    if (!reconstructedRows.success) {
      fail(
        `exposure/${country}.json reconstructed: ${reconstructedRows.error.issues[0].message}`,
      )
    } else {
      reconstructedN += reconstructedRows.data.length
      for (const row of reconstructedRows.data) bump(row.confidence_grade)
    }
    const fxdRows = z.array(fxdResultSchema).safeParse(body.fxd)
    if (!fxdRows.success) {
      fail(`exposure/${country}.json FXD: ${fxdRows.error.issues[0].message}`)
    } else {
      for (const row of fxdRows.data) {
        if (row.status !== 'available') continue
        fxdN++
        bump(row.confidence_grade)
      }
    }
  }
  if (currencyN < 50_000 || currencyCountriesSeen.size < 18)
    fail(
      `currency exposure coverage regressed: ${currencyN} rows / ${currencyCountriesSeen.size} countries`,
    )
  if (sectorN < 14_000 || sectorCountriesSeen.size < 75)
    fail(
      `sector exposure coverage regressed: ${sectorN} rows / ${sectorCountriesSeen.size} countries`,
    )
  if (reconstructedN < 2_000)
    fail(`reconstructed liability coverage regressed: ${reconstructedN} rows`)
  if (fxdN < 300) fail(`available FXD coverage regressed: ${fxdN} rows`)
  ok(
    `exposure: ${exposureCountries.success ? exposureCountries.data.length : 0} countries · ` +
      `${currencyN} currency A · ${sectorN} sector A · ${reconstructedN} reconstructed C · ${fxdN} FXD C/D`,
  )
}

// ---- position closure (v3 — bounded RAS, grade E only) ---------------------
let positionClosureN = 0
const closureDir = join(OUT_DIR, 'position_closure')
const closureIndexPath = join(closureDir, 'index.json')
const closureIip = readRawJson<
  Array<{
    iso3: string
    entry: 'A_P' | 'L_P'
    indicator: string
    quarter: string
    value: number
  }>
>('imf/iip_normalized.json')
const closureMargins = new Map<
  string,
  { rows: Record<string, number>; columns: Record<string, number> }
>()
for (const observation of closureIip ?? []) {
  const asset =
    observation.indicator === 'P_F5_MV'
      ? 'listed_equity'
      : observation.indicator === 'P_F3_MV'
        ? 'debt_securities'
        : null
  if (!asset) continue
  const key = `${observation.quarter}|${asset}`
  const source = closureMargins.get(key) ?? { rows: {}, columns: {} }
  const side = observation.entry === 'A_P' ? source.rows : source.columns
  side[observation.iso3] = observation.value
  closureMargins.set(key, source)
}
if (!existsSync(closureIndexPath)) {
  fail('position_closure/index.json missing — run pnpm data:closure')
} else {
  const closureIndex = JSON.parse(readFileSync(closureIndexPath, 'utf8')) as {
    periods?: unknown
  }
  const closurePeriods = z.array(period).safeParse(closureIndex.periods)
  if (!closurePeriods.success) fail('position_closure/index.json: invalid periods')
  else if (closurePeriods.data.length < 10)
    fail(`position closure history ${closurePeriods.data.length} < 10 periods`)
  for (const closurePeriod of closurePeriods.success ? closurePeriods.data : []) {
    const path = join(closureDir, `${closurePeriod}.json`)
    if (!existsSync(path)) {
      fail(`position_closure/${closurePeriod}.json missing`)
      continue
    }
    const size = statSync(path).size
    if (size > 5 * 1024 * 1024)
      fail(`position_closure/${closurePeriod}.json exceeds 5MB`)
    const body = JSON.parse(readFileSync(path, 'utf8')) as {
      period?: unknown
      method?: unknown
      assets?: Record<string, unknown>
    }
    if (body.period !== closurePeriod)
      fail(`position_closure/${closurePeriod}.json: period mismatch`)
    if (body.method !== 'biproportional_ras_position_closure')
      fail(`position_closure/${closurePeriod}.json: unexpected method ${body.method}`)
    for (const [asset, raw] of Object.entries(body.assets ?? {})) {
      const result = raw as {
        cells?: unknown
        iterations?: unknown
        residual?: unknown
        converged?: unknown
        direct_seed_share?: unknown
        row_margins?: unknown
        column_margins?: unknown
        total_cells?: unknown
        omitted_cells?: unknown
        omitted_value_usd?: unknown
      }
      const cells = z.array(positionClosureCellSchema).safeParse(result.cells)
      if (!cells.success) {
        fail(
          `position_closure/${closurePeriod}.json ${asset}: ${cells.error.issues[0].message}`,
        )
        continue
      }
      if (result.converged !== true)
        fail(`position_closure/${closurePeriod}.json ${asset}: not converged`)
      if (!Number.isInteger(result.iterations) || Number(result.iterations) > 100)
        fail(`position_closure/${closurePeriod}.json ${asset}: invalid iteration count`)
      if (!Number.isFinite(result.residual) || Number(result.residual) > 1e-9)
        fail(`position_closure/${closurePeriod}.json ${asset}: residual exceeds 1e-9`)
      if (
        !Number.isFinite(result.direct_seed_share) ||
        Number(result.direct_seed_share) <= 0 ||
        Number(result.direct_seed_share) > 1
      )
        fail(`position_closure/${closurePeriod}.json ${asset}: invalid direct seed coverage`)
      if (
        !Number.isInteger(result.total_cells) ||
        !Number.isInteger(result.omitted_cells) ||
        Number(result.total_cells) !== cells.data.length + Number(result.omitted_cells)
      )
        fail(`position_closure/${closurePeriod}.json ${asset}: cell counts do not close`)
      if (!Number.isFinite(result.omitted_value_usd) || Number(result.omitted_value_usd) < 0)
        fail(`position_closure/${closurePeriod}.json ${asset}: invalid omitted value`)
      const margins = z.record(z.string(), z.number().finite().positive())
      const rowMargins = margins.safeParse(result.row_margins)
      const columnMargins = margins.safeParse(result.column_margins)
      if (!rowMargins.success || !columnMargins.success) {
        fail(`position_closure/${closurePeriod}.json ${asset}: invalid margins`)
        continue
      }
      const sourceMargins = closureMargins.get(`${closurePeriod}|${asset}`)
      if (!sourceMargins) {
        fail(`position_closure/${closurePeriod}.json ${asset}: source IIP margins missing`)
        continue
      }
      const bilateralPath = join(OUT_DIR, 'flows_bilateral', `${closurePeriod}.json`)
      const direct = (
        JSON.parse(readFileSync(bilateralPath, 'utf8')) as {
          records: Array<{
            owner_country: string
            issuer_country: string
            asset: string
            measure: string
            value_usd: number
            source_id: string
          }>
        }
      ).records.filter(
        (row) =>
          row.source_id === 'imf_pip' &&
          row.measure === 'stock' &&
          row.asset === asset,
      )
      let recomputed
      try {
        recomputed = rasClose(
          direct.map((row) => ({
            row: row.owner_country,
            column: row.issuer_country,
            value: row.value_usd,
          })),
          sourceMargins.rows,
          sourceMargins.columns,
        )
      } catch (error) {
        fail(
          `position_closure/${closurePeriod}.json ${asset}: recompute failed: ${String(error)}`,
        )
        continue
      }
      for (const [label, actual, expected] of [
        ['row', rowMargins.data, recomputed.rowMargins],
        ['column', columnMargins.data, recomputed.columnMargins],
      ] as const) {
        const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
        if (
          [...keys].some(
            (key) =>
              actual[key] === undefined ||
              expected[key] === undefined ||
              Math.abs(actual[key] - expected[key]) >
                1e-12 * Math.max(1, expected[key]),
          )
        )
          fail(`position_closure/${closurePeriod}.json ${asset}: ${label} margins drift`)
      }
      if (
        Math.abs(recomputed.directSeedShare - Number(result.direct_seed_share)) > 1e-12
      )
        fail(`position_closure/${closurePeriod}.json ${asset}: seed coverage mismatch`)
      if (recomputed.iterations !== Number(result.iterations))
        fail(`position_closure/${closurePeriod}.json ${asset}: iteration count mismatch`)
      if (
        Math.abs(recomputed.residual - Number(result.residual)) >
        1e-12 * Math.max(1, recomputed.residual)
      )
        fail(`position_closure/${closurePeriod}.json ${asset}: residual mismatch`)
      if (recomputed.residual > 1e-9)
        fail(`position_closure/${closurePeriod}.json ${asset}: recomputed residual exceeds 1e-9`)
      const allExpectedCells = [...recomputed.cells]
        .sort((a, b) => b.value - a.value)
      if (Number(result.total_cells) !== allExpectedCells.length)
        fail(`position_closure/${closurePeriod}.json ${asset}: total cell count mismatch`)
      const expectedOmitted = allExpectedCells
        .slice(cells.data.length)
        .reduce((sum, cell) => sum + cell.value, 0)
      if (
        Math.abs(expectedOmitted - Number(result.omitted_value_usd)) >
        1e-9 * Math.max(1, expectedOmitted)
      )
        fail(`position_closure/${closurePeriod}.json ${asset}: omitted value mismatch`)
      if (
        cells.data.some(
          (cell) =>
            Math.abs(cell.coverage_share - recomputed.directSeedShare) > 1e-12,
        )
      )
        fail(`position_closure/${closurePeriod}.json ${asset}: cell coverage mismatch`)
      const expectedCells = allExpectedCells.slice(0, cells.data.length)
      for (let i = 0; i < cells.data.length; i++) {
        const actual = cells.data[i]
        const expected = expectedCells[i]
        if (
          !expected ||
          actual.owner_country !== expected.row ||
          actual.issuer_country !== expected.column ||
          Math.abs(actual.value_usd - expected.value) > 1e-6 * Math.max(1, expected.value) ||
          actual.lower_bound !== expected.lower ||
          actual.upper_bound !== expected.upper
        ) {
          fail(`position_closure/${closurePeriod}.json ${asset}: published cell ${i} drift`)
          break
        }
      }
      positionClosureN += cells.data.length
      for (const row of cells.data) bump(row.confidence_grade)
    }
  }
  if (positionClosureN === 0) fail('position closure contains no published cells')
  else
    ok(
      `position closure: ${closurePeriods.success ? closurePeriods.data.length : 0} periods · ` +
        `${positionClosureN} grade-E cells (converged, residual ≤1e-9)`,
    )
}

// ---- flowmatrix (Phase O — §8 모델 배분) --------------------------------------
const fmCell = z.object({
  from: z.string(),
  to: z.string(),
  value: z.number().finite().nonnegative(),
  lower: z.number().finite(),
  upper: z.number().finite(),
})
const fmCountry = z.object({
  observed: z.record(z.string(), z.number().finite()),
  cells: z.array(fmCell),
  external: z.enum(['source', 'sink']).nullable(),
  iterations: z.number().int().positive().max(100),
  converged: z.literal(true), // 미수렴 결과는 커밋 자체가 금지
  residual: z.number().finite(),
})
const fmDir = join(OUT_DIR, 'flowmatrix')
if (!existsSync(fmDir)) fail('flowmatrix/ missing')
else {
  const fmFiles = readdirSync(fmDir).filter((f) => f.endsWith('.json') && f !== 'index.json')
  let fmCountries = 0
  for (const f of fmFiles) {
    const size = statSync(join(fmDir, f)).size
    if (size > 5 * 1024 * 1024) fail(`flowmatrix/${f} exceeds 5MB`)
    const body = JSON.parse(readFileSync(join(fmDir, f), 'utf8')) as {
      method: string
      countries: Record<string, unknown>
    }
    if (body.method !== 'max_entropy_flow_allocation_ipf')
      fail(`flowmatrix/${f}: unexpected method ${body.method}`)
    for (const [iso, c] of Object.entries(body.countries)) {
      const p = fmCountry.safeParse(c)
      if (!p.success) {
        if (errors < 20) fail(`flowmatrix/${f} ${iso}: ${p.error.issues[0].message}`)
        errors++
        continue
      }
      fmCountries++
      // 마진 정합: 매수 자산의 열합 = 관측 순유입 (±1e-6 상대)
      for (const [asset, net] of Object.entries(p.data.observed)) {
        if (net <= 0) continue
        const col = p.data.cells
          .filter((x) => x.to === asset)
          .reduce((s, x) => s + x.value, 0)
        if (Math.abs(col - net) > 1e-6 * Math.max(1, net))
          fail(`flowmatrix/${f} ${iso}.${asset}: column sum ${col} ≠ observed ${net}`)
      }
    }
  }
  ok(`flowmatrix: ${fmFiles.length} periods, ${fmCountries} country-matrices (margins closed)`)
}

// ---- facts (Phase P-1 — 사실 테이블 정합: 엔진의 존재 이유) --------------------
const factsGz = join(OUT_DIR, 'facts.ndjson.gz')
const factsSummaryPath = join(OUT_DIR, 'meta/facts_summary.json')
if (!existsSync(factsGz) || !existsSync(factsSummaryPath)) {
  fail('facts.ndjson.gz / meta/facts_summary.json missing — run pnpm data:facts')
} else {
  const fs = JSON.parse(readFileSync(factsSummaryPath, 'utf8')) as {
    records: number
    by_table: Record<string, number>
    by_grade: Record<string, number>
    gzip_bytes: number
  }
  const expected: Record<string, number> = {
    stocks: stockTotal,
    flows_country: flowN,
    flows_bilateral: biN,
    currency_exposure: currencyN,
    sector_positions: sectorN,
    reconstructed_liabilities: reconstructedN,
    constant_fx: fxdN,
    position_closure: positionClosureN,
  }
  for (const [table, n] of Object.entries(expected))
    if (fs.by_table[table] !== n)
      fail(`facts.${table}: ${fs.by_table[table]} ≠ shard sum ${n}`)
  const gradeMismatch = Object.keys({ ...gradeDist, ...fs.by_grade }).filter(
    (g) => (gradeDist[g] ?? 0) !== (fs.by_grade[g] ?? 0),
  )
  if (gradeMismatch.length > 0)
    fail(`facts grade distribution mismatch: ${gradeMismatch.join(',')}`)
  const gzBytes = statSync(factsGz).size
  if (gzBytes !== fs.gzip_bytes) fail('facts.ndjson.gz size ≠ summary.gzip_bytes')
  if (gzBytes > 100 * 1024 * 1024) fail('facts.ndjson.gz exceeds Vercel 100MB file limit')
  const expectedTotal = Object.values(expected).reduce((sum, value) => sum + value, 0)
  if (fs.records !== expectedTotal)
    fail(`facts total ${fs.records} ≠ ${expectedTotal}`)
  else ok(`facts table: ${fs.records} records = shard sums, ${(gzBytes / 1e6).toFixed(1)}MB gz`)
}

// ---- mirror reconciliation (Phase P-2 — §12-3, 조정 없이 기록) -----------------
const reconPath = join(OUT_DIR, 'meta/reconciliation.json')
if (!existsSync(reconPath)) {
  fail('meta/reconciliation.json missing — run pnpm data:reconcile')
} else {
  const recon = JSON.parse(readFileSync(reconPath, 'utf8')) as {
    periods: Record<string, { pairs: number; median_gap_share: number }>
  }
  const latestRecon = Object.keys(recon.periods).sort().at(-1)
  const rs = latestRecon ? recon.periods[latestRecon] : undefined
  if (!rs || rs.pairs < 100) fail(`mirror pairs @latest ${rs?.pairs ?? 0} < 100`)
  // 관대 임계(실측 중앙값 ~36% — BIS creditor/debtor 비교는 부문 커버리지 차로 수십%가 정상)
  else if (rs.median_gap_share <= 0 || rs.median_gap_share >= 0.9)
    fail(`mirror median gap ${(rs.median_gap_share * 100).toFixed(1)}% outside lenient (0, 90%)`)
  else
    ok(
      `mirror reconciliation @${latestRecon}: ${rs.pairs} pairs, median gap ${(rs.median_gap_share * 100).toFixed(1)}% (recorded, not adjusted)`,
    )
}

// ---- meta -------------------------------------------------------------------
const intensity = JSON.parse(readFileSync(join(OUT_DIR, 'meta/flow_intensity.json'), 'utf8'))
if (!Array.isArray(intensity.series) || intensity.series.length < 40)
  fail(`flow_intensity has only ${intensity.series?.length ?? 0} quarters`)
else ok(`flow_intensity: ${intensity.series.length} quarters for barograph`)

console.log('\n  grade distribution:', gradeDist)
if (errors > 0) {
  console.error(`\n[sanity] FAILED with ${errors} error(s)`)
  process.exit(1)
}
console.log('\n[sanity] all checks passed')
