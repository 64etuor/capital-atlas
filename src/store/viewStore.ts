import { create } from 'zustand'
import type { Basis, CurrencyView, MeasureType } from '../types/data'
import { PERIOD_COUNT } from '../lib/periods'

/**
 * Global view state. Every control in the chrome writes here; the map and
 * detail panels read from here. Phase C layers subscribe to this store.
 */
interface ViewState {
  basis: Basis
  measure: MeasureType
  currency: CurrencyView
  /** false = observed records only; true = include estimated (grades C–E) */
  includeEstimates: boolean
  /** quarter index on the timeline, 0 = 2010-Q1 */
  periodIndex: number
  /** ISO3 of the country open in the detail panel, or null */
  selectedCountry: string | null

  setBasis: (basis: Basis) => void
  setMeasure: (measure: MeasureType) => void
  setCurrency: (currency: CurrencyView) => void
  toggleEstimates: () => void
  setPeriodIndex: (index: number) => void
  selectCountry: (iso3: string | null) => void
}

export const useViewStore = create<ViewState>()((set) => ({
  basis: 'owner',
  measure: 'stock',
  currency: 'usd_current',
  includeEstimates: true,
  periodIndex: PERIOD_COUNT - 1,
  selectedCountry: null,

  setBasis: (basis) => set({ basis }),
  setMeasure: (measure) => set({ measure }),
  setCurrency: (currency) => set({ currency }),
  toggleEstimates: () =>
    set((s) => ({ includeEstimates: !s.includeEstimates })),
  setPeriodIndex: (index) =>
    set({ periodIndex: Math.min(Math.max(index, 0), PERIOD_COUNT - 1) }),
  selectCountry: (iso3) => set({ selectedCountry: iso3 }),
}))
