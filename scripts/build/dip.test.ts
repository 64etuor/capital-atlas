import { describe, expect, it } from 'vitest'
import type { DipObs } from '../fetch/imf-dip.ts'
import { dipToBilateral } from './bilateral.ts'

const row = (
  issuer: string,
  value: number,
  owner = 'KOR',
): DipObs => ({
  owner,
  issuer,
  period: '2024-Q4',
  value,
})

describe('dipToBilateral — directional-principle FDI facts', () => {
  it('publishes direct annual stocks with an explicit basis and no invented flow', () => {
    const result = dipToBilateral(
      [row('USA', 2e8), row('JPN', -3e8), row('DEU', 5e7), row('XXX', 9e8)],
      new Set(['KOR', 'USA', 'JPN', 'DEU']),
      1e8,
    )

    expect(result.droppedBelowThreshold).toBe(1)
    expect(result.records).toEqual([
      expect.objectContaining({
        owner_country: 'KOR',
        issuer_country: 'JPN',
        asset: 'unlisted_equity_fdi',
        period: '2024-Q4',
        measure: 'stock',
        value_usd: -3e8,
        source_id: 'imf_dip',
        confidence_grade: 'A',
        position_basis: 'directional_principle',
      }),
      expect.objectContaining({
        owner_country: 'KOR',
        issuer_country: 'USA',
        value_usd: 2e8,
      }),
    ])
    expect(result.records.every((record) => record.measure === 'stock')).toBe(true)
    expect(
      result.records.every(
        (record) =>
          record.estimate_method === undefined &&
          record.lower_bound === undefined &&
          record.upper_bound === undefined,
      ),
    ).toBe(true)
  })
})
