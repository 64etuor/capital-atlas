import { describe, expect, it } from 'vitest'
import {
  parseIipcc,
  parsePipExposure,
  requireCompleteResponses,
} from './imf-exposure.ts'

const xml = (...series: string[]) =>
  `<StructureSpecificData><DataSet>${series.join('')}</DataSet></StructureSpecificData>`

const series = (attrs: string, period: string, value: number) =>
  `<Series ${attrs}><Obs TIME_PERIOD="${period}" OBS_VALUE="${value}"/></Series>`

describe('requireCompleteResponses — partial overwrite guard', () => {
  it('fails the refresh when any required official response is missing', () => {
    expect(() => requireCompleteResponses('IIPCC', ['ok', null, 'ok'])).toThrow(
      /IIPCC.*1 of 3 required requests failed/,
    )
  })
})

describe('parseIipcc — direct currency-composition facts', () => {
  it('keeps non-overlapping buckets, exact sectors, and quarterly precedence', () => {
    const rows = parseIipcc(
      xml(
        series(
          'COUNTRY="KOR" BOP_ACCOUNTING_ENTRY="A_P" INDICATOR="DCNRES_DIC" CURRENCY="USD" UNIT="USD" FREQUENCY="A"',
          '2024',
          10,
        ),
        series(
          'COUNTRY="KOR" BOP_ACCOUNTING_ENTRY="A_P" INDICATOR="DCNRES_DIC" CURRENCY="USD" UNIT="USD" FREQUENCY="Q"',
          '2024-Q4',
          11,
        ),
        series(
          'COUNTRY="KOR" BOP_ACCOUNTING_ENTRY="L_P" INDICATOR="DLNRES_DIC_S13" CURRENCY="EUR" UNIT="USD" FREQUENCY="A"',
          '2024',
          7,
        ),
        series(
          'COUNTRY="KOR" BOP_ACCOUNTING_ENTRY="A_P" INDICATOR="DCNRES_DIC" CURRENCY="FC" UNIT="USD" FREQUENCY="A"',
          '2024',
          99,
        ),
      ),
    )

    expect(rows).toEqual([
      expect.objectContaining({
        country: 'KOR',
        period: '2024-Q4',
        entry: 'assets',
        sector: 'S1',
        currency: 'USD',
        value_usd: 11,
        confidence_grade: 'A',
        source_id: 'imf_iipcc',
      }),
      expect.objectContaining({
        entry: 'liabilities',
        sector: 'S13',
        currency: 'EUR',
        value_usd: 7,
      }),
    ])
    expect(rows.some((row) => (row.currency as string) === 'FC')).toBe(false)
  })
})

describe('parsePipExposure — direct sectors vs SCC reconstruction', () => {
  it('maps semiannual sectors to Q2/Q4 and prefers them over annual Q4', () => {
    const parsed = parsePipExposure(
      xml(
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F51_P_USD" SECTOR="S14" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="G001" FREQUENCY="A"',
          '2024',
          20,
        ),
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F51_P_USD" SECTOR="S14" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="G001" FREQUENCY="S"',
          '2024-S2',
          22,
        ),
      ),
    )

    expect(parsed.sectors).toEqual([
      expect.objectContaining({
        country: 'KOR',
        period: '2024-Q4',
        sector: 'S14',
        value_usd: 22,
      }),
    ])
  })

  it('preserves S1V and separates reported official data from SCC derivation', () => {
    const parsed = parsePipExposure(
      xml(
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F51_P_USD" SECTOR="S1V" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="G001" FREQUENCY="A"',
          '2024',
          20,
        ),
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F3_P_USD" SECTOR="S14" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="G001" FREQUENCY="A"',
          '2024',
          8,
        ),
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="L" INDICATOR="P_F3_P_SCC_USD" SECTOR="S1" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="USA" FREQUENCY="A"',
          '2024',
          5,
        ),
      ),
    )

    expect(parsed.sectors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sector: 'S1V', asset: 'listed_equity', value_usd: 20 }),
        expect.objectContaining({ sector: 'S14', asset: 'debt_securities', value_usd: 8 }),
      ]),
    )
    expect(parsed.reconstructed).toEqual([
      expect.objectContaining({
        country: 'KOR',
        owner_country: 'USA',
        asset: 'debt_securities',
        confidence_grade: 'C',
        estimate_method: 'imf_staff_counterparty_derived_liability',
      }),
    ])
    expect(parsed.sectors.some((row) => row.sector === 'S14')).toBe(true)
    expect(parsed.sectors.some((row) => row.sector === 'S1V')).toBe(true)
  })

  it('never promotes SCC rows into direct sector observations', () => {
    const parsed = parsePipExposure(
      xml(
        series(
          'COUNTRY="KOR" ACCOUNTING_ENTRY="A" INDICATOR="P_F3_P_USD" SECTOR="S13" COUNTERPART_SECTOR="S1" COUNTERPART_COUNTRY="G001" FREQUENCY="A" DERIVATION_TYPE="SCC"',
          '2024',
          100,
        ),
      ),
    )
    expect(parsed.sectors).toEqual([])
  })
})
