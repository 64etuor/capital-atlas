import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_MAX_AGE_MS,
  LIVE_REFRESH_INTERVAL_MS,
  MAX_SCHEDULED_REFRESHES,
  loadLiveCrypto,
  parseCoinGeckoGlobal,
  parseCommittedCrypto,
} from './nowcast'

const now = Date.parse('2026-07-14T03:00:00.000Z')

describe('parseCoinGeckoGlobal — live market honesty gate', () => {
  it('accepts a fresh positive global control total as a B-grade live market reading', () => {
    const reading = parseCoinGeckoGlobal(
      {
        data: {
          total_market_cap: { usd: 2_345_678_901_234 },
          updated_at: now / 1000 - 60,
        },
      },
      now,
    )
    expect(reading).toMatchObject({
      value_usd: 2_345_678_901_234,
      retrieved_at: '2026-07-14T03:00:00.000Z',
      state: 'live',
      source_id: 'coingecko_global',
      confidence_grade: 'B',
    })
  })

  it('rejects stale, future, nonpositive, and malformed payloads instead of showing a number', () => {
    expect(() =>
      parseCoinGeckoGlobal(
        { data: { total_market_cap: { usd: 1 }, updated_at: (now - LIVE_MAX_AGE_MS - 1) / 1000 } },
        now,
      ),
    ).toThrow(/stale/)
    expect(() =>
      parseCoinGeckoGlobal(
        { data: { total_market_cap: { usd: 1 }, updated_at: now / 1000 + 301 } },
        now,
      ),
    ).toThrow(/future/)
    expect(() =>
      parseCoinGeckoGlobal(
        { data: { total_market_cap: { usd: 0 }, updated_at: now / 1000 } },
        now,
      ),
    ).toThrow(/market cap/)
    expect(() => parseCoinGeckoGlobal({}, now)).toThrow()
  })
})

describe('committed fallback and bounded loader', () => {
  it('labels the committed snapshot as fallback even when its lineage is valid', () => {
    expect(
      parseCommittedCrypto({
        total_market_cap_usd: 2_000_000_000_000,
        as_of: '2026-07-12T14:41:20.000Z',
        source_id: 'coingecko_global',
        confidence_grade: 'B',
        note: 'global control total only',
      }),
    ).toMatchObject({ state: 'fallback', value_usd: 2_000_000_000_000 })
  })

  it('fetches the public endpoint with an AbortSignal and validates the response', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          total_market_cap: { usd: 2_100_000_000_000 },
          updated_at: now / 1000,
        },
      }),
    })
    const controller = new AbortController()
    const reading = await loadLiveCrypto(controller.signal, fetcher, now)
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/global',
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(reading.state).toBe('live')
  })

  it('keeps the refresh loop finite and five-minute spaced by contract', () => {
    expect(MAX_SCHEDULED_REFRESHES).toBe(12)
    expect(LIVE_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000)
  })
})
