import { describe, expect, it } from 'vitest'
import { rangeAbsenceKind, rangeMeaning } from './rangeMeaning'

describe('rangeMeaning — no false 95% precision', () => {
  it.each([
    ['rollforward_last_observation', 'model band · ±20%'],
    ['regional_median_gdp_share', 'model band · ±35%'],
    ['housing_wealth_gdp_ratio_by_region', 'model band · ±35%'],
    ['position_change_minus_transactions', 'valuation sensitivity · ±15% of position change'],
    [
      'position_change_unadjusted_for_price',
      'price-unadjusted position-change band · ±35%',
    ],
  ])('describes %s with its actual construction', (method, expected) => {
    expect(rangeMeaning(method)).toBe(expected)
  })

  it('preserves an explicit contract label and never defaults to 95%', () => {
    expect(rangeMeaning('anything', 'Fréchet bounds')).toBe('Fréchet bounds')
    expect(rangeMeaning('unknown_method')).toBe('method-defined bounds · not a 95% interval')
  })

  it('does not call an exact derived point an observed value', () => {
    expect(rangeAbsenceKind()).toBe('observed')
    expect(rangeAbsenceKind('published ratio arithmetic')).toBe(
      'derived_exact',
    )
  })
})
