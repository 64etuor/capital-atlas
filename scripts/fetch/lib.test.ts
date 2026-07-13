/**
 * Safety tests for the pipeline fetch layer: bounded retry, fail-fast on
 * client errors, honest failure records, SDMX parsing robustness, pool cap,
 * raw-cache TTL. Written test-first (TDD) — assertions encode the repo
 * invariant "bounded retry only, terminal failure surfaced, never fabricated".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  RAW_DIR,
  failures,
  fetchBounded,
  fetchCached,
  parseSdmxSeries,
  pooled,
  toQuarter,
} from './lib.ts'

const okResponse = (body: string) =>
  ({ ok: true, status: 200, text: async () => body }) as Response
const errResponse = (status: number) =>
  ({ ok: false, status, text: async () => '' }) as Response

describe('fetchBounded — bounded retry discipline', () => {
  beforeEach(() => {
    failures.length = 0
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0) // deterministic backoff
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('recovers through transient 5xx and stops at the first success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(okResponse('payload'))
    vi.stubGlobal('fetch', fetchMock)
    const p = fetchBounded('https://x.test/transient')
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBe('payload')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(failures).toHaveLength(0)
  })

  it('never exceeds 3 attempts on persistent 500 and records the terminal failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(500))
    vi.stubGlobal('fetch', fetchMock)
    const p = fetchBounded('https://x.test/dead')
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      url: 'https://x.test/dead',
      attempts: 3,
      lastError: 'HTTP 500',
    })
  })

  it('fails fast on 404 without retrying and records the real attempt count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(404))
    vi.stubGlobal('fetch', fetchMock)
    const p = fetchBounded('https://x.test/notfound')
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Honest bookkeeping: a fail-fast 404 made 1 attempt, not 3.
    expect(failures[0]?.attempts).toBe(1)
  })

  it('treats 429 as retryable (rate limit, not a client bug)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(okResponse('after-backoff'))
    vi.stubGlobal('fetch', fetchMock)
    const p = fetchBounded('https://x.test/ratelimited')
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBe('after-backoff')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries network rejections instead of throwing', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse('recovered'))
    vi.stubGlobal('fetch', fetchMock)
    const p = fetchBounded('https://x.test/flaky')
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBe('recovered')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('backs off with growing, fully bounded delays between attempts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(500))
    vi.stubGlobal('fetch', fetchMock)
    const p = fetchBounded('https://x.test/backoff')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2999) // 1st backoff = 3000ms (jitter 0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4999) // 2nd backoff = 5000ms (jitter 0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeNull()
  })
})

describe('parseSdmxSeries — StructureSpecificData robustness', () => {
  it('parses series attributes and numeric observations', () => {
    const xml = `<Series REF_AREA="KR" INDICATOR="IIP">
      <Obs TIME_PERIOD="2024-Q1" OBS_VALUE="123.5"/>
      <Obs TIME_PERIOD="2024-Q2" OBS_VALUE="130"/>
    </Series>`
    const series = parseSdmxSeries(xml)
    expect(series).toHaveLength(1)
    expect(series[0].attrs.REF_AREA).toBe('KR')
    expect(series[0].obs).toEqual([
      { period: '2024-Q1', value: 123.5 },
      { period: '2024-Q2', value: 130 },
    ])
  })

  it('keeps observations whose attribute values contain "/"', () => {
    // Attribute values may legally contain slashes (unit/currency pair codes).
    const xml =
      '<Series REF_AREA="KR">' +
      '<Obs TIME_PERIOD="2024-Q1" OBS_VALUE="7" UNIT_MULT="USD/EUR"/>' +
      '</Series>'
    expect(parseSdmxSeries(xml)[0].obs).toEqual([
      { period: '2024-Q1', value: 7 },
    ])
  })

  it('silently drops empty, NaN and non-finite observation values', () => {
    const xml =
      '<Series REF_AREA="KR">' +
      '<Obs TIME_PERIOD="2024-Q1" OBS_VALUE=""/>' +
      '<Obs TIME_PERIOD="2024-Q2" OBS_VALUE="NaN"/>' +
      '<Obs TIME_PERIOD="2024-Q3" OBS_VALUE="not-a-number"/>' +
      '<Obs TIME_PERIOD="2024-Q4" OBS_VALUE="42"/>' +
      '</Series>'
    expect(parseSdmxSeries(xml)[0].obs).toEqual([
      { period: '2024-Q4', value: 42 },
    ])
  })
})

describe('toQuarter — period canonicalization', () => {
  it('canonicalizes quarterly, annual and monthly periods', () => {
    expect(toQuarter('2024-Q3')).toBe('2024-Q3')
    expect(toQuarter('2024')).toBe('2024-Q4') // annual lands on year-end
    expect(toQuarter('2024-01')).toBe('2024-Q1')
    expect(toQuarter('2024-06')).toBe('2024-Q2')
    expect(toQuarter('2024-12')).toBe('2024-Q4')
  })
  it('rejects garbage instead of guessing', () => {
    expect(toQuarter('Q3-2024')).toBeNull()
    expect(toQuarter('2024-13')).toBe(null) // month 13 → Q5 must not exist
    expect(toQuarter('')).toBeNull()
  })
})

describe('pooled — concurrency cap', () => {
  it('never runs more than `limit` tasks at once and preserves order', async () => {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 12 }, (_, i) => i)
    const results = await pooled(items, 4, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 2))
      active--
      return n * 10
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1) // it does actually parallelize
    expect(results).toEqual(items.map((n) => n * 10))
  })
})

describe('fetchCached — raw-file TTL cache (re-run politeness)', () => {
  const key = 'test-tmp/sample.txt'
  const path = join(RAW_DIR, key)
  const cleanup = () =>
    rmSync(join(RAW_DIR, 'test-tmp'), { recursive: true, force: true })

  beforeEach(cleanup)
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('serves a fresh raw file without touching the network', async () => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'cached-body')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchCached(key, 'https://x.test/never')).resolves.toBe(
      'cached-body',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refetches once the raw file is older than maxAgeHours', async () => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'stale-body')
    const old = new Date(Date.now() - 3 * 3600_000)
    utimesSync(path, old, old)
    const fetchMock = vi.fn().mockResolvedValue(okResponse('fresh-body'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      fetchCached(key, 'https://x.test/refresh', { maxAgeHours: 1 }),
    ).resolves.toBe('fresh-body')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readFileSync(path, 'utf8')).toBe('fresh-body')
  })
})
