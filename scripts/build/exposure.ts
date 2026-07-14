/** Build deterministic country exposure files from normalized official facts. */
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CountryExposureFile,
  CurrencyBucket,
  CurrencyExposureRecord,
  FxRateEntry,
  FxRatesFile,
  FxdResult,
  PeriodKey,
  SectorPositionRecord,
} from '../../src/types/data.ts'
import { OUT_DIR, readRawJson, writeJson } from '../fetch/lib.ts'

export const FXD_BASE_PERIOD = '2020-Q4' as PeriodKey
const GAP_LIMIT = 0.005
const RESIDUAL_LIMIT = 0.05

const groupKey = (row: CurrencyExposureRecord) =>
  [row.country, row.period, row.entry].join('|')

function rateFor(
  bucket: CurrencyBucket,
  country: string,
  period: PeriodKey,
  fx: FxRatesFile,
): FxRateEntry | undefined {
  if (bucket === 'XDC') return fx.countries[country]?.rates[period]
  if (bucket === 'USD' || bucket === 'EUR' || bucket === 'JPY')
    return fx.currencies[bucket]?.rates[period]
  return undefined
}

const unavailable = (
  sample: CurrencyExposureRecord,
  basePeriod: PeriodKey,
  coverageShare: number,
  reason: string,
): FxdResult => ({
  status: 'unavailable',
  period: sample.period,
  base_period: basePeriod,
  entry: sample.entry,
  coverage_share: coverageShare,
  source_ids: ['imf_iipcc', 'imf_ifs_fx'],
  reason,
})

/** Aggregate total-debt FXD; sector-specific facts remain observations only. */
export function computeFxd(
  facts: readonly CurrencyExposureRecord[],
  fx: FxRatesFile,
  basePeriod: PeriodKey = FXD_BASE_PERIOD,
): FxdResult[] {
  const groups = new Map<string, CurrencyExposureRecord[]>()
  for (const row of facts) {
    if (row.sector !== 'S1') continue
    const rows = groups.get(groupKey(row)) ?? []
    rows.push(row)
    groups.set(groupKey(row), rows)
  }

  const results: FxdResult[] = []
  for (const rows of groups.values()) {
    const sample = rows[0]
    const byCurrency = new Map(rows.map((row) => [row.currency, row.value_usd]))
    const total = byCurrency.get('TOTAL')
    const components = (['USD', 'EUR', 'JPY', 'XDC', 'OTHC', 'UALLC'] as const)
      .map((currency) => [currency, byCurrency.get(currency) ?? 0] as const)
    const componentTotal = components.reduce((sum, [, value]) => sum + value, 0)
    const knownTotal = components
      .filter(([currency]) => currency !== 'OTHC' && currency !== 'UALLC')
      .reduce((sum, [, value]) => sum + value, 0)
    const denominator = Math.abs(total ?? componentTotal)
    const coverageShare = denominator > 0 ? Math.min(Math.abs(knownTotal) / denominator, 1) : 0
    if (total === undefined || total === 0) {
      results.push(unavailable(sample, basePeriod, coverageShare, 'reported all-currencies total is missing or zero'))
      continue
    }
    const gap = Math.abs(componentTotal - total) / Math.abs(total)
    if (gap > GAP_LIMIT) {
      results.push(
        unavailable(
          sample,
          basePeriod,
          coverageShare,
          `currency components differ from reported total by ${(gap * 100).toFixed(2)}% (>0.5%)`,
        ),
      )
      continue
    }
    const residual = (byCurrency.get('OTHC') ?? 0) + (byCurrency.get('UALLC') ?? 0)
    const residualShare = Math.abs(residual) / Math.abs(total)
    if (residualShare > RESIDUAL_LIMIT) {
      results.push(
        unavailable(
          sample,
          basePeriod,
          coverageShare,
          `other and unallocated currencies are ${(residualShare * 100).toFixed(2)}% (>5%)`,
        ),
      )
      continue
    }

    let knownFxd = 0
    const factors: number[] = []
    let missing: CurrencyBucket | null = null
    for (const [currency, value] of components) {
      if (currency === 'OTHC' || currency === 'UALLC' || value === 0) continue
      const current = rateFor(currency, sample.country, sample.period, fx)
      const base = rateFor(currency, sample.country, basePeriod, fx)
      if (!current || !base || current.rate <= 0 || base.rate <= 0) {
        missing = currency
        break
      }
      const factor = current.rate / base.rate
      factors.push(factor)
      knownFxd += value * factor
    }
    if (missing) {
      results.push(
        unavailable(
          sample,
          basePeriod,
          coverageShare,
          `${missing} exchange rate missing at ${basePeriod} or ${sample.period}`,
        ),
      )
      continue
    }

    const point = knownFxd + residual
    const minFactor = Math.min(1, ...factors)
    const maxFactor = Math.max(1, ...factors)
    const lower = knownFxd + residual * minFactor
    const upper = knownFxd + residual * maxFactor
    results.push({
      status: 'available',
      period: sample.period,
      base_period: basePeriod,
      entry: sample.entry,
      value_usd: point,
      coverage_share: coverageShare,
      residual_share: residualShare,
      source_id: 'model_constant_fx',
      effective_date: sample.effective_date,
      confidence_grade: residualShare === 0 ? 'C' : 'D',
      estimate_method:
        residualShare === 0
          ? 'currency_bucket_constant_fx_exact_components'
          : 'currency_bucket_constant_fx_with_bounded_residual',
      lower_bound: Math.min(lower, upper),
      upper_bound: Math.max(lower, upper),
    })
  }
  return results.sort((a, b) =>
    `${a.period}|${a.entry}`.localeCompare(`${b.period}|${b.entry}`),
  )
}

export function buildExposure(): { countries: number; periods: number; fxdAvailable: number } {
  const currency = readRawJson<CurrencyExposureRecord[]>('imf/iipcc_normalized.json')
  const sectors = readRawJson<SectorPositionRecord[]>('imf/pip_sector_normalized.json')
  if (!currency || !sectors)
    throw new Error('[exposure] normalized IIPCC/PIP inputs missing — run pnpm data:fetch')
  const fx = JSON.parse(
    readFileSync(join(OUT_DIR, 'meta', 'fx_rates.json'), 'utf8'),
  ) as FxRatesFile
  const byCountry = new Map<string, { currency: CurrencyExposureRecord[]; sectors: SectorPositionRecord[] }>()
  for (const row of currency) {
    const value = byCountry.get(row.country) ?? { currency: [], sectors: [] }
    value.currency.push(row)
    byCountry.set(row.country, value)
  }
  for (const row of sectors) {
    const value = byCountry.get(row.country) ?? { currency: [], sectors: [] }
    value.sectors.push(row)
    byCountry.set(row.country, value)
  }

  rmSync(join(OUT_DIR, 'exposure'), { recursive: true, force: true })
  const periods = new Set<PeriodKey>()
  let fxdAvailable = 0
  for (const [country, rows] of [...byCountry].sort(([a], [b]) => a.localeCompare(b))) {
    rows.currency.sort((a, b) => groupKey(a).localeCompare(groupKey(b)) || a.currency.localeCompare(b.currency))
    rows.sectors.sort((a, b) =>
      `${a.period}|${a.asset}|${a.sector}`.localeCompare(`${b.period}|${b.asset}|${b.sector}`),
    )
    for (const row of [...rows.currency, ...rows.sectors]) periods.add(row.period)
    const fxd = computeFxd(rows.currency, fx)
    fxdAvailable += fxd.filter((row) => row.status === 'available').length
    const file: CountryExposureFile = {
      country,
      currency: rows.currency,
      sectors: rows.sectors,
      fxd,
      reconstructed_liabilities: [],
    }
    writeJson(`exposure/${country}.json`, file)
  }
  writeJson('exposure/index.json', {
    countries: [...byCountry.keys()].sort(),
    periods: [...periods].sort(),
    base_period: FXD_BASE_PERIOD,
  })
  return { countries: byCountry.size, periods: periods.size, fxdAvailable }
}

if (process.argv[1]?.endsWith('exposure.ts')) {
  const result = buildExposure()
  console.log(
    `[exposure] ${result.countries} countries · ${result.periods} periods · ` +
      `${result.fxdAvailable} FXD series available`,
  )
}
