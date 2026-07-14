import { z } from 'zod'
import type { PeriodKey } from '../../src/types/data.ts'

const period = z.custom<PeriodKey>(
  (value) => typeof value === 'string' && /^\d{4}-Q[1-4]$/.test(value),
  'invalid quarter key',
)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const iso3 = z.string().regex(/^[A-Z]{3}$/)

export const debtMarketSectorSchema = z.enum([
  'S1',
  'S11',
  'S12',
  'S121',
  'S122',
  'S123',
  'S125A',
  'S12P',
  'S12Q',
  'S12T',
  'S13',
  'S1311',
  'S1M',
  'S1ZS',
])

export const debtMarketRecordSchema = z
  .strictObject({
    country: iso3,
    period,
    accounting_entry: z.enum(['assets', 'liabilities']),
    counterparty_scope: z.enum(['world', 'resident', 'nonresident']),
    sector: debtMarketSectorSchema,
    measure: z.enum(['stock', 'flow']),
    value_usd: z.number().finite(),
    valuation: z.literal('market'),
    unit_basis: z.literal('current_usd'),
    source_id: z.literal('bis_dss'),
    effective_date: isoDate,
    confidence_grade: z.literal('A'),
  })
  .refine((row) => row.measure === 'flow' || row.value_usd >= 0, {
    message: 'debt-market stock must be nonnegative',
  })

export const countryDebtMarketFileSchema = z
  .strictObject({
    country: iso3,
    records: z.array(debtMarketRecordSchema),
  })
  .refine((file) => file.records.every((row) => row.country === file.country), {
    message: 'debt-market row country must match its shard',
  })

export const debtMarketIndexSchema = z.strictObject({
  countries: z.array(iso3),
  periods: z.array(period),
})
