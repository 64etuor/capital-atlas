/**
 * Optional: CoinGecko public global endpoint — one call, no key.
 * Country allocation of crypto holdings is a v2 modelling problem (draft
 * §7.7); v1 only records the global control total for future use.
 * A failure here is non-fatal by design.
 */
import { fetchBounded, writeJson } from './lib.ts'

export async function run(): Promise<boolean> {
  const body = await fetchBounded('https://api.coingecko.com/api/v3/global', {
    accept: 'application/json',
    timeoutMs: 20_000,
  })
  if (body === null) return false
  try {
    const parsed = JSON.parse(body) as {
      data: { total_market_cap: Record<string, number>; updated_at: number }
    }
    const usd = parsed.data.total_market_cap.usd
    if (!Number.isFinite(usd)) return false
    writeJson('meta/global_crypto.json', {
      total_market_cap_usd: usd,
      as_of: new Date(parsed.data.updated_at * 1000).toISOString(),
      source_id: 'coingecko_global',
      confidence_grade: 'B',
      note: 'global control total only — country allocation is v2 (draft §7.7)',
    })
    console.log(`[crypto] global market cap $${(usd / 1e12).toFixed(2)}T`)
    return true
  } catch {
    return false
  }
}
