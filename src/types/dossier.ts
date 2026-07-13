import type { ConfidenceGrade } from './data'

/**
 * Payload for the lineage dossier ("calibration sheet", DESIGN.md §5).
 * Every on-screen number opens one of these — §1.5: no number without
 * lineage. Aggregates synthesize a payload from their constituent records.
 */
export interface DossierPayload {
  title: string
  subtitle?: string
  value_usd: number
  grade: ConfidenceGrade
  /** absent = direct observation */
  method?: string
  lower_bound?: number
  upper_bound?: number
  effective_date?: string
  source_ids: string[]
  /** extra context rows rendered as-is: [label, value] */
  context: Array<[string, string]>
  /**
   * 개정 이력 조회 키 (Phase N, §15.5) — 있으면 도시에가 빈티지 다이제스트와
   * 대조해 REVISIONS 행을 그린다. stock 계열 수치에만 부여(흐름은 미추적).
   */
  revision_key?: {
    basis: 'owner' | 'issuer' | 'location'
    country: string
    asset: string | 'total'
    period: string
  }
}
