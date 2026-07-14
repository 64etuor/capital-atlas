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
 * 아니라 이 값이다(감사 F1). v3 일중 시장 오버레이도 별도 조회시각을 쓰며,
 * 공식 통계 명판을 오늘 날짜로 바꾸지 않는다.
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
