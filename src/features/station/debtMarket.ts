import type {
  CountryDebtMarketFile,
  DebtMarketRecord,
  PeriodKey,
} from '../../types/data'

const TOP_LEVEL_SECTORS = new Set(['S11', 'S12', 'S13', 'S1M'])

const exact = (
  rows: readonly DebtMarketRecord[],
  entry: DebtMarketRecord['accounting_entry'],
  scope: DebtMarketRecord['counterparty_scope'],
  measure: DebtMarketRecord['measure'],
  sector = 'S1',
) =>
  rows.find(
    (row) =>
      row.accounting_entry === entry &&
      row.counterparty_scope === scope &&
      row.measure === measure &&
      row.sector === sector,
  )

const topLevel = (
  rows: readonly DebtMarketRecord[],
  entry: DebtMarketRecord['accounting_entry'],
  scope: DebtMarketRecord['counterparty_scope'],
) =>
  rows
    .filter(
      (row) =>
        row.accounting_entry === entry &&
        row.counterparty_scope === scope &&
        row.measure === 'stock' &&
        TOP_LEVEL_SECTORS.has(row.sector),
    )
    .sort((a, b) => b.value_usd - a.value_usd)[0]

export interface DebtMarketSelection {
  status: 'available'
  period: PeriodKey
  issued?: DebtMarketRecord
  net_issuance?: DebtMarketRecord
  nonresident_held?: DebtMarketRecord
  foreign_assets?: DebtMarketRecord
  top_issuer_sector?: DebtMarketRecord
  top_foreign_holder_sector?: DebtMarketRecord
}

export type DebtMarketResult =
  | DebtMarketSelection
  | {
      status: 'unavailable'
      reason:
        | 'no_observation_on_or_before_target'
        | 'no_comparable_headline_on_or_before_target'
    }

/** One common effective quarter; missing series stay missing and are never interpolated. */
export function selectDebtMarket(
  file: CountryDebtMarketFile,
  target: PeriodKey,
): DebtMarketResult {
  const periods = [...new Set(file.records
    .map((row) => row.period)
    .filter((candidate) => candidate <= target))]
    .sort()
    .reverse()
  if (periods.length === 0)
    return {
      status: 'unavailable',
      reason: 'no_observation_on_or_before_target',
    }

  for (const period of periods) {
    const rows = file.records.filter((row) => row.period === period)
    const selection: DebtMarketSelection = {
      status: 'available',
      period,
      issued: exact(rows, 'liabilities', 'world', 'stock'),
      net_issuance: exact(rows, 'liabilities', 'world', 'flow'),
      nonresident_held: exact(rows, 'liabilities', 'nonresident', 'stock'),
      foreign_assets: exact(rows, 'assets', 'nonresident', 'stock'),
      top_issuer_sector: topLevel(rows, 'liabilities', 'world'),
      top_foreign_holder_sector: topLevel(rows, 'assets', 'nonresident'),
    }
    if (
      selection.issued ||
      selection.net_issuance ||
      selection.nonresident_held ||
      selection.foreign_assets ||
      selection.top_issuer_sector ||
      selection.top_foreign_holder_sector
    )
      return selection
  }

  return {
    status: 'unavailable',
    reason: 'no_comparable_headline_on_or_before_target',
  }
}
