/**
 * Assemble normalized source data into the contract datasets under
 * public/data/ — including the honest "no empty cells" fallback ladder:
 *
 *   direct observation (A)
 *   → roll-forward of last observation, max 8 quarters (D, ±20%)
 *   → regional-median GDP-share model for never-observed countries (E, ±35%)
 *
 * Estimated records always carry estimate_method + bounds; observed records
 * never do. Files are sharded per period (contract sharding clause).
 */
import type { CountryRow } from '../fetch/countries.ts'
import type { WbData } from '../fetch/worldbank.ts'
import {
  IIP_INDICATORS,
  BOP_INDICATORS,
  type ImfStockObs,
  type ImfFlowObs,
  type PipObs,
} from '../fetch/imf.ts'
import { compareQuarters, failures, quarterEndDate, writeJson } from '../fetch/lib.ts'

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'

interface StockRecord {
  country: string
  asset: string
  period: string
  measure: 'stock'
  value_usd: number
  source_id: string
  effective_date: string
  confidence_grade: Grade
  estimate_method?: string
  lower_bound?: number
  upper_bound?: number
}

interface FlowRecord {
  country: string
  asset: string
  period: string
  measure: 'flow' | 'valuation'
  entry: 'assets' | 'liabilities'
  value_usd: number
  source_id: string
  effective_date: string
  confidence_grade: Grade
  estimate_method?: string
  lower_bound?: number
  upper_bound?: number
}

interface BilateralRecord {
  owner_country: string
  issuer_country: string
  asset: string
  period: string
  measure: 'stock' | 'flow'
  value_usd: number
  source_id: string
  effective_date: string
  confidence_grade: Grade
  estimate_method?: string
  lower_bound?: number
  upper_bound?: number
}

const GENERATED_AT = new Date().toISOString()

/**
 * Bilateral pruning threshold. Dropped counts are reported — never silently
 * truncated. Value retention is not computed, so the pipeline does not claim it.
 */
const BILATERAL_MIN_USD = 1e8

const round = (n: number) => Math.round(n)

/** Housing-wealth-to-GDP heuristic by subregion (crude v1 model, grade E). */
const PROPERTY_GDP_RATIO: Record<string, number> = {
  'Western Europe': 2.8,
  'Northern Europe': 2.6,
  'Southern Europe': 2.4,
  'Eastern Europe': 1.8,
  'North America': 2.7,
  'Eastern Asia': 2.9,
  'South-Eastern Asia': 2.0,
  'Southern Asia': 1.8,
  'Central Asia': 1.5,
  'Western Asia': 1.9,
  'Australia and New Zealand': 3.1,
}
const PROPERTY_GDP_RATIO_DEFAULT = 1.6

function quarterRange(latest: string): string[] {
  const out: string[] = []
  const [ly, lq] = latest.split('-Q').map(Number)
  for (let y = 2010; y <= ly; y++)
    for (let q = 1; q <= 4; q++) {
      if (y === ly && q > lq) break
      out.push(`${y}-Q${q}`)
    }
  return out
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export interface AssembleInputs {
  countries: CountryRow[]
  wb: WbData
  iip: ImfStockObs[]
  bop: ImfFlowObs[]
  pip: PipObs[]
}

export function assemble({ countries, wb, iip, bop, pip }: AssembleInputs): void {
  const iso3Set = new Set(countries.map((c) => c.iso3))
  const regionOf = new Map(countries.map((c) => [c.iso3, c.region]))
  // latest GDP per country (single pass, keep max year)
  const gdpLatest = new Map<string, number>()
  const gdpYear = new Map<string, number>()
  for (const g of wb.gdp) {
    if ((gdpYear.get(g.iso3) ?? 0) < g.year) {
      gdpYear.set(g.iso3, g.year)
      gdpLatest.set(g.iso3, g.value)
    }
  }

  const iipInScope = iip.filter((o) => iso3Set.has(o.iso3))
  const latestQuarter = iipInScope.map((o) => o.quarter).sort(compareQuarters).at(-1)
  if (!latestQuarter) throw new Error('no IIP observations — cannot assemble')
  const allQuarters = quarterRange(latestQuarter)

  // ---- observed stock grid: basis -> country|asset -> quarter -> value ----
  const OWNER_ASSETS = Object.values(IIP_INDICATORS)
  const ISSUER_IIP_ASSETS = ['unlisted_equity_fdi', 'debt_securities', 'deposits', 'loans']

  const grid = {
    owner: new Map<string, Map<string, number>>(),
    issuer: new Map<string, Map<string, number>>(),
  }
  for (const o of iipInScope) {
    const asset = IIP_INDICATORS[o.indicator]
    if (o.entry === 'L_P') {
      // issuer side: skip listed_equity (WB total market cap owns that slot)
      // and reserves (asset-side concept only)
      if (!ISSUER_IIP_ASSETS.includes(asset)) continue
    }
    const basis = o.entry === 'A_P' ? 'owner' : 'issuer'
    const key = `${o.iso3}|${asset}`
    let m = grid[basis].get(key)
    if (!m) grid[basis].set(key, (m = new Map()))
    m.set(o.quarter, o.value)
  }

  // ---- fallback ladder → sharded stock records --------------------------
  const shards = new Map<string, StockRecord[]>() // `${basis}/${period}` -> records
  const push = (basis: string, r: StockRecord) => {
    const k = `${basis}/${r.period}`
    let arr = shards.get(k)
    if (!arr) shards.set(k, (arr = []))
    arr.push(r)
  }
  const gradeCount: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 }

  const emitBasis = (basis: 'owner' | 'issuer', assets: string[]) => {
    // regional median ratios (value/GDP) from latest observed quarter
    const ratioSamples = new Map<string, number[]>() // `${region}|${asset}` -> ratios
    for (const [key, m] of grid[basis]) {
      const [iso3, asset] = key.split('|')
      const v = m.get(latestQuarter)
      const gdp = gdpLatest.get(iso3)
      if (v === undefined || !gdp) continue
      const rk = `${regionOf.get(iso3)}|${asset}`
      if (!ratioSamples.has(rk)) ratioSamples.set(rk, [])
      ratioSamples.get(rk)!.push(v / gdp)
    }
    const globalSamples = new Map<string, number[]>() // asset -> ratios
    for (const [rk, xs] of ratioSamples) {
      const asset = rk.split('|')[1]
      if (!globalSamples.has(asset)) globalSamples.set(asset, [])
      globalSamples.get(asset)!.push(...xs)
    }

    for (const c of countries) {
      for (const asset of assets) {
        const m = grid[basis].get(`${c.iso3}|${asset}`)
        if (m && m.size > 0) {
          // observed + bounded roll-forward for gaps
          let lastVal: number | undefined
          let gapQuarters = 0
          for (const q of allQuarters) {
            const v = m.get(q)
            if (v !== undefined) {
              lastVal = v
              gapQuarters = 0
              gradeCount.A++
              push(basis, {
                country: c.iso3,
                asset,
                period: q,
                measure: 'stock',
                value_usd: round(v),
                source_id: 'imf_iip',
                effective_date: quarterEndDate(q),
                confidence_grade: 'A',
              })
            } else if (lastVal !== undefined && ++gapQuarters <= 8) {
              gradeCount.D++
              push(basis, {
                country: c.iso3,
                asset,
                period: q,
                measure: 'stock',
                value_usd: round(lastVal),
                source_id: 'imf_iip',
                effective_date: quarterEndDate(q),
                confidence_grade: 'D',
                estimate_method: 'rollforward_last_observation',
                lower_bound: round(lastVal * 0.8),
                upper_bound: round(lastVal * 1.2),
              })
            }
          }
        } else {
          // never observed → regional median GDP-share model, latest 4Q only
          const gdp = gdpLatest.get(c.iso3)
          if (!gdp) continue // no GDP anchor → cell stays honest-empty, reported
          const ratio =
            median(ratioSamples.get(`${c.region}|${asset}`) ?? []) ??
            median(globalSamples.get(asset) ?? [])
          if (ratio === null) continue
          const value = ratio * gdp
          for (const q of allQuarters.slice(-4)) {
            gradeCount.E++
            push(basis, {
              country: c.iso3,
              asset,
              period: q,
              measure: 'stock',
              value_usd: round(value),
              source_id: 'model_regional_median',
              effective_date: quarterEndDate(q),
              confidence_grade: 'E',
              estimate_method: 'regional_median_gdp_share',
              lower_bound: round(value * 0.65),
              upper_bound: round(value * 1.35),
            })
          }
        }
      }
    }
  }

  emitBasis('owner', OWNER_ASSETS)
  emitBasis('issuer', ISSUER_IIP_ASSETS)

  // issuer listed_equity = WB total market capitalization (annual → Q4, B)
  for (const o of wb.marketCap) {
    if (o.year < 2010) continue
    const period = `${o.year}-Q4`
    if (compareQuarters(period, latestQuarter) > 0) continue
    gradeCount.B++
    push('issuer', {
      country: o.iso3,
      asset: 'listed_equity',
      period,
      measure: 'stock',
      value_usd: round(o.value),
      source_id: 'wb_wdi',
      effective_date: `${o.year}-12-31`,
      confidence_grade: 'B',
    })
  }

  // location basis: residential property via GDP-ratio heuristic (E)
  const gdpByYear = new Map<string, number>() // `${iso3}|${year}`
  for (const g of wb.gdp) gdpByYear.set(`${g.iso3}|${g.year}`, g.value)
  for (const c of countries) {
    const ratio = PROPERTY_GDP_RATIO[c.region] ?? PROPERTY_GDP_RATIO_DEFAULT
    for (let year = 2010; year <= Number(latestQuarter.slice(0, 4)); year++) {
      const gdp = gdpByYear.get(`${c.iso3}|${year}`)
      if (!gdp) continue
      const period = `${year}-Q4`
      if (compareQuarters(period, latestQuarter) > 0) continue
      const value = gdp * ratio
      gradeCount.E++
      push('location', {
        country: c.iso3,
        asset: 'residential_property',
        period,
        measure: 'stock',
        value_usd: round(value),
        source_id: 'model_gdp_ratio',
        effective_date: `${year}-12-31`,
        confidence_grade: 'E',
        estimate_method: 'housing_wealth_gdp_ratio_by_region',
        lower_bound: round(value * 0.65),
        upper_bound: round(value * 1.35),
      })
    }
  }

  // ---- flows_country: observed BOP transactions (A) + derived valuation (C)
  const flowShards = new Map<string, FlowRecord[]>()
  const pushFlow = (r: FlowRecord) => {
    let arr = flowShards.get(r.period)
    if (!arr) flowShards.set(r.period, (arr = []))
    arr.push(r)
  }
  const bopGrid = new Map<string, number>() // `${iso3}|${asset}|${entry}|${q}`
  for (const o of bop) {
    if (!iso3Set.has(o.iso3)) continue
    const asset = BOP_INDICATORS[o.indicator]
    const entry = o.entry === 'A_NFA_T' ? 'assets' : 'liabilities'
    bopGrid.set(`${o.iso3}|${asset}|${entry}|${o.quarter}`, o.value)
    gradeCount.A++
    pushFlow({
      country: o.iso3,
      asset,
      period: o.quarter,
      measure: 'flow',
      entry,
      value_usd: round(o.value),
      source_id: 'imf_bop',
      effective_date: quarterEndDate(o.quarter),
      confidence_grade: 'A',
    })
  }
  // valuation change = ΔIIP position − BOP transactions (both observed)
  for (const [key, m] of grid.owner) {
    const [iso3, asset] = key.split('|')
    for (let i = 1; i < allQuarters.length; i++) {
      const q = allQuarters[i]
      const prev = m.get(allQuarters[i - 1])
      const cur = m.get(q)
      const flow = bopGrid.get(`${iso3}|${asset}|assets|${q}`)
      if (prev === undefined || cur === undefined || flow === undefined) continue
      const valuation = cur - prev - flow
      const spread = Math.abs(cur - prev) * 0.15
      gradeCount.C++
      pushFlow({
        country: iso3,
        asset,
        period: q,
        measure: 'valuation',
        entry: 'assets',
        value_usd: round(valuation),
        source_id: 'imf_iip',
        effective_date: quarterEndDate(q),
        confidence_grade: 'C',
        estimate_method: 'position_change_minus_transactions',
        lower_bound: round(valuation - spread),
        upper_bound: round(valuation + spread),
      })
    }
  }

  // ---- flows_bilateral: PIP positions (A) + naive derived flows (D) ------
  const bilateralShards = new Map<string, BilateralRecord[]>()
  const pushBi = (r: BilateralRecord) => {
    let arr = bilateralShards.get(r.period)
    if (!arr) bilateralShards.set(r.period, (arr = []))
    arr.push(r)
  }
  const ASSET_OF_PIP = { P_F51_P_USD: 'listed_equity', P_F3_P_USD: 'debt_securities' } as const
  const pipGrid = new Map<string, Map<number, number>>() // `${o}|${i}|${asset}` -> year -> v
  let biStockDropped = 0
  let biFlowDropped = 0
  for (const o of pip) {
    if (!iso3Set.has(o.owner) || !iso3Set.has(o.issuer)) continue
    if (o.owner === o.issuer) continue
    const asset = ASSET_OF_PIP[o.indicator]
    const key = `${o.owner}|${o.issuer}|${asset}`
    if (!pipGrid.has(key)) pipGrid.set(key, new Map())
    pipGrid.get(key)!.set(o.year, o.value) // full grid — Δflows see unpruned data
    if (Math.abs(o.value) < BILATERAL_MIN_USD) {
      biStockDropped++
      continue
    }
    const period = `${o.year}-Q4`
    gradeCount.A++
    pushBi({
      owner_country: o.owner,
      issuer_country: o.issuer,
      asset,
      period,
      measure: 'stock',
      value_usd: round(o.value),
      source_id: 'imf_pip',
      effective_date: `${o.year}-12-31`,
      confidence_grade: 'A',
    })
  }
  for (const [key, byYear] of pipGrid) {
    const [owner, issuer, asset] = key.split('|')
    for (const [year, v] of byYear) {
      const prev = byYear.get(year - 1)
      if (prev === undefined) continue
      const flow = v - prev
      if (Math.abs(flow) < BILATERAL_MIN_USD) {
        biFlowDropped++
        continue
      }
      const spread = Math.abs(flow) * 0.35
      gradeCount.D++
      pushBi({
        owner_country: owner,
        issuer_country: issuer,
        asset,
        period: `${year}-Q4`,
        measure: 'flow',
        value_usd: round(flow),
        source_id: 'imf_pip',
        effective_date: `${year}-12-31`,
        confidence_grade: 'D',
        estimate_method: 'position_change_unadjusted_for_price',
        lower_bound: round(flow - spread),
        upper_bound: round(flow + spread),
      })
    }
  }
  console.log(
    `[assemble] bilateral pruning <$${BILATERAL_MIN_USD / 1e6}M: ` +
      `dropped ${biStockDropped} stock + ${biFlowDropped} flow records`,
  )

  // ---- write shards + index + barograph series --------------------------
  const stockPeriods: Record<string, string[]> = { owner: [], issuer: [], location: [] }
  let totalBytes = 0
  for (const [k, records] of shards) {
    const [basis, period] = k.split('/')
    stockPeriods[basis].push(period)
    // 결정론(Phase N): 샤드에 타임스탬프 금지 — 빈티지는 index.json이 정본
    totalBytes += writeJson(`stocks_${basis}/${period}.json`, { basis, records })
  }
  for (const arr of Object.values(stockPeriods)) arr.sort(compareQuarters)

  const flowPeriods = [...flowShards.keys()].sort(compareQuarters)
  for (const [period, records] of flowShards)
    totalBytes += writeJson(`flows_country/${period}.json`, { records })

  const bilateralPeriods = [...bilateralShards.keys()].sort(compareQuarters)
  for (const [period, records] of bilateralShards)
    totalBytes += writeJson(`flows_bilateral/${period}.json`, { records })

  // barograph: global gross cross-border transaction intensity per quarter
  const intensity = flowPeriods.map((period) => {
    const recs = flowShards.get(period)!.filter((r) => r.measure === 'flow')
    return {
      period,
      gross_flow_usd: recs.reduce((s, r) => s + Math.abs(r.value_usd), 0),
      n_countries: new Set(recs.map((r) => r.country)).size,
      source_id: 'imf_bop',
      confidence_grade: 'A' as const,
    }
  })
  writeJson('meta/flow_intensity.json', { series: intensity })

  writeJson('index.json', {
    generated_at: GENERATED_AT,
    latest_quarter: latestQuarter,
    periods: {
      stocks_owner: stockPeriods.owner,
      stocks_issuer: stockPeriods.issuer,
      stocks_location: stockPeriods.location,
      flows_country: flowPeriods,
      flows_bilateral: bilateralPeriods,
    },
  })

  writeJson('meta/pipeline_report.json', {
    generated_at: GENERATED_AT,
    latest_quarter: latestQuarter,
    grade_distribution: gradeCount,
    countries_in_master: countries.length,
    countries_with_owner_stocks: new Set(
      [...grid.owner.keys()].map((k) => k.split('|')[0]),
    ).size,
    pip_reporters: new Set(pip.map((p) => p.owner)).size,
    bilateral_pruning: {
      min_usd: BILATERAL_MIN_USD,
      dropped_stock_records: biStockDropped,
      dropped_flow_records: biFlowDropped,
      note: 'value retention is not computed; use the recorded dropped record counts',
    },
    terminal_fetch_failures: failures,
    total_output_bytes: totalBytes,
  })

  console.log(
    `[assemble] grades A:${gradeCount.A} B:${gradeCount.B} C:${gradeCount.C} ` +
      `D:${gradeCount.D} E:${gradeCount.E} · latest ${latestQuarter} · ` +
      `${(totalBytes / 1e6).toFixed(1)}MB across shards`,
  )
}
