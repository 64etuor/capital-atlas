const RANGE_BY_METHOD: Record<string, string> = {
  rollforward_last_observation: 'model band · ±20%',
  regional_median_gdp_share: 'model band · ±35%',
  housing_wealth_gdp_ratio_by_region: 'model band · ±35%',
  position_change_minus_transactions:
    'valuation sensitivity · ±15% of position change',
  position_change_unadjusted_for_price: 'price-unadjusted flow band · ±35%',
}

/** A range without a declared construction must never be presented as a 95% interval. */
export function rangeMeaning(method?: string, explicit?: string): string {
  if (explicit) return explicit
  if (method && RANGE_BY_METHOD[method]) return RANGE_BY_METHOD[method]
  return 'method-defined bounds · not a 95% interval'
}
