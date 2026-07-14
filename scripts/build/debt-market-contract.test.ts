import { describe, expect, it } from 'vitest'
import {
  countryDebtMarketFileSchema,
  debtMarketRecordSchema,
} from './debt-market-contract.ts'

const valid = {
  country: 'KOR',
  period: '2025-Q4',
  accounting_entry: 'liabilities',
  counterparty_scope: 'world',
  sector: 'S1',
  measure: 'stock',
  value_usd: 2_500_000_000,
  valuation: 'market',
  unit_basis: 'current_usd',
  source_id: 'bis_dss',
  effective_date: '2025-12-31',
  confidence_grade: 'A',
} as const

describe('debt-market static contract', () => {
  it('accepts a direct market-value observation with complete basis fields', () => {
    expect(debtMarketRecordSchema.safeParse(valid).success).toBe(true)
    expect(
      countryDebtMarketFileSchema.safeParse({ country: 'KOR', records: [valid] })
        .success,
    ).toBe(true)
  })

  it('rejects negative stocks but allows signed official transactions', () => {
    expect(
      debtMarketRecordSchema.safeParse({ ...valid, value_usd: -1 }).success,
    ).toBe(false)
    expect(
      debtMarketRecordSchema.safeParse({
        ...valid,
        measure: 'flow',
        value_usd: -1,
      }).success,
    ).toBe(true)
  })

  it('rejects unsupported scope, inferred sector, grade, or valuation', () => {
    for (const mutation of [
      { counterparty_scope: 'bilateral' },
      { sector: 'HOUSEHOLDS_ESTIMATE' },
      { confidence_grade: 'C' },
      { valuation: 'nominal' },
    ]) {
      expect(debtMarketRecordSchema.safeParse({ ...valid, ...mutation }).success).toBe(
        false,
      )
    }
  })

  it('requires every row to match its country shard', () => {
    const parsed = countryDebtMarketFileSchema.safeParse({
      country: 'USA',
      records: [valid],
    })
    expect(parsed.success).toBe(false)
  })
})
