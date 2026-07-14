import { describe, expect, it } from 'vitest'
import { sortRecordsDeterministically } from './deterministic-order.ts'

describe('sortRecordsDeterministically', () => {
  it('emits the same row order regardless of upstream response order', () => {
    const rows = [
      { country: 'USA', asset: 'debt', value_usd: 2 },
      { country: 'KOR', asset: 'equity', value_usd: 1 },
      { country: 'KOR', asset: 'debt', value_usd: 3 },
    ]

    expect(sortRecordsDeterministically(rows)).toEqual(
      sortRecordsDeterministically([...rows].reverse()),
    )
    expect(sortRecordsDeterministically(rows).map((row) => row.country)).toEqual([
      'KOR',
      'KOR',
      'USA',
    ])
  })

  it('builds the ordering key independently of object property insertion order', () => {
    const first = { country: 'KOR', asset: 'debt', value_usd: 1 }
    const same = { value_usd: 1, asset: 'debt', country: 'KOR' }
    const tail = { country: 'USA', asset: 'debt', value_usd: 1 }

    expect(sortRecordsDeterministically([tail, same, first])).toEqual([
      same,
      first,
      tail,
    ])
  })
})
