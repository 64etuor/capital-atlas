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
}
