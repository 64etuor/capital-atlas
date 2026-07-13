/**
 * Safety/optimization tests for the static-dataset client: in-flight dedup,
 * success caching, failure recovery (no poisoned promises), bounded shard
 * cache (memory), pinned meta files, nearestAvailable semantics.
 *
 * dataClient holds module-level state, so every test gets a fresh module via
 * vi.resetModules() + dynamic import.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PeriodKey } from '../types/data'

type DataClient = typeof import('./dataClient')

const okJson = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => data }) as Response
const httpError = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as Response

async function freshClient(): Promise<DataClient> {
  vi.resetModules()
  return import('./dataClient')
}

const q = (s: string) => s as PeriodKey

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchJson cache — dedup and recovery', () => {
  it('dedups concurrent requests for the same shard into one fetch', async () => {
    const client = await freshClient()
    const fetchMock = vi.fn().mockResolvedValue(okJson({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([
      client.getBilateral(q('2024-Q4')),
      client.getBilateral(q('2024-Q4')),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toBe(b) // same parsed object, not a copy
  })

  it('serves repeat requests from cache without refetching', async () => {
    const client = await freshClient()
    const fetchMock = vi.fn().mockResolvedValue(okJson({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await client.getFlowsCountry(q('2024-Q1'))
    await client.getFlowsCountry(q('2024-Q1'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows retry after a failed shard load (no poisoned cache)', async () => {
    const client = await freshClient()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(okJson({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(client.getStocks('owner', q('2024-Q1'))).rejects.toThrow(
      'offline',
    )
    await expect(
      client.getStocks('owner', q('2024-Q1')),
    ).resolves.toMatchObject({ records: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces HTTP errors with the failing path', async () => {
    const client = await freshClient()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(httpError(404)))
    await expect(client.getStocks('owner', q('2031-Q1'))).rejects.toThrow(
      /stocks_owner\/2031-Q1\.json: HTTP 404/,
    )
  })
})

describe('singleton loaders — transient failure must not poison the app', () => {
  it('getCountries recovers after a failed first load', async () => {
    const client = await freshClient()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(
        okJson([{ iso3: 'KOR', name: 'Korea', lat: 36.5, lon: 127.9 }]),
      )
    vi.stubGlobal('fetch', fetchMock)
    await expect(client.getCountries()).rejects.toThrow('blip')
    const map = await client.getCountries() // must refetch, not replay rejection
    expect(map.get('KOR')?.name).toBe('Korea')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('getSources recovers after a failed first load', async () => {
    const client = await freshClient()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(okJson([{ source_id: 'imf_iip' }]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(client.getSources()).rejects.toThrow('blip')
    const map = await client.getSources()
    expect(map.has('imf_iip')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('getCountries stays a singleton on the success path', async () => {
    const client = await freshClient()
    const fetchMock = vi.fn().mockResolvedValue(okJson([]))
    vi.stubGlobal('fetch', fetchMock)
    await client.getCountries()
    await client.getCountries()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('shard cache bound — timeline scrubbing must not grow memory forever', () => {
  it('exposes a numeric cache bound', async () => {
    const client = await freshClient()
    expect(typeof client.MAX_SHARD_CACHE).toBe('number')
    expect(client.MAX_SHARD_CACHE).toBeGreaterThanOrEqual(8)
  })

  it('evicts the least-recently-used shard beyond the bound', async () => {
    const client = await freshClient()
    const fetchMock = vi.fn().mockResolvedValue(okJson({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const max = client.MAX_SHARD_CACHE
    // fill the cache exactly to the bound, oldest = 2010-Q1
    for (let i = 0; i < max; i++) {
      await client.getStocks('owner', q(`${2010 + i}-Q1`))
    }
    expect(fetchMock).toHaveBeenCalledTimes(max)
    // one more shard pushes the oldest out …
    await client.getStocks('owner', q(`${2010 + max}-Q1`))
    expect(fetchMock).toHaveBeenCalledTimes(max + 1)
    // … so the oldest must refetch (evicted), while a recent one is cached
    await client.getStocks('owner', q(`${2010 + max}-Q1`))
    expect(fetchMock).toHaveBeenCalledTimes(max + 1) // recent: cache hit
    await client.getStocks('owner', q('2010-Q1'))
    expect(fetchMock).toHaveBeenCalledTimes(max + 2) // oldest: evicted → refetch
  })

  it('refreshes recency on cache hit (LRU, not FIFO)', async () => {
    const client = await freshClient()
    const fetchMock = vi.fn().mockResolvedValue(okJson({ records: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const max = client.MAX_SHARD_CACHE
    for (let i = 0; i < max; i++) {
      await client.getStocks('owner', q(`${2010 + i}-Q1`))
    }
    await client.getStocks('owner', q('2010-Q1')) // touch the oldest → recent
    await client.getStocks('owner', q(`${2010 + max}-Q1`)) // evicts 2011-Q1 instead
    await client.getStocks('owner', q('2010-Q1')) // still cached
    expect(fetchMock).toHaveBeenCalledTimes(max + 1)
    await client.getStocks('owner', q('2011-Q1')) // the true LRU victim refetches
    expect(fetchMock).toHaveBeenCalledTimes(max + 2)
  })

  it('never evicts pinned meta files (index/countries/geometry/sources)', async () => {
    const client = await freshClient()
    const fetchMock = vi.fn().mockResolvedValue(okJson({ periods: {} }))
    vi.stubGlobal('fetch', fetchMock)
    await client.getIndex()
    const callsAfterIndex = fetchMock.mock.calls.length
    for (let i = 0; i < client.MAX_SHARD_CACHE + 4; i++) {
      await client.getStocks('owner', q(`${2010 + i}-Q1`))
    }
    await client.getIndex() // must still be a cache hit
    expect(fetchMock).toHaveBeenCalledTimes(
      callsAfterIndex + client.MAX_SHARD_CACHE + 4,
    )
  })
})

describe('nearestAvailable — sparse shard resolution', () => {
  const available = [q('2020-Q4'), q('2021-Q4'), q('2022-Q4')]
  it('returns the exact period when present', async () => {
    const client = await freshClient()
    expect(client.nearestAvailable(available, q('2021-Q4'))).toBe('2021-Q4')
  })
  it('floors to the greatest available period ≤ target', async () => {
    const client = await freshClient()
    expect(client.nearestAvailable(available, q('2022-Q3'))).toBe('2021-Q4')
  })
  it('returns null when the target predates all data', async () => {
    const client = await freshClient()
    expect(client.nearestAvailable(available, q('2019-Q4'))).toBeNull()
  })
  it('clamps to the last available period for far-future targets', async () => {
    const client = await freshClient()
    expect(client.nearestAvailable(available, q('2030-Q1'))).toBe('2022-Q4')
  })
})
