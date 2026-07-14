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

const latestRows = <T extends { period: PeriodKey }>(
  rows: readonly T[],
  target: PeriodKey,
): T[] => {
  let latest: PeriodKey | null = null
  for (const row of rows) {
    if (row.period > target) continue
    if (latest === null || row.period > latest) latest = row.period
  }
  return latest === null ? [] : rows.filter((row) => row.period === latest)
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
): ExposureSelection {
  const direct = {
    currency: latestRows(file.currency, target),
    sectors: latestRows(file.sectors, target),
  }
  return observedOnly
    ? { ...direct, fxd: [], reconstructed: [] }
    : {
        ...direct,
        fxd: latestRows(file.fxd, target),
        reconstructed: latestRows(file.reconstructed_liabilities, target),
      }
}

export function closureCellsForCountry(
  file: PositionClosureFile,
  iso3: string,
  observedOnly: boolean,
  asset?: 'listed_equity' | 'debt_securities',
): PositionClosureCell[] {
  if (observedOnly) return []
  const cells = Object.entries(file.assets).flatMap(([key, result]) =>
    !result || (asset !== undefined && key !== asset) ? [] : result.cells,
  )
  return cells
    .filter((cell) => cell.owner_country === iso3 || cell.issuer_country === iso3)
    .sort((a, b) => b.value_usd - a.value_usd)
}
