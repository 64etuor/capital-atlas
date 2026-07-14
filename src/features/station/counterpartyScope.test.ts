import { describe, expect, it } from 'vitest'
import {
  COUNTERPARTY_ALLOCATION_LABEL,
  COUNTERPARTY_NO_DATA_REASON,
  COUNTERPARTY_SOURCE_IDS,
  OBSERVATION_COVERAGE_LABEL,
  counterpartyScopeLabel,
  formatAllocationCoverage,
  formatPositionBases,
  unavailableCounterpartyDossier,
  visibleAllocationCoverage,
} from './counterpartyScope'

describe('counterparty scope labels — dashboard-only interpretation safety', () => {
  it('separates owner-stock observation coverage from counterparty allocation', () => {
    expect(OBSERVATION_COVERAGE_LABEL).toBe('OBS STOCK')
    expect(COUNTERPARTY_ALLOCATION_LABEL).toBe('CP ALLOC')
  })

  it('does not call the combined bilateral scope all assets', () => {
    expect(counterpartyScopeLabel('all')).toBe('BILATERAL-COVERED ASSETS')
    expect(counterpartyScopeLabel('debt_securities')).toBe('DEBT SECURITIES')
  })

  it('names every bilateral source family in the no-data contract', () => {
    expect(COUNTERPARTY_SOURCE_IDS).toEqual([
      'imf_pip',
      'imf_dip',
      'bis_lbs',
    ])
    expect(COUNTERPARTY_NO_DATA_REASON).toBe(
      'no PIP/DIP/BIS bilateral positions for this scope',
    )
  })

  it('represents no-data dossiers without a zero value or fabricated grade', () => {
    const dossier = unavailableCounterpartyDossier('KOR · counterparty HHI')
    expect(dossier).toMatchObject({
      status: 'unavailable',
      source_ids: ['imf_pip', 'imf_dip', 'bis_lbs'],
    })
    expect(dossier).not.toHaveProperty('value_usd')
    expect(dossier).not.toHaveProperty('grade')
  })

  it('formats a real ratio and preserves typed unavailability', () => {
    expect(
      formatAllocationCoverage({
        status: 'available',
        allocated_usd: 100,
        owner_stock_usd: 200,
        share: 0.5,
        confidence_grade: 'A',
        denominator_source_ids: ['imf_iip'],
      }),
    ).toBe('50%')
    expect(
      formatAllocationCoverage({
        status: 'unavailable',
        reason: 'same-period owner stock denominator is missing or non-positive',
      }),
    ).toBe('UNAVAIL')
  })

  it('hides a D/E allocation ratio in observed-only mode', () => {
    const coverage = {
      status: 'available' as const,
      allocated_usd: 100,
      owner_stock_usd: 200,
      share: 0.5,
      confidence_grade: 'D' as const,
      lower_bound: 0.4,
      upper_bound: 0.7,
      range_label: 'owner-stock denominator sensitivity',
      denominator_source_ids: ['model_regional_median'],
    }
    expect(visibleAllocationCoverage(coverage, false)).toBe(coverage)
    expect(visibleAllocationCoverage(coverage, true)).toEqual({
      status: 'unavailable',
      reason: 'estimated owner-stock denominator is hidden in OBS mode',
    })
  })

  it('renders every official position basis instead of collapsing mixed scope', () => {
    expect(
      formatPositionBases(['asset_liability', 'directional_principle']),
    ).toBe('asset_liability + directional_principle')
  })
})
