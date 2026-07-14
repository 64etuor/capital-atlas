/** IMF IIPCC/PIP v3 dimensions: direct currency and sector facts stay separate
 * from SCC counterpart-derived liabilities. */
import type {
  CurrencyBucket,
  CurrencyExposureRecord,
  IipccSector,
  PipSector,
  SectorPositionRecord,
} from '../../src/types/data.ts'
import {
  chunk,
  fetchCached,
  parseSdmxSeries,
  pooled,
  quarterEndDate,
  toQuarter,
  writeRawJson,
} from './lib.ts'

const BASE = 'https://api.imf.org/external/sdmx/2.1/data'

const CURRENCIES = new Set<CurrencyBucket>([
  'USD',
  'EUR',
  'JPY',
  'XDC',
  'OTHC',
  'UALLC',
])

const IIPCC_INDICATORS: Record<
  string,
  { entry: 'assets' | 'liabilities'; sector: IipccSector }
> = {
  DCNRES_DIC: { entry: 'assets', sector: 'S1' },
  DLNRES_DIC: { entry: 'liabilities', sector: 'S1' },
  DCNRES_DIC_S121: { entry: 'assets', sector: 'S121' },
  DCNRES_DIC_S122: { entry: 'assets', sector: 'S122' },
  DCNRES_DIC_S12R: { entry: 'assets', sector: 'S12R' },
  DCNRES_DIC_S13: { entry: 'assets', sector: 'S13' },
  DCNRES_DIC_S1Z: { entry: 'assets', sector: 'S1Z' },
  DCNRES_DIC_S1ZOTH: { entry: 'assets', sector: 'S1ZOTH' },
  DLNRES_DIC_S121: { entry: 'liabilities', sector: 'S121' },
  DLNRES_DIC_S122: { entry: 'liabilities', sector: 'S122' },
  DLNRES_DIC_S12R: { entry: 'liabilities', sector: 'S12R' },
  DLNRES_DIC_S13: { entry: 'liabilities', sector: 'S13' },
  DLNRES_DIC_S1Z: { entry: 'liabilities', sector: 'S1Z' },
  DLNRES_DIC_S1ZOTH: { entry: 'liabilities', sector: 'S1ZOTH' },
}

const PIP_SECTORS = new Set<PipSector>([
  'S1',
  'S11',
  'S121',
  'S122',
  'S123',
  'S12P',
  'S12QU',
  'S12R',
  'S13',
  'S14',
  'S15',
  'S1V',
])

const PIP_DIRECT_ASSETS = {
  P_F51_P_USD: 'listed_equity',
  P_F3_P_USD: 'debt_securities',
} as const

const PIP_SCC_ASSETS = {
  P_F51_P_SCC_USD: 'listed_equity',
  P_F3_P_SCC_USD: 'debt_securities',
} as const

const rowKey = (row: CurrencyExposureRecord) =>
  [row.country, row.period, row.entry, row.sector, row.currency].join('|')

/** Annual and quarterly observations can share Q4; the higher-frequency fact wins. */
export function parseIipcc(xml: string): CurrencyExposureRecord[] {
  const rows = new Map<string, { row: CurrencyExposureRecord; priority: number }>()
  for (const series of parseSdmxSeries(xml)) {
    const mapping = IIPCC_INDICATORS[series.attrs.INDICATOR]
    const currency = series.attrs.CURRENCY as CurrencyBucket
    const expectedEntry = mapping?.entry === 'assets' ? 'A_P' : 'L_P'
    if (
      !mapping ||
      !CURRENCIES.has(currency) ||
      series.attrs.BOP_ACCOUNTING_ENTRY !== expectedEntry
    )
      continue
    const priority = series.attrs.FREQUENCY === 'Q' ? 2 : 1
    for (const obs of series.obs) {
      const period = toQuarter(obs.period)
      if (!period) continue
      const row: CurrencyExposureRecord = {
        country: series.attrs.COUNTRY,
        period: period as CurrencyExposureRecord['period'],
        entry: mapping.entry,
        sector: mapping.sector,
        currency,
        value_usd: obs.value,
        source_id: 'imf_iipcc',
        effective_date: quarterEndDate(period),
        confidence_grade: 'A',
      }
      const key = rowKey(row)
      if ((rows.get(key)?.priority ?? 0) < priority) rows.set(key, { row, priority })
    }
  }
  return [...rows.values()]
    .map(({ row }) => row)
    .sort((a, b) => rowKey(a).localeCompare(rowKey(b)))
}

export interface PipReconstructedObservation {
  country: string
  owner_country: string
  period: CurrencyExposureRecord['period']
  asset: 'listed_equity' | 'debt_securities'
  value_usd: number
  source_id: 'imf_pip'
  effective_date: string
  confidence_grade: 'C'
  estimate_method: 'imf_staff_counterparty_derived_liability'
}

export interface PipExposureParseResult {
  sectors: SectorPositionRecord[]
  reconstructed: PipReconstructedObservation[]
}

export function parsePipExposure(xml: string): PipExposureParseResult {
  const sectors: SectorPositionRecord[] = []
  const reconstructed: PipReconstructedObservation[] = []
  for (const series of parseSdmxSeries(xml)) {
    const derivation = series.attrs.DERIVATION_TYPE ?? series.attrs.DV_TYPE
    const periodRows = series.obs
      .map((obs) => ({ obs, period: toQuarter(obs.period) }))
      .filter((row): row is { obs: (typeof series.obs)[number]; period: string } =>
        Boolean(row.period),
      )

    const directAsset =
      PIP_DIRECT_ASSETS[series.attrs.INDICATOR as keyof typeof PIP_DIRECT_ASSETS]
    const sector = series.attrs.SECTOR as PipSector
    if (
      series.attrs.ACCOUNTING_ENTRY === 'A' &&
      (derivation === undefined || derivation === 'O') &&
      directAsset &&
      PIP_SECTORS.has(sector) &&
      series.attrs.COUNTERPART_SECTOR === 'S1' &&
      series.attrs.COUNTERPART_COUNTRY === 'G001'
    ) {
      for (const { obs, period } of periodRows) {
        sectors.push({
          country: series.attrs.COUNTRY,
          period: period as SectorPositionRecord['period'],
          sector,
          asset: directAsset,
          value_usd: obs.value,
          source_id: 'imf_pip',
          effective_date: quarterEndDate(period),
          confidence_grade: 'A',
        })
      }
    }

    const reconstructedAsset =
      PIP_SCC_ASSETS[series.attrs.INDICATOR as keyof typeof PIP_SCC_ASSETS]
    const owner = series.attrs.COUNTERPART_COUNTRY
    if (
      series.attrs.ACCOUNTING_ENTRY === 'L' &&
      (derivation === undefined || derivation === 'SCC') &&
      reconstructedAsset &&
      owner?.length === 3 &&
      owner !== 'G001'
    ) {
      for (const { obs, period } of periodRows) {
        reconstructed.push({
          country: series.attrs.COUNTRY,
          owner_country: owner,
          period: period as CurrencyExposureRecord['period'],
          asset: reconstructedAsset,
          value_usd: obs.value,
          source_id: 'imf_pip',
          effective_date: quarterEndDate(period),
          confidence_grade: 'C',
          estimate_method: 'imf_staff_counterparty_derived_liability',
        })
      }
    }
  }
  const key = (row: { country: string; period: string; asset: string }) =>
    [row.country, row.period, row.asset].join('|')
  sectors.sort((a, b) => `${key(a)}|${a.sector}`.localeCompare(`${key(b)}|${b.sector}`))
  reconstructed.sort((a, b) =>
    `${key(a)}|${a.owner_country}`.localeCompare(`${key(b)}|${b.owner_country}`),
  )
  return { sectors, reconstructed }
}

export async function runIipcc(iso3s: string[]): Promise<CurrencyExposureRecord[]> {
  const indicators = Object.keys(IIPCC_INDICATORS).join('+')
  const currencies = [...CURRENCIES].join('+')
  const requests = chunk(iso3s, 12).flatMap((countries, index) =>
    (['A', 'Q'] as const).map((frequency) => ({ countries, index, frequency })),
  )
  const bodies = await pooled(requests, 5, async ({ countries, index, frequency }) => {
    const key = `${countries.join('+')}.A_P+L_P.${indicators}.${currencies}.USD.${frequency}`
    return fetchCached(
      `imf/iipcc_${frequency}_chunk${index}.xml`,
      `${BASE}/IMF.STA,IIPCC/${key}?startPeriod=2010`,
    )
  })
  const rows = parseIipcc(bodies.filter((body): body is string => body !== null).join('\n'))
  writeRawJson('imf/iipcc_normalized.json', rows)
  console.log(`[imf:iipcc] ${rows.length} direct currency facts`)
  return rows
}

export async function runPipExposure(
  iso3s: string[],
): Promise<PipExposureParseResult> {
  const parsed = await pooled(iso3s, 6, async (iso3) => {
    const directKey = `${iso3}.A.P_F51_P_USD+P_F3_P_USD..S1.G001.A`
    const derivedKey = `${iso3}.L.P_F51_P_SCC_USD+P_F3_P_SCC_USD.S1.S1..A`
    const [direct, derived] = await Promise.all([
      fetchCached(
        `imf/pip_sector_${iso3}.xml`,
        `${BASE}/IMF.STA,PIP/${directKey}?startPeriod=2013`,
      ),
      fetchCached(
        `imf/pip_scc_${iso3}.xml`,
        `${BASE}/IMF.STA,PIP/${derivedKey}?startPeriod=2013`,
      ),
    ])
    return parsePipExposure([direct, derived].filter(Boolean).join('\n'))
  })
  const result = {
    sectors: parsed.flatMap((row) => row.sectors),
    reconstructed: parsed.flatMap((row) => row.reconstructed),
  }
  writeRawJson('imf/pip_sector_normalized.json', result.sectors)
  writeRawJson('imf/pip_scc_normalized.json', result.reconstructed)
  console.log(
    `[imf:pip-exposure] ${result.sectors.length} direct sector facts · ` +
      `${result.reconstructed.length} SCC-derived bilateral liabilities`,
  )
  return result
}
