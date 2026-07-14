import { z } from 'zod'

const gradeSchema = z.enum(['A', 'B', 'C', 'D', 'E'])
const basisSchema = z.enum([
  'asset_liability',
  'lbs_position_side',
  'directional_principle',
])

const allocationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('available'),
      allocated_usd: z.number().finite(),
      owner_stock_usd: z.number().finite().positive(),
      share: z.number().finite(),
      confidence_grade: gradeSchema,
      denominator_source_ids: z.array(z.string()).min(1),
      lower_bound: z.number().finite().optional(),
      upper_bound: z.number().finite().optional(),
      range_label: z.string().optional(),
    })
    .superRefine((coverage, context) => {
      if (
        ['D', 'E'].includes(coverage.confidence_grade) &&
        (coverage.lower_bound === undefined ||
          coverage.upper_bound === undefined ||
          coverage.range_label === undefined)
      )
        context.addIssue({
          code: 'custom',
          message: 'D/E allocation coverage requires finite bounds and range label',
          input: coverage,
        })
    }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.string().min(1),
  }),
])

const pointSchema = z.object({
  period: z.string().regex(/^\d{4}-Q[1-4]$/),
  stock: z.number().finite(),
  grade: gradeSchema,
  stock_lower: z.number().finite().optional(),
  stock_upper: z.number().finite().optional(),
  source_id: z.string().optional(),
})

const counterpartySchema = z.object({
  period: z.string().regex(/^\d{4}-Q[1-4]$/),
  scope: z.string(),
  gross_usd: z.number().finite().positive(),
  grade: gradeSchema,
  position_bases: z.array(basisSchema),
  allocation_coverage: allocationSchema,
})

export const stationConcentrationFileSchema = z.object({
  series: z.record(z.string(), z.array(pointSchema)),
  concentration: z.object({
    counterparty: z.array(counterpartySchema),
  }),
})

type Grade = z.infer<typeof gradeSchema>
type Basis = z.infer<typeof basisSchema>
export type StationConcentrationFile = z.infer<
  typeof stationConcentrationFileSchema
>

export interface ExpectedCounterpartyScope {
  gross_usd: number
  grade: Grade
  position_bases: Basis[]
}

const ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 }
const worst = (a: Grade | undefined, b: Grade): Grade =>
  a === undefined || ORDER[b] > ORDER[a] ? b : a
const close = (a: number, b: number): boolean =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

export function validateStationConcentration(
  file: StationConcentrationFile,
  expected: ReadonlyMap<string, ExpectedCounterpartyScope>,
): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const cp of file.concentration.counterparty) {
    const key = `${cp.period}|${cp.scope}`
    seen.add(key)
    const exp = expected.get(key)
    if (!exp) {
      issues.push(`${key}: unexpected counterparty concentration`)
      continue
    }
    if (!close(cp.gross_usd, exp.gross_usd))
      issues.push(`${key}: bilateral gross differs from published shard`)
    if (cp.grade !== exp.grade)
      issues.push(`${key}: numerator confidence grade differs from published shard`)
    if (
      cp.position_bases.join('|') !== [...exp.position_bases].sort().join('|')
    )
      issues.push(`${key}: position bases differ from published shard`)

    const points =
      cp.scope === 'all'
        ? Object.values(file.series).flat()
        : (file.series[cp.scope] ?? [])
    let denominator = 0
    let denominatorLower = 0
    let denominatorUpper = 0
    let denominatorGrade: Grade | undefined
    let bounded = true
    const denominatorSources = new Set<string>()
    for (const point of points) {
      if (point.period !== cp.period) continue
      denominator += point.stock
      denominatorGrade = worst(denominatorGrade, point.grade)
      if (point.source_id) denominatorSources.add(point.source_id)
      if (point.grade === 'D' || point.grade === 'E') {
        if (
          point.stock_lower === undefined ||
          point.stock_upper === undefined
        ) {
          bounded = false
          denominatorLower += point.stock
          denominatorUpper += point.stock
        } else {
          denominatorLower += Math.min(point.stock_lower, point.stock_upper)
          denominatorUpper += Math.max(point.stock_lower, point.stock_upper)
        }
      } else {
        denominatorLower += point.stock
        denominatorUpper += point.stock
      }
    }
    const allocationGrade = worst(exp.grade, denominatorGrade ?? 'E')
    const shouldBeUnavailable =
      denominator <= 0 ||
      ((allocationGrade === 'D' || allocationGrade === 'E') &&
        (!bounded || denominatorLower <= 0 || denominatorUpper <= 0))
    if (shouldBeUnavailable) {
      if (cp.allocation_coverage.status !== 'unavailable')
        issues.push(`${key}: allocation must be unavailable for invalid denominator`)
      continue
    }
    if (cp.allocation_coverage.status !== 'available') {
      issues.push(`${key}: allocation unexpectedly unavailable`)
      continue
    }
    const coverage = cp.allocation_coverage
    if (!close(coverage.allocated_usd, exp.gross_usd))
      issues.push(`${key}: allocated gross differs from bilateral gross`)
    if (!close(coverage.owner_stock_usd, denominator))
      issues.push(`${key}: owner-stock denominator is not the exact-period signed sum`)
    if (!close(coverage.share, exp.gross_usd / denominator))
      issues.push(`${key}: allocation share differs from exact ratio`)
    if (coverage.confidence_grade !== allocationGrade)
      issues.push(`${key}: allocation confidence grade is not numerator/denominator worst`)
    if (
      coverage.denominator_source_ids.join('|') !==
      [...denominatorSources].sort().join('|')
    )
      issues.push(`${key}: denominator sources differ from owner series`)
    if (allocationGrade === 'D' || allocationGrade === 'E') {
      const expectedLower = exp.gross_usd / Math.max(denominatorLower, denominatorUpper)
      const expectedUpper = exp.gross_usd / Math.min(denominatorLower, denominatorUpper)
      if (
        coverage.lower_bound === undefined ||
        !close(coverage.lower_bound, expectedLower)
      )
        issues.push(`${key}: allocation lower bound differs from denominator sensitivity`)
      if (
        coverage.upper_bound === undefined ||
        !close(coverage.upper_bound, expectedUpper)
      )
        issues.push(`${key}: allocation upper bound differs from denominator sensitivity`)
    }
  }
  for (const key of expected.keys())
    if (!seen.has(key)) issues.push(`${key}: missing counterparty concentration`)
  return issues
}
