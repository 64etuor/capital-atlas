import type { PeriodKey } from '../types/data'

export const START_YEAR = 2010
/** Overridden at boot from public/data/index.json (the canonical period list). */
const FALLBACK_LATEST: PeriodKey = '2025-Q4'

let latest: PeriodKey = FALLBACK_LATEST

/** Called once in main.tsx, before the first render. */
export function initPeriods(latestQuarter: PeriodKey): void {
  latest = latestQuarter
}

/**
 * 데이터 스냅샷 빈티지(YYYY-MM-DD) — 명판의 "현재 추정 기준"은 월클럭이
 * 아니라 이 값이다(감사 F1): v1은 나우캐스팅 없는 정적 스냅샷이므로 오늘
 * 날짜를 표시하면 보유하지 않은 신선도를 주장하게 된다.
 */
let dataVintage: string | null = null

/** Called once in main.tsx from index.generated_at, before the first render. */
export function initDataVintage(generatedAt: string): void {
  dataVintage = generatedAt.slice(0, 10)
}

/** Snapshot vintage date, or null if index.json never loaded. */
export function dataVintageDate(): string | null {
  return dataVintage
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
