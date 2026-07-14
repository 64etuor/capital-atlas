import { describe, expect, it } from 'vitest'
import { parsePip } from './imf.ts'

const xml = (...series: string[]) =>
  `<StructureSpecificData><DataSet>${series.join('')}</DataSet></StructureSpecificData>`

const series = (
  attrs: string,
  observations: Array<[period: string, value: number]>,
) =>
  `<Series ${attrs}>${observations
    .map(
      ([period, value]) =>
        `<Obs TIME_PERIOD="${period}" OBS_VALUE="${value}"/>`,
    )
    .join('')}</Series>`

describe('parsePip — annual and semiannual bilateral positions', () => {
  it('maps semesters to Q2/Q4 and lets higher-frequency Q4 observations win', () => {
    const rows = parsePip(
      xml(
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F51_P_USD" SECTOR="S1" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="USA" FREQUENCY="A"',
          [['2024', 10]],
        ),
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F51_P_USD" SECTOR="S1" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="USA" FREQUENCY="S"',
          [
            ['2024-S1', 11],
            ['2024-S2', 12],
          ],
        ),
      ),
    )

    expect(rows).toEqual([
      {
        owner: 'KOR',
        issuer: 'USA',
        indicator: 'P_F51_P_USD',
        period: '2024-Q2',
        frequency: 'S',
        value: 11,
      },
      {
        owner: 'KOR',
        issuer: 'USA',
        indicator: 'P_F51_P_USD',
        period: '2024-Q4',
        frequency: 'S',
        value: 12,
      },
    ])
  })

  it('rejects aggregates, self-pairs, unsupported frequencies, and non-position slices', () => {
    const rows = parsePip(
      xml(
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F3_P_USD" SECTOR="S1" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="G001" FREQUENCY="S"',
          [['2025-S1', 99]],
        ),
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F3_P_USD" SECTOR="S1" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="KOR" FREQUENCY="S"',
          [['2025-S1', 99]],
        ),
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="L" INDICATOR="P_F3_P_USD" SECTOR="S1" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="USA" FREQUENCY="S"',
          [['2025-S1', 99]],
        ),
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F3_P_USD" SECTOR="S1" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="USA" FREQUENCY="M"',
          [['2025-06', 99]],
        ),
      ),
    )

    expect(rows).toEqual([])
  })
})
