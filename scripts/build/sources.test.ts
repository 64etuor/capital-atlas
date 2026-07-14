import { describe, expect, it } from 'vitest'
import { resolveRetrievedAt } from './sources.ts'

describe('resolveRetrievedAt — optional-source lineage', () => {
  it('preserves a failed optional source while stamping successful refreshes', () => {
    const previous = new Map([
      ['coingecko_global', '2026-07-13T05:17:00.000Z'],
      ['imf_iip', '2026-07-13T05:17:00.000Z'],
    ])
    const refreshedAt = '2026-07-14T05:17:00.000Z'
    const options = {
      stampAll: refreshedAt,
      preserveSourceIds: ['coingecko_global'],
    }

    expect(
      resolveRetrievedAt('coingecko_global', previous, options, refreshedAt),
    ).toBe('2026-07-13T05:17:00.000Z')
    expect(resolveRetrievedAt('imf_iip', previous, options, refreshedAt)).toBe(
      refreshedAt,
    )
  })
})
