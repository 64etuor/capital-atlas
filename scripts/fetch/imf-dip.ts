/** IMF Direct Investment Positions by Counterpart Economy (formerly CDIS). */
import {
  assertMinimumRows,
  assertNoNewFailures,
  failures,
  fetchCached,
  parseSdmxSeries,
  pooled,
  toQuarter,
  writeRawJson,
} from './lib.ts'

const BASE = 'https://api.imf.org/external/sdmx/2.1/data'
const OUTWARD_TOTAL = 'OTWD_D_NETAL_FALL_ALL'

export interface DipObs {
  owner: string
  issuer: string
  period: string
  value: number
}

const key = (row: DipObs) =>
  [row.owner, row.issuer, row.period].join('|')

/**
 * Keep reported outward positions only. SCC mirrors are useful diagnostics but
 * are not direct observations and therefore never enter the grade-A bilateral
 * fact family.
 */
export function parseDip(xml: string): DipObs[] {
  const rows = new Map<string, DipObs>()
  for (const series of parseSdmxSeries(xml)) {
    const owner = series.attrs.COUNTRY
    const issuer = series.attrs.COUNTERPART_COUNTRY
    if (
      owner?.length !== 3 ||
      issuer?.length !== 3 ||
      owner === issuer ||
      series.attrs.DV_TYPE !== 'O' ||
      series.attrs.INDICATOR !== OUTWARD_TOTAL ||
      series.attrs.FREQUENCY !== 'A'
    )
      continue
    for (const observation of series.obs) {
      const period = toQuarter(observation.period)
      if (!period) continue
      const row = { owner, issuer, period, value: observation.value }
      rows.set(key(row), row)
    }
  }
  return [...rows.values()].sort((a, b) => key(a).localeCompare(key(b)))
}

export async function runDip(iso3s: string[]): Promise<DipObs[]> {
  const failureStart = failures.length
  const parsed = await pooled(iso3s, 6, async (iso3) => {
    const dataKey = `${iso3}.O.${OUTWARD_TOTAL}..A`
    const xml = await fetchCached(
      `imf/dip_outward_${iso3}.xml`,
      `${BASE}/IMF.STA,DIP/${dataKey}?startPeriod=2013`,
    )
    return xml === null ? [] : parseDip(xml)
  })
  assertNoNewFailures('IMF DIP', failureStart)
  const rows = parsed.flat()
  assertMinimumRows('IMF DIP', rows.length, 1_000)
  writeRawJson('imf/dip_normalized.json', rows)
  console.log(
    `[imf:dip] ${rows.length} direct outward positions · ` +
      `${new Set(rows.map((row) => row.owner)).size} reporting economies`,
  )
  return rows
}
