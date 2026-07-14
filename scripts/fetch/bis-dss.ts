/**
 * BIS national debt-securities statistics (DSS).
 *
 * Product boundary: these are national issuance/holdings observations. They
 * never enter stocks_owner/stocks_issuer or bilateral corridors, whose
 * statistical bases are different.
 */
import type {
  DebtMarketCounterpartyScope,
  DebtMarketRecord,
  DebtMarketSector,
} from '../../src/types/data.ts'
import {
  assertMinimumRows,
  assertNoNewFailures,
  failures,
  fetchCached,
  quarterEndDate,
} from './lib.ts'

const FLOW = 'BIS/WS_NA_SEC_DSS/1.0'
const BASE = `https://stats.bis.org/api/v2/data/dataflow/${FLOW}`
const START_PERIOD = '2010-01-01'

// Wildcards are limited to reporting economy, counterparty area, sector and
// stock/flow. Every comparability dimension is fixed explicitly.
const queryUrl = (entry: 'A' | 'L') =>
  `${BASE}/Q.N....S1.N.${entry}..F3.T._Z.USD._T.M.V.N._T?format=csv&startPeriod=${START_PERIOD}`

const REQUIRED_COLUMNS = [
  'FREQ',
  'ADJUSTMENT',
  'REF_AREA',
  'COUNTERPART_AREA',
  'REF_SECTOR',
  'COUNTERPART_SECTOR',
  'CONSOLIDATION',
  'ACCOUNTING_ENTRY',
  'STO',
  'INSTR_ASSET',
  'MATURITY',
  'EXPENDITURE',
  'UNIT_MEASURE',
  'CURRENCY_DENOM',
  'VALUATION',
  'PRICES',
  'TRANSFORMATION',
  'CUST_BREAKDOWN',
  'TITLE',
  'UNIT_MULT',
  'TIME_PERIOD',
  'OBS_VALUE',
] as const

const SECTORS = new Set<DebtMarketSector>([
  'S1',
  'S11',
  'S12',
  'S121',
  'S122',
  'S123',
  'S125A',
  'S12P',
  'S12Q',
  'S12T',
  'S13',
  'S1311',
  'S1M',
  'S1ZS',
])

const SCOPES: Readonly<Record<string, DebtMarketCounterpartyScope>> = {
  XW: 'world',
  '1E': 'resident',
  '5Z': 'nonresident',
}

export interface DssRow {
  frequency: string
  adjustment: string
  refArea: string
  counterpartArea: string
  refSector: string
  counterpartSector: string
  consolidation: string
  accountingEntry: string
  sto: string
  instrument: string
  maturity: string
  expenditure: string
  unitMeasure: string
  currencyDenom: string
  valuation: string
  prices: string
  transformation: string
  customBreakdown: string
  title: string
  period: string
  valueUsd: number
}

/** RFC 4180 line parser, sufficient for BIS SDMX-CSV's quoted titles. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (char === '"') quoted = false
      else current += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      out.push(current)
      current = ''
    } else current += char
  }
  out.push(current)
  return out
}

export function parseDssCsv(csv: string): DssRow[] {
  const lines = csv.split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) throw new Error('[bis-dss] empty SDMX-CSV response')
  const header = splitCsvLine(lines[0])
  const columns = new Map(header.map((name, index) => [name, index]))
  if (REQUIRED_COLUMNS.some((name) => !columns.has(name))) {
    throw new Error('[bis-dss] unexpected SDMX-CSV header — DSD drift, refusing publish')
  }
  const get = (fields: string[], name: (typeof REQUIRED_COLUMNS)[number]) =>
    fields[columns.get(name) ?? -1] ?? ''

  const out: DssRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i])
    const rawValue = get(fields, 'OBS_VALUE')
    const rawMult = get(fields, 'UNIT_MULT')
    if (rawValue === '' || rawMult === '') continue
    const value = Number(rawValue)
    const multiplier = Number(rawMult)
    if (!Number.isFinite(value) || !Number.isInteger(multiplier)) continue
    out.push({
      frequency: get(fields, 'FREQ'),
      adjustment: get(fields, 'ADJUSTMENT'),
      refArea: get(fields, 'REF_AREA'),
      counterpartArea: get(fields, 'COUNTERPART_AREA'),
      refSector: get(fields, 'REF_SECTOR'),
      counterpartSector: get(fields, 'COUNTERPART_SECTOR'),
      consolidation: get(fields, 'CONSOLIDATION'),
      accountingEntry: get(fields, 'ACCOUNTING_ENTRY'),
      sto: get(fields, 'STO'),
      instrument: get(fields, 'INSTR_ASSET'),
      maturity: get(fields, 'MATURITY'),
      expenditure: get(fields, 'EXPENDITURE'),
      unitMeasure: get(fields, 'UNIT_MEASURE'),
      currencyDenom: get(fields, 'CURRENCY_DENOM'),
      valuation: get(fields, 'VALUATION'),
      prices: get(fields, 'PRICES'),
      transformation: get(fields, 'TRANSFORMATION'),
      customBreakdown: get(fields, 'CUST_BREAKDOWN'),
      title: get(fields, 'TITLE'),
      period: get(fields, 'TIME_PERIOD'),
      valueUsd: Math.round(value * 10 ** multiplier),
    })
  }
  return out
}

export function normalizeDssRows(
  rows: readonly DssRow[],
  iso3ByIso2: ReadonlyMap<string, string>,
): DebtMarketRecord[] {
  const out: DebtMarketRecord[] = []
  for (const row of rows) {
    const country = /^[A-Z]{2}$/.test(row.refArea)
      ? iso3ByIso2.get(row.refArea)
      : undefined
    const scope = SCOPES[row.counterpartArea]
    if (!country || !scope || !SECTORS.has(row.refSector as DebtMarketSector)) continue
    if (
      row.frequency !== 'Q' ||
      row.adjustment !== 'N' ||
      row.counterpartSector !== 'S1' ||
      row.consolidation !== 'N' ||
      !['A', 'L'].includes(row.accountingEntry) ||
      !['LE', 'F'].includes(row.sto) ||
      row.instrument !== 'F3' ||
      row.maturity !== 'T' ||
      row.expenditure !== '_Z' ||
      row.unitMeasure !== 'USD' ||
      row.currencyDenom !== '_T' ||
      row.valuation !== 'M' ||
      row.prices !== 'V' ||
      row.transformation !== 'N' ||
      row.customBreakdown !== '_T' ||
      !/^\d{4}-Q[1-4]$/.test(row.period) ||
      !Number.isFinite(row.valueUsd)
    )
      continue
    if (row.sto === 'LE' && row.valueUsd < 0) continue
    out.push({
      country,
      period: row.period as DebtMarketRecord['period'],
      accounting_entry: row.accountingEntry === 'A' ? 'assets' : 'liabilities',
      counterparty_scope: scope,
      sector: row.refSector as DebtMarketSector,
      measure: row.sto === 'LE' ? 'stock' : 'flow',
      value_usd: row.valueUsd,
      valuation: 'market',
      unit_basis: 'current_usd',
      source_id: 'bis_dss',
      effective_date: quarterEndDate(row.period),
      confidence_grade: 'A',
    })
  }
  return out
}

/** HTTP 200 with an empty/drifted side must never erase the committed product. */
export function requireUsableDssCoverage(
  assetRows: readonly unknown[],
  liabilityRows: readonly unknown[],
  records: readonly DebtMarketRecord[],
): void {
  if (assetRows.length === 0)
    throw new Error('[bis-dss] no assets observations; refusing public overwrite')
  if (liabilityRows.length === 0)
    throw new Error('[bis-dss] no liabilities observations; refusing public overwrite')
  if (records.length === 0)
    throw new Error('[bis-dss] no usable direct observations; refusing public overwrite')
}

export interface DssFetchResult {
  records: DebtMarketRecord[]
  rawRows: number
  droppedRows: number
  countries: string[]
  periods: string[]
}

export async function runDss(
  iso3ByIso2: ReadonlyMap<string, string>,
): Promise<DssFetchResult> {
  const failureStart = failures.length
  const [assetBody, liabilityBody] = await Promise.all([
    fetchCached('bis/dss_assets.csv', queryUrl('A')),
    fetchCached('bis/dss_liabilities.csv', queryUrl('L')),
  ])
  assertNoNewFailures('BIS DSS', failureStart)
  if (assetBody === null || liabilityBody === null)
    throw new Error('[bis-dss] required response missing without recorded failure')

  const assetRows = parseDssCsv(assetBody)
  const liabilityRows = parseDssCsv(liabilityBody)
  const records = normalizeDssRows([...assetRows, ...liabilityRows], iso3ByIso2)
  requireUsableDssCoverage(assetRows, liabilityRows, records)

  const signatures = new Set<string>()
  for (const row of records) {
    const signature = [
      row.country,
      row.period,
      row.accounting_entry,
      row.counterparty_scope,
      row.sector,
      row.measure,
    ].join('|')
    if (signatures.has(signature))
      throw new Error(`[bis-dss] duplicate normalized series ${signature}`)
    signatures.add(signature)
  }

  const countries = [...new Set(records.map((row) => row.country))].sort()
  const periods = [...new Set(records.map((row) => row.period))].sort()
  assertMinimumRows('BIS DSS countries', countries.length, 25)
  assertMinimumRows('BIS DSS observations', records.length, 5_000)
  console.log(
    `[bis-dss] ${assetRows.length + liabilityRows.length} rows → ${records.length} direct observations · ` +
      `${countries.length} countries · ${periods.length} quarters`,
  )
  return {
    records,
    rawRows: assetRows.length + liabilityRows.length,
    droppedRows: assetRows.length + liabilityRows.length - records.length,
    countries,
    periods,
  }
}
