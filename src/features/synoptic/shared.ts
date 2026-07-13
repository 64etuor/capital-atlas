/**
 * SYNOPTIC 공용 헬퍼 — VIS 다이얼(관측만/추정 포함)에 따른 값 선택,
 * log 스케일, 등급→선형(§6: 실선/파선/희박) 매핑, 자산 mono 약어.
 */
import type {
  AssetClass,
  ConfidenceGrade,
  SynopticCell,
} from '../../types/data'

export const OBSERVED_GRADES: ReadonlySet<ConfidenceGrade> = new Set(['A', 'B'])

export interface ModeCell {
  stock: number
  flowIn: number
  flowOut: number
  /** 글로벌 순환의 순증 — BPM6 양측(자산/부채) 평균, 부호 유지 */
  flowNet: number
  flowGross: number
  valuation: number
  obsShare: number
  records: number
}

/** VIS=OBS면 관측(A/B)-한정 변형을 쓴다. valuation은 파생(C)이라 OBS에서 0. */
export function modeCell(c: SynopticCell, observedOnly: boolean): ModeCell {
  const flowIn = observedOnly ? c.flow_in_obs : c.flow_in
  const flowOut = observedOnly ? c.flow_out_obs : c.flow_out
  return {
    stock: observedOnly ? c.stock_obs : c.stock,
    flowIn,
    flowOut,
    flowNet: (flowIn + flowOut) / 2,
    flowGross: observedOnly ? c.flow_gross_obs : c.flow_gross,
    valuation: observedOnly ? 0 : c.valuation,
    obsShare: c.obs_share,
    records: c.records,
  }
}

/** log 정규화: max 기준 `decades` 자리수 창, 0→0, 바닥 0.04 (존재 표시). */
export function logT(v: number, max: number, decades = 4): number {
  if (v <= 0 || max <= 0) return 0
  const t = (Math.log10(v) - (Math.log10(max) - decades)) / decades
  return Math.min(Math.max(t, 0.04), 1)
}

/** §6 렌더링 계약 — 관측=실선 / 유도(C)=파선 / 모델(D·E)=희박 점선. */
export function gradeDash(grade: ConfidenceGrade): string | undefined {
  if (grade === 'C') return '7 4'
  if (grade === 'D' || grade === 'E') return '2 5'
  return undefined
}

export const ASSET_ABBR: Record<AssetClass, string> = {
  deposits: 'DEP',
  loans: 'LOAN',
  debt_securities: 'DEBT',
  listed_equity: 'EQTY',
  unlisted_equity_fdi: 'FDI',
  funds: 'FUND',
  reserves_gold: 'RSRV',
  residential_property: 'HSNG',
  commodities: 'CMDT',
  crypto: 'CRYP',
}
