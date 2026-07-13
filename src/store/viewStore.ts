import { create } from 'zustand'
import type { Basis, CurrencyView, MeasureType } from '../types/data'
import type { DossierPayload } from '../types/dossier'
import { periodCount } from '../lib/periods'

/**
 * Global view state. Every control in the chrome writes here; the map and
 * detail panels read from here.
 */
interface ViewState {
  /** 관측 표면: 지구본(GLOBE) / 종관도(SYNOPTIC) / 관측 분석(STATION) */
  appView: 'globe' | 'synoptic' | 'station'
  basis: Basis
  measure: MeasureType
  currency: CurrencyView
  /** false = observed records only; true = include estimated (grades C–E) */
  includeEstimates: boolean
  /** quarter index on the timeline, 0 = 2010-Q1 */
  periodIndex: number
  /** ISO3 of the country open in the detail panel, or null */
  selectedCountry: string | null
  /** last lineage-dossier payload (kept mounted through the exit slide) */
  dossier: DossierPayload | null
  dossierOpen: boolean

  setAppView: (view: 'globe' | 'synoptic' | 'station') => void
  setBasis: (basis: Basis) => void
  setMeasure: (measure: MeasureType) => void
  setCurrency: (currency: CurrencyView) => void
  toggleEstimates: () => void
  setPeriodIndex: (index: number) => void
  selectCountry: (iso3: string | null) => void
  openDossier: (payload: DossierPayload) => void
  closeDossier: () => void
}

export const useViewStore = create<ViewState>()((set) => ({
  appView: 'globe',
  basis: 'owner',
  measure: 'stock',
  currency: 'usd_current',
  includeEstimates: true,
  periodIndex: periodCount() - 1,
  selectedCountry: null,
  dossier: null,
  dossierOpen: false,

  setAppView: (appView) => set({ appView }),
  setBasis: (basis) => set({ basis }),
  setMeasure: (measure) => set({ measure }),
  setCurrency: (currency) => set({ currency }),
  toggleEstimates: () =>
    set((s) => ({ includeEstimates: !s.includeEstimates })),
  setPeriodIndex: (index) =>
    set({ periodIndex: Math.min(Math.max(index, 0), periodCount() - 1) }),
  selectCountry: (iso3) =>
    set((s) => ({
      selectedCountry: iso3,
      dossierOpen: iso3 === s.selectedCountry ? s.dossierOpen : false,
    })),
  openDossier: (payload) => set({ dossier: payload, dossierOpen: true }),
  closeDossier: () => set({ dossierOpen: false }),
}))
