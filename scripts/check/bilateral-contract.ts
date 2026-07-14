import { z } from 'zod'

const issue = (
  context: z.core.$RefinementCtx,
  message: string,
): void =>
  context.addIssue({ code: 'custom', message, input: undefined })

export const bilateralRecordSchema = z
  .object({
    owner_country: z.string().length(3),
    issuer_country: z.string().length(3),
    asset: z.enum([
      'listed_equity',
      'debt_securities',
      'loans',
      'deposits',
      'unlisted_equity_fdi',
    ]),
    period: z.string().regex(/^\d{4}-Q[1-4]$/),
    measure: z.enum(['stock', 'flow']),
    value_usd: z.number().finite(),
    source_id: z.enum(['imf_pip', 'bis_lbs', 'imf_dip']),
    effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    confidence_grade: z.enum(['A', 'B', 'C', 'D', 'E']),
    estimate_method: z.string().optional(),
    lower_bound: z.number().optional(),
    upper_bound: z.number().optional(),
    position_basis: z.enum([
      'asset_liability',
      'lbs_position_side',
      'directional_principle',
    ]),
  })
  .superRefine((row, context) => {
    if (row.source_id === 'imf_pip') {
      if (!['listed_equity', 'debt_securities'].includes(row.asset))
        issue(context, 'imf_pip must be a portfolio-security asset')
      if (row.position_basis !== 'asset_liability')
        issue(context, 'imf_pip requires asset_liability basis')
      if (!row.period.endsWith('-Q2') && !row.period.endsWith('-Q4'))
        issue(context, 'imf_pip requires a canonical Q2 or Q4 period')
      if (row.measure === 'stock' && row.confidence_grade !== 'A')
        issue(context, 'imf_pip stock must remain direct grade A')
      if (
        row.measure === 'flow' &&
        (row.confidence_grade !== 'D' ||
          row.estimate_method !== 'position_change_unadjusted_for_price' ||
          row.lower_bound === undefined ||
          row.upper_bound === undefined)
      )
        issue(context, 'imf_pip flow must be bounded grade-D position change')
      return
    }
    if (row.source_id === 'bis_lbs') {
      if (!['loans', 'deposits'].includes(row.asset))
        issue(context, 'bis_lbs must be a banking-channel asset')
      if (
        row.position_basis !== 'lbs_position_side' ||
        row.measure !== 'stock' ||
        row.confidence_grade !== 'B'
      )
        issue(context, 'bis_lbs requires grade-B lbs_position_side stock')
      return
    }
    if (
      row.asset !== 'unlisted_equity_fdi' ||
      row.position_basis !== 'directional_principle' ||
      row.measure !== 'stock' ||
      row.confidence_grade !== 'A' ||
      !row.period.endsWith('-Q4') ||
      row.estimate_method !== undefined ||
      row.lower_bound !== undefined ||
      row.upper_bound !== undefined
    )
      issue(
        context,
        'imf_dip requires unadjusted grade-A annual directional-principle stock',
      )
  })

export type BilateralRecord = z.infer<typeof bilateralRecordSchema>

export const pipNormalizedObservationSchema = z
  .object({
    owner: z.string().length(3),
    issuer: z.string().length(3),
    indicator: z.enum(['P_F51_P_USD', 'P_F3_P_USD']),
    period: z.string().regex(/^\d{4}-Q[1-4]$/),
    frequency: z.enum(['A', 'S']),
    value: z.number().finite(),
  })
  .superRefine((row, context) => {
    if (row.frequency === 'A' && !row.period.endsWith('-Q4'))
      issue(context, 'annual PIP observations require a canonical Q4 period')
    if (
      row.frequency === 'S' &&
      !row.period.endsWith('-Q2') &&
      !row.period.endsWith('-Q4')
    )
      issue(
        context,
        'semiannual PIP observations require a canonical Q2 or Q4 period',
      )
  })

export type PipNormalizedObservation = z.infer<
  typeof pipNormalizedObservationSchema
>

export interface BilateralCoverageSummary {
  dip_records: number
  dip_reporters: number
  pip_q2_stock_records: number
}

export class BilateralCoverageCounter {
  private dipRecords = 0
  private readonly dipReporters = new Set<string>()
  private pipQ2StockRecords = 0

  observe(row: BilateralRecord): void {
    if (row.source_id === 'imf_dip') {
      this.dipRecords++
      this.dipReporters.add(row.owner_country)
    }
    if (
      row.source_id === 'imf_pip' &&
      row.measure === 'stock' &&
      row.period.endsWith('-Q2')
    )
      this.pipQ2StockRecords++
  }

  summary(): BilateralCoverageSummary {
    return {
      dip_records: this.dipRecords,
      dip_reporters: this.dipReporters.size,
      pip_q2_stock_records: this.pipQ2StockRecords,
    }
  }
}

export const summarizeBilateralCoverage = (
  rows: Iterable<BilateralRecord>,
): BilateralCoverageSummary => {
  const counter = new BilateralCoverageCounter()
  for (const row of rows) counter.observe(row)
  return counter.summary()
}
