import { describe, expect, it } from 'vitest'
import type { PipObs } from '../fetch/imf.ts'
import { derivePipPositionChanges } from './bilateral.ts'

const pip = (
  period: string,
  value: number,
  frequency: PipObs['frequency'] = 'S',
  issuer = 'USA',
): PipObs => ({
  owner: 'KOR',
  issuer,
  indicator: 'P_F51_P_USD',
  period,
  frequency,
  value,
})

describe('derivePipPositionChanges — explicit grade-D inputs', () => {
  it('derives only adjacent annual/semiannual published observations', () => {
    const rows = [
      pip('2023-Q4', 100, 'A'),
      pip('2024-Q4', 120, 'A'),
      pip('2025-Q2', 90),
      pip('2025-Q4', 110),
      pip('2027-Q4', 999, 'A'),
    ]

    expect(derivePipPositionChanges(rows)).toEqual([
      { current: rows[1], previous_period: '2023-Q4', value: 20 },
      { current: rows[2], previous_period: '2024-Q4', value: -30 },
      { current: rows[3], previous_period: '2025-Q2', value: 20 },
    ])
  })

  it('never crosses owner/issuer/asset series', () => {
    expect(
      derivePipPositionChanges([
        pip('2024-Q4', 100, 'A', 'USA'),
        pip('2025-Q2', 120, 'S', 'JPN'),
      ]),
    ).toEqual([])
  })
})
