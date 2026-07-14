import { describe, expect, it } from 'vitest'
import {
  currencyExposureRecordSchema,
  fxdResultSchema,
  positionClosureCellSchema,
  reconstructedLiabilitySchema,
  sectorPositionRecordSchema,
} from './exposure-contract.ts'

const direct = {
  country: 'KOR',
  period: '2024-Q4',
  value_usd: 10,
  source_id: 'imf_iipcc',
  effective_date: '2024-12-31',
  confidence_grade: 'A',
}

describe('v3 exposure contract', () => {
  it('accepts non-overlapping IIPCC currency facts and rejects FC overlap', () => {
    const row = {
      ...direct,
      entry: 'assets',
      sector: 'S1',
      currency: 'USD',
    }
    expect(currencyExposureRecordSchema.safeParse(row).success).toBe(true)
    expect(
      currencyExposureRecordSchema.safeParse({ ...row, currency: 'FC' }).success,
    ).toBe(false)
  })

  it('keeps official PIP sectors exact and rejects invented splits', () => {
    const row = { ...direct, sector: 'S1V', asset: 'listed_equity' }
    expect(sectorPositionRecordSchema.safeParse(row).success).toBe(true)
    expect(
      sectorPositionRecordSchema.safeParse({ ...row, sector: 'HOUSEHOLD_FROM_S1V' })
        .success,
    ).toBe(false)
  })

  it('requires a finite ordered range for an available FXD estimate', () => {
    const result = {
      status: 'available',
      period: '2024-Q4',
      base_period: '2020-Q4',
      entry: 'assets',
      value_usd: 90,
      coverage_share: 0.98,
      residual_share: 0.02,
      source_id: 'model_constant_fx',
      effective_date: '2024-12-31',
      confidence_grade: 'D',
      estimate_method: 'currency_bucket_constant_fx_with_bounded_residual',
      lower_bound: 85,
      upper_bound: 95,
    }
    expect(fxdResultSchema.safeParse(result).success).toBe(true)
    expect(
      fxdResultSchema.safeParse({ ...result, estimate_method: undefined }).success,
    ).toBe(false)
    expect(
      fxdResultSchema.safeParse({ ...result, lower_bound: 100 }).success,
    ).toBe(false)
  })

  it('uses a non-empty reason instead of a numeric placeholder when unavailable', () => {
    const unavailable = {
      status: 'unavailable',
      period: '2024-Q4',
      base_period: '2020-Q4',
      entry: 'liabilities',
      coverage_share: 0.7,
      source_ids: ['imf_iipcc', 'imf_ifs_fx'],
      reason: 'other and unallocated currencies exceed 5% of the total',
    }
    expect(fxdResultSchema.safeParse(unavailable).success).toBe(true)
    expect(fxdResultSchema.safeParse({ ...unavailable, reason: '' }).success).toBe(false)
    expect(
      fxdResultSchema.safeParse({ ...unavailable, value_usd: 0 }).success,
    ).toBe(false)
  })

  it('requires every RAS cell to remain grade E with method, coverage, and bounds', () => {
    const cell = {
      owner_country: 'KOR',
      issuer_country: 'USA',
      asset: 'debt_securities',
      value_usd: 80,
      lower_bound: 20,
      upper_bound: 100,
      confidence_grade: 'E',
      estimate_method: 'biproportional_ras_position_closure',
      coverage_share: 0.8,
      period: '2024-Q4',
      effective_date: '2024-12-31',
      source_ids: ['imf_pip', 'imf_iip'],
    }
    expect(positionClosureCellSchema.safeParse(cell).success).toBe(true)
    expect(
      positionClosureCellSchema.safeParse({ ...cell, confidence_grade: 'A' }).success,
    ).toBe(false)
  })

  it('requires reconstructed liabilities to expose the top-down/bottom-up interval', () => {
    const row = {
      country: 'KOR',
      period: '2024-Q4',
      asset: 'debt_securities',
      value_usd: 70,
      source_id: 'imf_pip',
      effective_date: '2024-12-31',
      confidence_grade: 'C',
      estimate_method: 'counterparty_assets_transposed_to_reconstructed_liability',
      lower_bound: 70,
      upper_bound: 100,
      coverage_share: 0.7,
    }
    expect(reconstructedLiabilitySchema.safeParse(row).success).toBe(true)
    expect(
      reconstructedLiabilitySchema.safeParse({ ...row, upper_bound: undefined }).success,
    ).toBe(false)
  })
})
