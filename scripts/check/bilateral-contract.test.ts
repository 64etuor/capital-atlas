import { describe, expect, it } from 'vitest'
import {
  bilateralRecordSchema,
  pipNormalizedObservationSchema,
  summarizeBilateralCoverage,
} from './bilateral-contract.ts'

const base = {
  owner_country: 'KOR',
  issuer_country: 'USA',
  period: '2024-Q4',
  measure: 'stock' as const,
  value_usd: 100,
  effective_date: '2024-12-31',
}

describe('bilateralRecordSchema — source, basis, asset, measure honesty', () => {
  it('accepts the three direct official position families', () => {
    for (const row of [
      {
        ...base,
        asset: 'listed_equity',
        source_id: 'imf_pip',
        confidence_grade: 'A',
        position_basis: 'asset_liability',
      },
      {
        ...base,
        asset: 'loans',
        source_id: 'bis_lbs',
        confidence_grade: 'B',
        position_basis: 'lbs_position_side',
      },
      {
        ...base,
        asset: 'unlisted_equity_fdi',
        source_id: 'imf_dip',
        confidence_grade: 'A',
        position_basis: 'directional_principle',
      },
    ])
      expect(bilateralRecordSchema.safeParse(row).success).toBe(true)
  })

  it('rejects DIP flows and every source/basis mismatch', () => {
    const dip = {
      ...base,
      asset: 'unlisted_equity_fdi',
      source_id: 'imf_dip',
      confidence_grade: 'A',
      position_basis: 'directional_principle',
    }
    for (const row of [
      { ...dip, measure: 'flow' },
      { ...dip, confidence_grade: 'C' },
      { ...dip, position_basis: 'asset_liability' },
      { ...dip, source_id: 'imf_pip' },
      {
        ...base,
        asset: 'loans',
        source_id: 'bis_lbs',
        confidence_grade: 'B',
        position_basis: 'asset_liability',
      },
    ])
      expect(bilateralRecordSchema.safeParse(row).success).toBe(false)
  })

  it('publishes PIP only on canonical semiannual endpoints', () => {
    const pip = {
      ...base,
      asset: 'listed_equity',
      source_id: 'imf_pip',
      confidence_grade: 'A',
      position_basis: 'asset_liability',
    }
    expect(bilateralRecordSchema.safeParse({ ...pip, period: '2024-Q2' }).success).toBe(true)
    expect(bilateralRecordSchema.safeParse({ ...pip, period: '2024-Q4' }).success).toBe(true)
    expect(bilateralRecordSchema.safeParse({ ...pip, period: '2024-Q1' }).success).toBe(false)
    expect(bilateralRecordSchema.safeParse({ ...pip, period: '2024-Q3' }).success).toBe(false)
  })

  it('keeps normalized PIP frequency coherent with its canonical period', () => {
    const pip = {
      owner: 'KOR',
      issuer: 'USA',
      indicator: 'P_F51_P_USD',
      value: 100,
    }
    for (const row of [
      { ...pip, frequency: 'A', period: '2024-Q4' },
      { ...pip, frequency: 'S', period: '2024-Q2' },
      { ...pip, frequency: 'S', period: '2024-Q4' },
    ])
      expect(pipNormalizedObservationSchema.safeParse(row).success).toBe(true)
    for (const row of [
      { ...pip, frequency: 'A', period: '2024-Q2' },
      { ...pip, frequency: 'S', period: '2024-Q1' },
      { ...pip, frequency: 'S', period: '2024-Q3' },
    ])
      expect(pipNormalizedObservationSchema.safeParse(row).success).toBe(false)
  })

  it('summarizes direct DIP and semiannual PIP coverage for publication gates', () => {
    const rows = [
      {
        ...base,
        asset: 'unlisted_equity_fdi' as const,
        source_id: 'imf_dip' as const,
        confidence_grade: 'A' as const,
        position_basis: 'directional_principle' as const,
      },
      {
        ...base,
        owner_country: 'JPN',
        asset: 'unlisted_equity_fdi' as const,
        source_id: 'imf_dip' as const,
        confidence_grade: 'A' as const,
        position_basis: 'directional_principle' as const,
      },
      {
        ...base,
        period: '2024-Q2',
        asset: 'listed_equity' as const,
        source_id: 'imf_pip' as const,
        confidence_grade: 'A' as const,
        position_basis: 'asset_liability' as const,
      },
    ]

    expect(summarizeBilateralCoverage(rows)).toEqual({
      dip_records: 2,
      dip_reporters: 2,
      pip_q2_stock_records: 1,
    })
  })
})
