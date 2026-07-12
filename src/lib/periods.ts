import type { PeriodKey } from '../types/data'

export const START_YEAR = 2010
/** Overridden at boot from public/data/index.json (the canonical period list). */
const FALLBACK_LATEST: PeriodKey = '2025-Q4'

let latest: PeriodKey = FALLBACK_LATEST

/** Called once in main.tsx, before the first render. */
export function initPeriods(latestQuarter: PeriodKey): void {
  latest = latestQuarter
}

export function latestPeriod(): PeriodKey {
  return latest
}

/** Quarters on the timeline: 2010-Q1 … latest_quarter (stable after boot). */
export function periodCount(): number {
  return indexFromPeriod(latest) + 1
}

export function periodFromIndex(index: number): PeriodKey {
  const year = START_YEAR + Math.floor(index / 4)
  const quarter = ((index % 4) + 1) as 1 | 2 | 3 | 4
  return `${year}-Q${quarter}`
}

export function indexFromPeriod(period: PeriodKey): number {
  const [y, q] = period.split('-Q')
  return (Number(y) - START_YEAR) * 4 + (Number(q) - 1)
}
