/**
 * IMF Data API (api.imf.org, SDMX 2.1 — successor to the decommissioned
 * dataservices.imf.org). Serves StructureSpecificData XML only.
 *
 * Dataflows used (probed live 2026-07-12):
 *   IMF.STA:IIP  key COUNTRY.BOP_ACCOUNTING_ENTRY.INDICATOR.UNIT.FREQUENCY
 *                entries A_P (external assets) / L_P (external liabilities)
 *   IMF.STA:BOP  same key shape; entries A_NFA_T (net acquisition of financial
 *                assets) / L_NIL_T (net incurrence of liabilities) — REAL flows
 *   IMF.STA:PIP  key COUNTRY.ACCOUNTING_ENTRY.INDICATOR.SECTOR.
 *                COUNTERPART_SECTOR.COUNTERPART_COUNTRY.FREQUENCY
 *                (CPIS bilateral portfolio positions)
 *
 * OBS_VALUE is absolute current USD (verified: KOR D A_P 2024-Q4 ≈ $769.5B).
 */
import {
  assertMinimumRows,
  assertNoNewFailures,
  chunk,
  failures,
  fetchCached,
  parseSdmxSeries,
  pooled,
  toQuarter,
  writeRawJson,
} from './lib.ts'

const BASE = 'https://api.imf.org/external/sdmx/2.1/data'

/** BPM6 indicator → contract asset class, per side. */
export const IIP_INDICATORS = {
  D: 'unlisted_equity_fdi', // direct investment
  P_F5_MV: 'listed_equity', // portfolio equity & investment fund shares (MV)
  P_F3_MV: 'debt_securities', // portfolio debt securities (MV)
  O_F2_NV: 'deposits', // other investment: currency & deposits
  O_F4_NV: 'loans', // other investment: loans
  R: 'reserves_gold', // reserve assets (assets side only)
} as const

export const BOP_INDICATORS = {
  D_F: 'unlisted_equity_fdi',
  P_F5: 'listed_equity',
  P_F3: 'debt_securities',
  O_F2: 'deposits',
  O_F4: 'loans',
} as const

export interface ImfStockObs {
  iso3: string
  entry: 'A_P' | 'L_P'
  indicator: keyof typeof IIP_INDICATORS
  quarter: string
  value: number
}

/**
 * BPM6 transaction entries (probed live): A_NFA_T = net acquisition of
 * financial assets, L_NIL_T = net incurrence of liabilities. (A_T/L_T do
 * not exist for financial-account indicators in this dataflow.)
 */
export interface ImfFlowObs {
  iso3: string
  entry: 'A_NFA_T' | 'L_NIL_T'
  indicator: keyof typeof BOP_INDICATORS
  quarter: string
  value: number
}

export interface PipObs {
  owner: string
  issuer: string
  indicator: 'P_F51_P_USD' | 'P_F3_P_USD'
  period: string
  frequency: 'A' | 'S'
  value: number
}

const PIP_INDICATORS = new Set<PipObs['indicator']>([
  'P_F51_P_USD',
  'P_F3_P_USD',
])

const pipKey = (row: PipObs) =>
  [row.owner, row.issuer, row.indicator, row.period].join('|')

/** Normalize annual + semiannual direct PIP positions; S wins on a Q4 collision. */
export function parsePip(xml: string): PipObs[] {
  const rows = new Map<string, { row: PipObs; priority: number }>()
  for (const series of parseSdmxSeries(xml)) {
    const owner = series.attrs.COUNTRY
    const issuer = series.attrs.COUNTERPART_COUNTRY
    const indicator = series.attrs.INDICATOR as PipObs['indicator']
    const frequency = series.attrs.FREQUENCY as PipObs['frequency']
    if (
      owner?.length !== 3 ||
      issuer?.length !== 3 ||
      owner === issuer ||
      series.attrs.ACCOUNTING_ENTRY !== 'A' ||
      series.attrs.SECTOR !== 'S1' ||
      series.attrs.COUNTERPART_SECTOR !== 'S1' ||
      !PIP_INDICATORS.has(indicator) ||
      (frequency !== 'A' && frequency !== 'S')
    )
      continue
    const priority = frequency === 'S' ? 2 : 1
    for (const observation of series.obs) {
      const period = toQuarter(observation.period)
      if (!period) continue
      const row: PipObs = {
        owner,
        issuer,
        indicator,
        period,
        frequency,
        value: observation.value,
      }
      const key = pipKey(row)
      if ((rows.get(key)?.priority ?? 0) < priority)
        rows.set(key, { row, priority })
    }
  }
  return [...rows.values()]
    .map(({ row }) => row)
    .sort((a, b) => pipKey(a).localeCompare(pipKey(b)))
}

async function fetchChunkedQuarterly<T>(
  dataset: 'IIP' | 'BOP',
  iso3s: string[],
  entries: string[],
  indicators: string[],
  mapSeries: (attrs: Record<string, string>, quarter: string, value: number) => T | null,
): Promise<T[]> {
  const chunks = chunk(iso3s, 12)
  const out: T[] = []
  await pooled(chunks, 5, async (group, i) => {
    const key = `${group.join('+')}.${entries.join('+')}.${indicators.join('+')}.USD.Q`
    const url = `${BASE}/IMF.STA,${dataset}/${key}?startPeriod=2010-Q1`
    // cache key embeds the entry codes so a key-shape fix invalidates stale files
    const cacheKey = `imf/${dataset.toLowerCase()}_${entries.join('-')}_chunk${i}.xml`
    const xml = await fetchCached(cacheKey, url)
    if (xml === null) return
    for (const s of parseSdmxSeries(xml)) {
      for (const o of s.obs) {
        const q = toQuarter(o.period)
        if (!q) continue
        const rec = mapSeries(s.attrs, q, o.value)
        if (rec) out.push(rec)
      }
    }
  })
  return out
}

export async function runIip(iso3s: string[]): Promise<ImfStockObs[]> {
  const failureStart = failures.length
  const rows = await fetchChunkedQuarterly<ImfStockObs>(
    'IIP',
    iso3s,
    ['A_P', 'L_P'],
    Object.keys(IIP_INDICATORS),
    (attrs, quarter, value) => {
      const indicator = attrs.INDICATOR as keyof typeof IIP_INDICATORS
      if (!(indicator in IIP_INDICATORS)) return null
      return {
        iso3: attrs.COUNTRY,
        entry: attrs.BOP_ACCOUNTING_ENTRY as 'A_P' | 'L_P',
        indicator,
        quarter,
        value,
      }
    },
  )
  assertNoNewFailures('IMF IIP', failureStart)
  assertMinimumRows('IMF IIP', rows.length, 1_000)
  writeRawJson('imf/iip_normalized.json', rows)
  console.log(`[imf:iip] ${rows.length} obs, ${new Set(rows.map((r) => r.iso3)).size} countries`)
  return rows
}

export async function runBop(iso3s: string[]): Promise<ImfFlowObs[]> {
  const failureStart = failures.length
  const rows = await fetchChunkedQuarterly<ImfFlowObs>(
    'BOP',
    iso3s,
    ['A_NFA_T', 'L_NIL_T'],
    Object.keys(BOP_INDICATORS),
    (attrs, quarter, value) => {
      const indicator = attrs.INDICATOR as keyof typeof BOP_INDICATORS
      if (!(indicator in BOP_INDICATORS)) return null
      return {
        iso3: attrs.COUNTRY,
        entry: attrs.BOP_ACCOUNTING_ENTRY as 'A_NFA_T' | 'L_NIL_T',
        indicator,
        quarter,
        value,
      }
    },
  )
  assertNoNewFailures('IMF BOP', failureStart)
  assertMinimumRows('IMF BOP', rows.length, 1_000)
  writeRawJson('imf/bop_normalized.json', rows)
  console.log(`[imf:bop] ${rows.length} obs, ${new Set(rows.map((r) => r.iso3)).size} countries`)
  return rows
}

/**
 * PIP/CPIS bilateral positions: per-reporter requests (assets side, total
 * economy sector S1 vs counterpart sector S1, annual + semiannual). Non-reporters return
 * an empty dataset (~2.6KB) — cheap to skip over.
 */
export async function runPip(iso3s: string[]): Promise<PipObs[]> {
  const failureStart = failures.length
  const parsed = await pooled(iso3s, 6, async (iso3) => {
    const key = `${iso3}.A.P_F51_P_USD+P_F3_P_USD.S1.S1..A+S`
    const url = `${BASE}/IMF.STA,PIP/${key}?startPeriod=2013`
    const xml = await fetchCached(`imf/pip_A-S_${iso3}.xml`, url)
    return xml === null ? [] : parsePip(xml)
  })
  assertNoNewFailures('IMF PIP', failureStart)
  const out = parsed.flat()
  assertMinimumRows('IMF PIP', out.length, 1_000)
  writeRawJson('imf/pip_normalized.json', out)
  const reporters = new Set(out.map((r) => r.owner))
  console.log(`[imf:pip] ${out.length} obs, ${reporters.size} reporting economies`)
  return out
}
