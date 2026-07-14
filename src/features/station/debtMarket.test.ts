import { describe, expect, it } from 'vitest'
import type {
  CountryDebtMarketFile,
  DebtMarketRecord,
} from '../../types/data'
import { selectDebtMarket } from './debtMarket'

const record = (
  patch: Partial<DebtMarketRecord> = {},
): DebtMarketRecord => ({
  country: 'KOR',
  period: '2024-Q4',
  accounting_entry: 'liabilities',
  counterparty_scope: 'world',
  sector: 'S1',
  measure: 'stock',
  value_usd: 1_000,
  valuation: 'market',
  unit_basis: 'current_usd',
  source_id: 'bis_dss',
  effective_date: '2024-12-31',
  confidence_grade: 'A',
  ...patch,
})

const file: CountryDebtMarketFile = {
  country: 'KOR',
  records: [
    record({ period: '2023-Q4', value_usd: 900 }),
    record(),
    record({ measure: 'flow', value_usd: 25 }),
    record({ counterparty_scope: 'nonresident', value_usd: 220 }),
    record({ accounting_entry: 'assets', counterparty_scope: 'nonresident', value_usd: 300 }),
    record({ sector: 'S12', value_usd: 500 }),
    record({ sector: 'S11', value_usd: 350 }),
    record({ sector: 'S125A', value_usd: 700 }),
    record({
      accounting_entry: 'assets',
      counterparty_scope: 'nonresident',
      sector: 'S12',
      value_usd: 180,
    }),
    record({
      accounting_entry: 'assets',
      counterparty_scope: 'nonresident',
      sector: 'S1M',
      value_usd: 40,
    }),
    record({ period: '2025-Q4', value_usd: 1_100, effective_date: '2025-12-31' }),
  ],
}

describe('selectDebtMarket — direct DSS observations only', () => {
  it('uses one nearest common period and selects exact accounting/scope series', () => {
    const selected = selectDebtMarket(file, '2025-Q1')
    expect(selected.status).toBe('available')
    if (selected.status !== 'available') return
    expect(selected.period).toBe('2024-Q4')
    expect(selected.issued?.value_usd).toBe(1_000)
    expect(selected.net_issuance?.value_usd).toBe(25)
    expect(selected.nonresident_held?.value_usd).toBe(220)
    expect(selected.foreign_assets?.value_usd).toBe(300)
  })

  it('chooses only disjoint top-level sectors and never promotes a larger SPV child row', () => {
    const selected = selectDebtMarket(file, '2024-Q4')
    expect(selected.status).toBe('available')
    if (selected.status !== 'available') return
    expect(selected.top_issuer_sector?.sector).toBe('S12')
    expect(selected.top_issuer_sector?.value_usd).toBe(500)
    expect(selected.top_foreign_holder_sector?.sector).toBe('S12')
    expect(selected.top_foreign_holder_sector?.value_usd).toBe(180)
  })

  it('returns an explicit unavailable result before the first observation', () => {
    expect(selectDebtMarket(file, '2010-Q1')).toEqual({
      status: 'unavailable',
      reason: 'no_observation_on_or_before_target',
    })
  })

  it('does not interpolate missing direct series', () => {
    const sparse: CountryDebtMarketFile = {
      country: 'KOR',
      records: [record()],
    }
    const selected = selectDebtMarket(sparse, '2024-Q4')
    expect(selected.status).toBe('available')
    if (selected.status !== 'available') return
    expect(selected.net_issuance).toBeUndefined()
    expect(selected.foreign_assets).toBeUndefined()
    expect(selected.nonresident_held).toBeUndefined()
  })

  it('skips a newer period that has no comparable headline series', () => {
    const sparseLatest: CountryDebtMarketFile = {
      country: 'KOR',
      records: [
        record(),
        record({
          period: '2025-Q4',
          effective_date: '2025-12-31',
          sector: 'S122',
        }),
      ],
    }
    const selected = selectDebtMarket(sparseLatest, '2025-Q4')
    expect(selected.status).toBe('available')
    if (selected.status !== 'available') return
    expect(selected.period).toBe('2024-Q4')
  })

  it('reports an explicit reason when only non-comparable child sectors exist', () => {
    const childOnly: CountryDebtMarketFile = {
      country: 'KOR',
      records: [record({ sector: 'S122' })],
    }
    expect(selectDebtMarket(childOnly, '2024-Q4')).toEqual({
      status: 'unavailable',
      reason: 'no_comparable_headline_on_or_before_target',
    })
  })
})
