import { describe, expect, it } from 'vitest'
import type { DebtMarketRecord } from '../../src/types/data.ts'
import { groupDebtMarket } from './debt-market.ts'
import { requireUsableDssCoverage } from '../fetch/bis-dss.ts'

const record = (
  country: string,
  period: DebtMarketRecord['period'],
  value: number,
): DebtMarketRecord => ({
  country,
  period,
  accounting_entry: 'liabilities',
  counterparty_scope: 'world',
  sector: 'S1',
  measure: 'stock',
  value_usd: value,
  valuation: 'market',
  unit_basis: 'current_usd',
  source_id: 'bis_dss',
  effective_date: `${period.slice(0, 4)}-12-31`,
  confidence_grade: 'A',
})

describe('debt-market product builder', () => {
  it('groups deterministically by country and publishes sorted coverage', () => {
    const product = groupDebtMarket([
      record('USA', '2025-Q4', 3),
      record('KOR', '2025-Q4', 2),
      record('KOR', '2024-Q4', 1),
    ])
    expect(product.index).toEqual({
      countries: ['KOR', 'USA'],
      periods: ['2024-Q4', '2025-Q4'],
    })
    expect([...product.files.keys()]).toEqual(['KOR', 'USA'])
    expect(product.files.get('KOR')?.records.map((row) => row.value_usd)).toEqual([
      1,
      2,
    ])
  })

  it('refuses an empty or one-sided refresh before public overwrite', () => {
    const one = record('KOR', '2025-Q4', 1)
    expect(() => requireUsableDssCoverage([], [one], [one])).toThrow(/assets/i)
    expect(() => requireUsableDssCoverage([one], [], [one])).toThrow(/liabilities/i)
    expect(() => requireUsableDssCoverage([one], [one], [])).toThrow(/usable/i)
    expect(() => requireUsableDssCoverage([one], [one], [one])).not.toThrow()
  })
})
