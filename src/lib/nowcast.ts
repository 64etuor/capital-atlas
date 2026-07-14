import type { GlobalCryptoFile } from '../types/data'

export const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global'
export const LIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000
export const MAX_SCHEDULED_REFRESHES = 12
export const LIVE_MAX_AGE_MS = 30 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

export interface CryptoNowcastReading {
  value_usd: number
  as_of: string
  retrieved_at?: string
  source_id: 'coingecko_global'
  confidence_grade: 'B'
  state: 'live' | 'fallback'
}

type FetchResponse = Pick<Response, 'ok' | 'status' | 'json'>
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<FetchResponse>

const positiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

export function parseCoinGeckoGlobal(
  payload: unknown,
  nowMs = Date.now(),
  maxAgeMs = LIVE_MAX_AGE_MS,
): CryptoNowcastReading {
  const data =
    typeof payload === 'object' && payload !== null && 'data' in payload
      ? (payload as { data?: unknown }).data
      : undefined
  const totalMarketCap =
    typeof data === 'object' && data !== null && 'total_market_cap' in data
      ? (data as { total_market_cap?: unknown }).total_market_cap
      : undefined
  const usd =
    typeof totalMarketCap === 'object' &&
    totalMarketCap !== null &&
    'usd' in totalMarketCap
      ? (totalMarketCap as { usd?: unknown }).usd
      : undefined
  const updatedAt =
    typeof data === 'object' && data !== null && 'updated_at' in data
      ? (data as { updated_at?: unknown }).updated_at
      : undefined
  if (!positiveFinite(usd)) throw new Error('invalid global crypto market cap')
  if (!positiveFinite(updatedAt)) throw new Error('invalid live market timestamp')
  const asOfMs = updatedAt * 1000
  if (asOfMs > nowMs + MAX_FUTURE_SKEW_MS)
    throw new Error('live market timestamp is in the future')
  if (nowMs - asOfMs > maxAgeMs) throw new Error('live market payload is stale')
  return {
    value_usd: usd,
    as_of: new Date(asOfMs).toISOString(),
    retrieved_at: new Date(nowMs).toISOString(),
    source_id: 'coingecko_global',
    confidence_grade: 'B',
    state: 'live',
  }
}

export function parseCommittedCrypto(payload: GlobalCryptoFile): CryptoNowcastReading {
  if (!positiveFinite(payload.total_market_cap_usd))
    throw new Error('invalid committed crypto market cap')
  if (payload.source_id !== 'coingecko_global' || payload.confidence_grade !== 'B')
    throw new Error('invalid committed crypto lineage')
  if (!Number.isFinite(Date.parse(payload.as_of)))
    throw new Error('invalid committed crypto timestamp')
  return {
    value_usd: payload.total_market_cap_usd,
    as_of: payload.as_of,
    source_id: payload.source_id,
    confidence_grade: payload.confidence_grade,
    state: 'fallback',
  }
}

export async function loadLiveCrypto(
  signal: AbortSignal,
  fetcher: FetchLike = fetch,
  nowMs = Date.now(),
): Promise<CryptoNowcastReading> {
  const response = await fetcher(COINGECKO_GLOBAL_URL, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`CoinGecko global: HTTP ${response.status}`)
  return parseCoinGeckoGlobal(await response.json(), nowMs)
}
