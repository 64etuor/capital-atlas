import { create } from 'zustand'
import type {
  AssetClass,
  Basis,
  CurrencyView,
  MeasureType,
} from '../types/data'
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
  /** STATION 자산 탭 — URL 딥링크 대상이라 전역 (P2-9) */
  stationAsset: 'all' | AssetClass
  /** last lineage-dossier payload (kept mounted through the exit slide) */
  dossier: DossierPayload | null
  dossierOpen: boolean
  /** Cmd+K 커맨드 팔레트 (I-2) — Esc 계층의 최상단 */
  paletteOpen: boolean
  /** 첫 방문 튜토리얼 (I-4) — 팔레트 명령 TUTORIAL로 재호출 */
  tutorialOpen: boolean

  setAppView: (view: 'globe' | 'synoptic' | 'station') => void
  setBasis: (basis: Basis) => void
  setMeasure: (measure: MeasureType) => void
  setCurrency: (currency: CurrencyView) => void
  toggleEstimates: () => void
  setPeriodIndex: (index: number) => void
  setStationAsset: (asset: 'all' | AssetClass) => void
  selectCountry: (iso3: string | null) => void
  openDossier: (payload: DossierPayload) => void
  closeDossier: () => void
  setPaletteOpen: (open: boolean) => void
  setTutorialOpen: (open: boolean) => void
}

export const useViewStore = create<ViewState>()((set) => ({
  appView: 'globe',
  basis: 'owner',
  measure: 'stock',
  currency: 'usd_current',
  includeEstimates: true,
  periodIndex: periodCount() - 1,
  selectedCountry: null,
  stationAsset: 'all',
  dossier: null,
  dossierOpen: false,
  paletteOpen: false,
  tutorialOpen: false,

  setAppView: (appView) => set({ appView }),
  setBasis: (basis) => set({ basis }),
  setMeasure: (measure) => set({ measure }),
  setCurrency: (currency) => set({ currency }),
  toggleEstimates: () =>
    set((s) => ({ includeEstimates: !s.includeEstimates })),
  setPeriodIndex: (index) =>
    set({ periodIndex: Math.min(Math.max(index, 0), periodCount() - 1) }),
  setStationAsset: (stationAsset) => set({ stationAsset }),
  selectCountry: (iso3) =>
    set((s) => ({
      selectedCountry: iso3,
      dossierOpen: iso3 === s.selectedCountry ? s.dossierOpen : false,
    })),
  openDossier: (payload) => set({ dossier: payload, dossierOpen: true }),
  closeDossier: () => set({ dossierOpen: false }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setTutorialOpen: (tutorialOpen) => set({ tutorialOpen }),
}))
