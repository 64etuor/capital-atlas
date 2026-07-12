import type { PeriodKey } from '../types/data'

export const START_YEAR = 2010
export const END_YEAR = 2025
/** total quarters on the timeline slider (2010-Q1 … 2025-Q4) */
export const PERIOD_COUNT = (END_YEAR - START_YEAR + 1) * 4

export function periodFromIndex(index: number): PeriodKey {
  const year = START_YEAR + Math.floor(index / 4)
  const quarter = ((index % 4) + 1) as 1 | 2 | 3 | 4
  return `${year}-Q${quarter}`
}

export function indexFromPeriod(period: PeriodKey): number {
  const [y, q] = period.split('-Q')
  return (Number(y) - START_YEAR) * 4 + (Number(q) - 1)
}
