import type { PipObs } from '../fetch/imf.ts'
import type { DipObs } from '../fetch/imf-dip.ts'
import type { BilateralRecord } from '../../src/types/data.ts'
import { quarterEndDate } from '../fetch/lib.ts'

export interface DipBilateralResult {
  records: BilateralRecord[]
  droppedBelowThreshold: number
}

export function dipToBilateral(
  observations: readonly DipObs[],
  allowedCountries: ReadonlySet<string>,
  minUsd: number,
): DipBilateralResult {
  const records: BilateralRecord[] = []
  let droppedBelowThreshold = 0
  for (const observation of observations) {
    if (
      !allowedCountries.has(observation.owner) ||
      !allowedCountries.has(observation.issuer) ||
      observation.owner === observation.issuer
    )
      continue
    if (Math.abs(observation.value) < minUsd) {
      droppedBelowThreshold++
      continue
    }
    records.push({
      owner_country: observation.owner,
      issuer_country: observation.issuer,
      asset: 'unlisted_equity_fdi',
      period: observation.period as BilateralRecord['period'],
      measure: 'stock',
      value_usd: Math.round(observation.value),
      source_id: 'imf_dip',
      effective_date: quarterEndDate(observation.period),
      confidence_grade: 'A',
      position_basis: 'directional_principle',
    })
  }
  records.sort((a, b) =>
    [a.owner_country, a.issuer_country, a.period]
      .join('|')
      .localeCompare([b.owner_country, b.issuer_country, b.period].join('|')),
  )
  return { records, droppedBelowThreshold }
}

export interface PipPositionChange {
  current: PipObs
  previous_period: string
  value: number
}

const quarterOrdinal = (period: string): number | null => {
  const match = /^(\d{4})-Q([1-4])$/.exec(period)
  return match ? Number(match[1]) * 4 + Number(match[2]) - 1 : null
}

/**
 * Position deltas are not transactions. This helper only selects adjacent
 * annual/semiannual observations; the caller must publish them as grade D with
 * `position_change_unadjusted_for_price`.
 */
export function derivePipPositionChanges(
  observations: readonly PipObs[],
): PipPositionChange[] {
  const grouped = new Map<string, PipObs[]>()
  for (const observation of observations) {
    const key = [
      observation.owner,
      observation.issuer,
      observation.indicator,
    ].join('|')
    const rows = grouped.get(key)
    if (rows) rows.push(observation)
    else grouped.set(key, [observation])
  }

  const changes: PipPositionChange[] = []
  for (const rows of grouped.values()) {
    rows.sort((a, b) => a.period.localeCompare(b.period))
    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1]
      const current = rows[index]
      const previousOrdinal = quarterOrdinal(previous.period)
      const currentOrdinal = quarterOrdinal(current.period)
      if (previousOrdinal === null || currentOrdinal === null) continue
      const distance = currentOrdinal - previousOrdinal
      if (distance !== 2 && distance !== 4) continue
      changes.push({
        current,
        previous_period: previous.period,
        value: current.value - previous.value,
      })
    }
  }
  return changes.sort((a, b) =>
    [
      a.current.owner,
      a.current.issuer,
      a.current.indicator,
      a.current.period,
    ]
      .join('|')
      .localeCompare(
        [
          b.current.owner,
          b.current.issuer,
          b.current.indicator,
          b.current.period,
        ].join('|'),
      ),
  )
}
