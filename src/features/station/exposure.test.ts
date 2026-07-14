import { describe, expect, it } from 'vitest'
import type {
  CountryExposureFile,
  PositionClosureFile,
} from '../../types/data'
import { closurePublicationForCountry, exposureAt } from './exposure'

const exposure: CountryExposureFile = {
  country: 'KOR',
  currency: [
    {
      country: 'KOR',
      period: '2024-Q2',
      entry: 'assets',
      sector: 'S1',
      currency: 'TOTAL',
      value_usd: 100,
      source_id: 'imf_iipcc',
      effective_date: '2024-06-30',
      confidence_grade: 'A',
    },
  ],
  sectors: [
    {
      country: 'KOR',
      period: '2023-Q4',
      sector: 'S1',
      asset: 'listed_equity',
      value_usd: 100,
      source_id: 'imf_pip',
      effective_date: '2023-12-31',
      confidence_grade: 'A',
    },
    {
      country: 'KOR',
      period: '2021-Q4',
      sector: 'S13',
      asset: 'debt_securities',
      value_usd: 30,
      source_id: 'imf_pip',
      effective_date: '2021-12-31',
      confidence_grade: 'A',
    },
    {
      country: 'KOR',
      period: '2023-Q4',
      sector: 'S1V',
      asset: 'listed_equity',
      value_usd: 40,
      source_id: 'imf_pip',
      effective_date: '2023-12-31',
      confidence_grade: 'A',
    },
  ],
  fxd: [
    {
      status: 'unavailable',
      period: '2024-Q2',
      base_period: '2020-Q4',
      entry: 'assets',
      coverage_share: 0.9,
      source_ids: ['imf_iipcc', 'imf_ifs_fx'],
      reason: 'unallocated currencies exceed the gate',
    },
  ],
  reconstructed_liabilities: [
    {
      country: 'KOR',
      period: '2023-Q4',
      asset: 'listed_equity',
      value_usd: 70,
      source_id: 'imf_pip',
      source_ids: ['imf_pip', 'imf_iip'],
      effective_date: '2023-12-31',
      confidence_grade: 'C',
      estimate_method: 'counterparty_assets_transposed_to_reconstructed_liability',
      lower_bound: 70,
      upper_bound: 100,
      coverage_share: 0.7,
    },
    {
      country: 'KOR',
      period: '2020-Q4',
      asset: 'debt_securities',
      value_usd: 20,
      source_id: 'imf_pip',
      source_ids: ['imf_pip', 'imf_iip'],
      effective_date: '2020-12-31',
      confidence_grade: 'C',
      estimate_method: 'counterparty_assets_transposed_to_reconstructed_liability',
      lower_bound: 20,
      upper_bound: 50,
      coverage_share: 0.4,
    },
  ],
}

describe('exposureAt — no implied precision across exposure families', () => {
  it('floors each family independently and preserves exact sector rows without summing hierarchy', () => {
    const selected = exposureAt(exposure, '2024-Q3', false)
    expect(selected.currency.map((row) => row.period)).toEqual(['2024-Q2'])
    expect(selected.sectors.map((row) => [row.sector, row.value_usd])).toEqual([
      ['S1', 100],
      ['S13', 30],
      ['S1V', 40],
    ])
    expect(selected.fxd[0]).toMatchObject({ status: 'unavailable' })
    expect(selected.reconstructed).toHaveLength(2)
  })

  it('floors each asset independently before applying an asset filter', () => {
    const selected = exposureAt(exposure, '2024-Q3', false, 'debt_securities')
    expect(selected.sectors.map((row) => [row.period, row.asset])).toEqual([
      ['2021-Q4', 'debt_securities'],
    ])
    expect(selected.reconstructed.map((row) => [row.period, row.asset])).toEqual([
      ['2020-Q4', 'debt_securities'],
    ])
  })

  it('removes every derived family in observed-only mode while retaining direct A observations', () => {
    const selected = exposureAt(exposure, '2024-Q3', true)
    expect(selected.currency).toHaveLength(1)
    expect(selected.sectors).toHaveLength(3)
    expect(selected.fxd).toEqual([])
    expect(selected.reconstructed).toEqual([])
  })
})

describe('closurePublicationForCountry — grade-E visibility gate', () => {
  const file: PositionClosureFile = {
    period: '2024-Q4',
    method: 'biproportional_ras_position_closure',
    assets: {
      listed_equity: {
        cells: [
          {
            owner_country: 'KOR',
            issuer_country: 'USA',
            asset: 'listed_equity',
            period: '2024-Q4',
            value_usd: 50,
            lower_bound: 0,
            upper_bound: 80,
            confidence_grade: 'E',
            estimate_method: 'biproportional_ras_position_closure',
            coverage_share: 0.6,
            effective_date: '2024-12-31',
            source_ids: ['imf_pip', 'imf_iip'],
          },
        ],
        row_margins: { KOR: 50 },
        column_margins: { USA: 50 },
        iterations: 4,
        residual: 1e-10,
        converged: true,
        direct_seed_share: 0.6,
        total_cells: 1,
        omitted_cells: 0,
        omitted_value_usd: 0,
      },
    },
  }

  it('returns modeled corridors only when estimates are enabled', () => {
    expect(closurePublicationForCountry(file, 'KOR', false).cells).toHaveLength(1)
    expect(closurePublicationForCountry(file, 'KOR', true).cells).toEqual([])
  })

  it('discloses an omitted matrix tail even when this country has no published cell', () => {
    const result = file.assets.listed_equity!
    result.total_cells = 1010
    result.omitted_cells = 1009
    result.omitted_value_usd = 25

    expect(closurePublicationForCountry(file, 'JPN', false)).toEqual({
      cells: [],
      total_cells: 1010,
      published_cells: 1,
      omitted_cells: 1009,
      omitted_value_usd: 25,
    })
  })
})
