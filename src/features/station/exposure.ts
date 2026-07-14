import type {
  CountryExposureFile,
  CurrencyExposureRecord,
  FxdResult,
  PeriodKey,
  PositionClosureCell,
  PositionClosureFile,
  ReconstructedLiability,
  SectorPositionRecord,
} from '../../types/data'

const latestRowsBy = <T extends { period: PeriodKey }>(
  rows: readonly T[],
  target: PeriodKey,
  group: (row: T) => string,
): T[] => {
  const latest = new Map<string, PeriodKey>()
  for (const row of rows) {
    if (row.period > target) continue
    const key = group(row)
    const current = latest.get(key)
    if (current === undefined || row.period > current) latest.set(key, row.period)
  }
  return rows.filter((row) => row.period === latest.get(group(row)))
}

export interface ExposureSelection {
  currency: CurrencyExposureRecord[]
  sectors: SectorPositionRecord[]
  fxd: FxdResult[]
  reconstructed: ReconstructedLiability[]
}

/** Select each independently-vintaged family without interpolating or summing sector levels. */
export function exposureAt(
  file: CountryExposureFile,
  target: PeriodKey,
  observedOnly: boolean,
  asset?: 'listed_equity' | 'debt_securities',
): ExposureSelection {
  const sectors = asset
    ? file.sectors.filter((row) => row.asset === asset)
    : file.sectors
  const reconstructed = asset
    ? file.reconstructed_liabilities.filter((row) => row.asset === asset)
    : file.reconstructed_liabilities
  const direct = {
    currency: latestRowsBy(
      file.currency,
      target,
      (row) => `${row.entry}|${row.sector}`,
    ),
    sectors: latestRowsBy(sectors, target, (row) => row.asset),
  }
  return observedOnly
    ? { ...direct, fxd: [], reconstructed: [] }
    : {
        ...direct,
        fxd: latestRowsBy(file.fxd, target, (row) => row.entry),
        reconstructed: latestRowsBy(reconstructed, target, (row) => row.asset),
      }
}

export interface ClosurePublication {
  cells: PositionClosureCell[]
  total_cells: number
  published_cells: number
  omitted_cells: number
  omitted_value_usd: number
}

export function closurePublicationForCountry(
  file: PositionClosureFile,
  iso3: string,
  observedOnly: boolean,
  asset?: 'listed_equity' | 'debt_securities',
): ClosurePublication {
  if (observedOnly)
    return {
      cells: [],
      total_cells: 0,
      published_cells: 0,
      omitted_cells: 0,
      omitted_value_usd: 0,
    }
  const results = Object.entries(file.assets).flatMap(([key, result]) =>
    !result || (asset !== undefined && key !== asset) ? [] : [result],
  )
  const published = results.flatMap((result) => result.cells)
  const cells = published
    .filter((cell) => cell.owner_country === iso3 || cell.issuer_country === iso3)
    .sort((a, b) => b.value_usd - a.value_usd)
  return {
    cells,
    total_cells: results.reduce((sum, result) => sum + result.total_cells, 0),
    published_cells: published.length,
    omitted_cells: results.reduce((sum, result) => sum + result.omitted_cells, 0),
    omitted_value_usd: results.reduce(
      (sum, result) => sum + result.omitted_value_usd,
      0,
    ),
  }
}
