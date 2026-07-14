import { describe, expect, it } from 'vitest'
import type { CurrencyExposureRecord, FxRatesFile } from '../../src/types/data.ts'
import { computeFxd, reconstructLiabilities } from './exposure.ts'

const fact = (
  currency: CurrencyExposureRecord['currency'],
  value_usd: number,
): CurrencyExposureRecord => ({
  country: 'KOR',
  period: '2024-Q4',
  entry: 'assets',
  sector: 'S1',
  currency,
  value_usd,
  source_id: 'imf_iipcc',
  effective_date: '2024-12-31',
  confidence_grade: 'A',
})

const fx: FxRatesFile = {
  base: 'USD',
  countries: {
    KOR: {
      currency: 'KRW',
      quarterly: true,
      rates: {
        '2020-Q4': {
          rate: 1100,
          grade: 'A',
          source_id: 'imf_ifs_fx',
          effective_date: '2020-12-31',
        },
        '2024-Q4': {
          rate: 1400,
          grade: 'A',
          source_id: 'imf_ifs_fx',
          effective_date: '2024-12-31',
        },
      },
    },
  },
  currencies: {
    USD: {
      rates: {
        '2020-Q4': {
          rate: 1,
          grade: 'A',
          source_id: 'imf_ifs_fx',
          effective_date: '2020-12-31',
          observations: 1,
        },
        '2024-Q4': {
          rate: 1,
          grade: 'A',
          source_id: 'imf_ifs_fx',
          effective_date: '2024-12-31',
          observations: 1,
        },
      },
    },
    EUR: {
      rates: {
        '2020-Q4': {
          rate: 0.8,
          grade: 'A',
          source_id: 'imf_ifs_fx',
          effective_date: '2020-12-31',
          observations: 2,
        },
        '2024-Q4': {
          rate: 1,
          grade: 'A',
          source_id: 'imf_ifs_fx',
          effective_date: '2024-12-31',
          observations: 2,
        },
      },
    },
  },
}

describe('computeFxd — coverage-gated constant-FX', () => {
  it('revalues fully identified currency buckets at the explicit base period', () => {
    const [result] = computeFxd(
      [fact('TOTAL', 100), fact('USD', 40), fact('EUR', 60)],
      fx,
      '2020-Q4',
    )
    expect(result).toMatchObject({
      status: 'available',
      value_usd: 115,
      coverage_share: 1,
      residual_share: 0,
      confidence_grade: 'C',
      lower_bound: 115,
      upper_bound: 115,
    })
  })

  it('uses a disclosed no-change point and factor sensitivity bounds for ≤5% residual', () => {
    const [result] = computeFxd(
      [fact('TOTAL', 100), fact('USD', 46), fact('EUR', 50), fact('OTHC', 4)],
      fx,
      '2020-Q4',
    )
    expect(result).toMatchObject({
      status: 'available',
      value_usd: 112.5,
      coverage_share: 0.96,
      residual_share: 0.04,
      confidence_grade: 'D',
      lower_bound: 112.5,
      upper_bound: 113.5,
    })
  })

  it('emits an explicit unavailable reason instead of a number above the residual gate', () => {
    const [result] = computeFxd(
      [fact('TOTAL', 100), fact('USD', 90), fact('OTHC', 10)],
      fx,
      '2020-Q4',
    )
    expect(result).toMatchObject({
      status: 'unavailable',
      coverage_share: 0.9,
    })
    expect(result).toHaveProperty('reason')
    expect(result).not.toHaveProperty('value_usd')
  })

  it('rejects a composition that does not reconcile to its reported total', () => {
    const [result] = computeFxd(
      [fact('TOTAL', 100), fact('USD', 80), fact('EUR', 10)],
      fx,
      '2020-Q4',
    )
    expect(result).toMatchObject({ status: 'unavailable' })
    expect(result).not.toHaveProperty('value_usd')
  })
})

describe('reconstructLiabilities — counterpart-derived range', () => {
  it('uses the bottom-up SCC sum and top-down IIP margin as an explicit interval', () => {
    const rows = reconstructLiabilities(
      [
        {
          country: 'KOR',
          owner_country: 'USA',
          period: '2024-Q4',
          asset: 'debt_securities',
          value_usd: 50,
          source_id: 'imf_pip',
          effective_date: '2024-12-31',
          confidence_grade: 'C',
          estimate_method: 'imf_staff_counterparty_derived_liability',
        },
        {
          country: 'KOR',
          owner_country: 'JPN',
          period: '2024-Q4',
          asset: 'debt_securities',
          value_usd: 20,
          source_id: 'imf_pip',
          effective_date: '2024-12-31',
          confidence_grade: 'C',
          estimate_method: 'imf_staff_counterparty_derived_liability',
        },
      ],
      [
        {
          iso3: 'KOR',
          entry: 'L_P',
          indicator: 'P_F3_MV',
          quarter: '2024-Q4',
          value: 100,
        },
      ],
    )
    expect(rows).toEqual([
      expect.objectContaining({
        country: 'KOR',
        value_usd: 70,
        lower_bound: 70,
        upper_bound: 100,
        coverage_share: 0.7,
        confidence_grade: 'C',
      }),
    ])
  })

  it('does not publish a nonpositive aggregate as a liability observation', () => {
    const rows = reconstructLiabilities(
      [
        {
          country: 'CRI',
          owner_country: 'USA',
          period: '2024-Q4',
          asset: 'listed_equity',
          value_usd: -1,
          source_id: 'imf_pip',
          effective_date: '2024-12-31',
          confidence_grade: 'C',
          estimate_method: 'imf_staff_counterparty_derived_liability',
        },
      ],
      [
        {
          iso3: 'CRI',
          entry: 'L_P',
          indicator: 'P_F5_MV',
          quarter: '2024-Q4',
          value: 100,
        },
      ],
    )
    expect(rows).toEqual([])
  })
})
