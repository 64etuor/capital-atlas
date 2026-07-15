import { describe, expect, it } from 'vitest'
import { isMapSyncing } from './loading'

describe('isMapSyncing', () => {
  const current = {
    ready: true,
    requestedChoroKey: 'owner|stock|2026-Q1|true',
    loadedChoroKey: 'owner|stock|2026-Q1|true',
    requestedArcKey: '2026-Q1|*|stock|true',
    loadedArcKey: '2026-Q1|*|stock|true',
  }

  it('stays idle when both visible shard keys are current', () => {
    expect(isMapSyncing(current)).toBe(false)
  })

  it('syncs while a requested choropleth shard is stale', () => {
    expect(
      isMapSyncing({
        ...current,
        requestedChoroKey: 'issuer|stock|2026-Q1|true',
      }),
    ).toBe(true)
  })

  it('syncs while a requested arc shard is missing or stale', () => {
    expect(isMapSyncing({ ...current, loadedArcKey: null })).toBe(true)
    expect(
      isMapSyncing({
        ...current,
        requestedArcKey: '2026-Q1|KOR|stock|true',
      }),
    ).toBe(true)
  })

  it('leaves the first-load state to the full loader', () => {
    expect(isMapSyncing({ ...current, ready: false })).toBe(false)
  })
})
