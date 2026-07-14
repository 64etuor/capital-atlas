import { z } from 'zod'

const period = z.string().regex(/^\d{4}-Q[1-4]$/)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const iso3 = z.string().length(3)
const coverage = z.number().finite().min(0).max(1)

const directLineage = z.strictObject({
  source_id: z.string().min(1),
  effective_date: isoDate,
  confidence_grade: z.literal('A'),
})

export const currencyExposureRecordSchema = directLineage
  .extend({
    country: iso3,
    period,
    entry: z.enum(['assets', 'liabilities']),
    sector: z.enum(['S1', 'S121', 'S122', 'S12R', 'S13', 'S1Z', 'S1ZOTH']),
    currency: z.enum(['TOTAL', 'USD', 'EUR', 'JPY', 'XDC', 'OTHC', 'UALLC']),
    value_usd: z.number().finite(),
  })

export const sectorPositionRecordSchema = directLineage
  .extend({
    country: iso3,
    period,
    sector: z.enum([
      'S1',
      'S11',
      'S121',
      'S122',
      'S123',
      'S12P',
      'S12QU',
      'S12R',
      'S13',
      'S14',
      'S15',
      'S1V',
    ]),
    asset: z.enum(['listed_equity', 'debt_securities']),
    value_usd: z.number().finite(),
  })

const fxdAvailable = z
  .strictObject({
    status: z.literal('available'),
    period,
    base_period: period,
    entry: z.enum(['assets', 'liabilities']),
    value_usd: z.number().finite(),
    coverage_share: coverage,
    residual_share: coverage,
    source_id: z.literal('model_constant_fx'),
    effective_date: isoDate,
    confidence_grade: z.enum(['C', 'D']),
    estimate_method: z.string().min(1),
    lower_bound: z.number().finite(),
    upper_bound: z.number().finite(),
  })
  .refine(
    (row) => row.lower_bound <= row.value_usd && row.value_usd <= row.upper_bound,
    { message: 'FXD value must lie inside its finite range' },
  )

const fxdUnavailable = z
  .strictObject({
    status: z.literal('unavailable'),
    period,
    base_period: period,
    entry: z.enum(['assets', 'liabilities']),
    coverage_share: coverage,
    source_ids: z.array(z.string().min(1)).min(1),
    reason: z.string().trim().min(1),
  })

export const fxdResultSchema = z.discriminatedUnion('status', [
  fxdAvailable,
  fxdUnavailable,
])

export const positionClosureCellSchema = z
  .strictObject({
    owner_country: z.union([iso3, z.literal('discrepancy_owner')]),
    issuer_country: z.union([iso3, z.literal('discrepancy_issuer')]),
    asset: z.enum(['listed_equity', 'debt_securities']),
    period,
    value_usd: z.number().finite().nonnegative(),
    lower_bound: z.number().finite().nonnegative(),
    upper_bound: z.number().finite().nonnegative(),
    confidence_grade: z.literal('E'),
    estimate_method: z.literal('biproportional_ras_position_closure'),
    coverage_share: coverage,
    effective_date: isoDate,
    source_ids: z.array(z.string().min(1)).min(2),
  })
  .refine(
    (row) => row.lower_bound <= row.value_usd && row.value_usd <= row.upper_bound,
    { message: 'closure value must lie inside its Fréchet range' },
  )

export const reconstructedLiabilitySchema = z
  .strictObject({
    country: iso3,
    period,
    asset: z.enum(['listed_equity', 'debt_securities']),
    value_usd: z.number().finite().nonnegative(),
    source_id: z.literal('imf_pip'),
    effective_date: isoDate,
    confidence_grade: z.literal('C'),
    estimate_method: z.literal(
      'counterparty_assets_transposed_to_reconstructed_liability',
    ),
    lower_bound: z.number().finite().nonnegative(),
    upper_bound: z.number().finite().nonnegative(),
    coverage_share: coverage,
  })
  .refine(
    (row) => row.lower_bound <= row.value_usd && row.value_usd <= row.upper_bound,
    { message: 'reconstructed liability must lie inside its reconciliation range' },
  )
