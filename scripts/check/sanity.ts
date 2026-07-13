/**
 * Contract + plausibility gate for public/data (pnpm data:check).
 * Fails (exit 1) on schema violations or implausible world totals.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { OUT_DIR } from '../fetch/lib.ts'

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
  if (fs.records !== stockTotal + flowN + biN)
    fail(`facts total ${fs.records} ≠ ${stockTotal + flowN + biN}`)
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
