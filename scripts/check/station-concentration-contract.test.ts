import { describe, expect, it } from 'vitest'
import {
  stationConcentrationFileSchema,
  validateStationConcentration,
} from './station-concentration-contract.ts'

const expected = new Map([
  [
    '2024-Q4|listed_equity',
    {
      gross_usd: 100,
      grade: 'A' as const,
      position_bases: ['asset_liability' as const],
    },
  ],
])

const valid = {
  series: {
    listed_equity: [
      {
        period: '2024-Q4',
        stock: 200,
        grade: 'D',
        stock_lower: 150,
        stock_upper: 250,
        source_id: 'model_regional_median',
      },
    ],
  },
  concentration: {
    counterparty: [
      {
        period: '2024-Q4',
        scope: 'listed_equity',
        gross_usd: 100,
        grade: 'A',
        position_bases: ['asset_liability'],
        allocation_coverage: {
          status: 'available',
          allocated_usd: 100,
          owner_stock_usd: 200,
          share: 0.5,
          confidence_grade: 'D',
          denominator_source_ids: ['model_regional_median'],
          lower_bound: 100 / 250,
          upper_bound: 100 / 150,
          range_label: 'owner-stock denominator sensitivity',
        },
      },
    ],
  },
}

describe('station concentration publication contract', () => {
  it('accepts exact-period allocation with numerator/denominator worst grade', () => {
    const file = stationConcentrationFileSchema.parse(valid)
    expect(validateStationConcentration(file, expected)).toEqual([])
  })

  it('rejects stale denominators, missing bases, and an inflated grade', () => {
    const file = stationConcentrationFileSchema.parse({
      ...valid,
      concentration: {
        counterparty: [
          {
            ...valid.concentration.counterparty[0],
            position_bases: [],
            allocation_coverage: {
              ...valid.concentration.counterparty[0].allocation_coverage,
              owner_stock_usd: 999,
              confidence_grade: 'A',
            },
          },
        ],
      },
    })
    expect(validateStationConcentration(file, expected)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/position bases/),
        expect.stringMatching(/owner-stock denominator/),
        expect.stringMatching(/confidence grade/),
      ]),
    )
  })
})
