/**
 * Shared pipeline utilities: bounded-retry fetch, raw-response cache,
 * SDMX StructureSpecificData parsing, quarter helpers, JSON writers.
 *
 * Discipline (repo invariants):
 * - bounded retry ONLY: max 3 attempts, exponential backoff + jitter,
 *   terminal failures are recorded and surfaced — never spun on.
 * - raw responses are preserved untouched under data-raw/ (gitignored);
 *   only normalized outputs go to public/data/.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const REPO_ROOT = new URL('../..', import.meta.url).pathname
export const RAW_DIR = join(REPO_ROOT, 'data-raw')
export const OUT_DIR = join(REPO_ROOT, 'public', 'data')

/** Result of a terminal fetch failure — recorded, never fabricated over. */
export interface FetchFailure {
  url: string
  attempts: number
  lastError: string
  at: string
}

export const failures: FetchFailure[] = []

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Bounded-retry fetch: 3 attempts, backoff 1s/3s (+0–500ms jitter).
 * Returns null on terminal failure (recorded in `failures`).
 */
export async function fetchBounded(
  url: string,
  opts: { accept?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  const { accept, timeoutMs = 90_000 } = opts
  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: accept ? { accept } : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) return await res.text()
      lastError = `HTTP ${res.status}`
      // 4xx (except 429) will not improve on retry — fail fast.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < 3) await sleep(attempt * 2000 + 1000 + Math.random() * 500)
  }
  failures.push({ url, attempts: 3, lastError, at: new Date().toISOString() })
  console.error(`[fetch] TERMINAL FAILURE ${url} — ${lastError}`)
  return null
}

/**
 * Fetch through the raw-file cache. Cache hit = file exists and is younger
 * than maxAgeHours (default 24h) — keeps re-runs incremental and polite.
 */
export async function fetchCached(
  cacheKey: string,
  url: string,
  opts: { accept?: string; maxAgeHours?: number } = {},
): Promise<string | null> {
  const path = join(RAW_DIR, cacheKey)
  const maxAge = (opts.maxAgeHours ?? 24) * 3600_000
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < maxAge) {
    return readFileSync(path, 'utf8')
  }
  const body = await fetchBounded(url, opts)
  if (body !== null) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
  }
  return body
}

/** Run tasks with a small concurrency cap (politeness + wall-clock balance). */
export async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------- SDMX ----

export interface SdmxObs {
  period: string
  value: number
}
export interface SdmxSeries {
  attrs: Record<string, string>
  obs: SdmxObs[]
}

/**
 * Parse SDMX 2.1 StructureSpecificData XML (the only format api.imf.org
 * serves for data). Attribute-encoded series + <Obs> children — regex is
 * sufficient and dependency-light for this fixed shape.
 */
export function parseSdmxSeries(xml: string): SdmxSeries[] {
  const out: SdmxSeries[] = []
  const seriesRe = /<Series ([^>]*)>([\s\S]*?)<\/Series>/g
  for (let m = seriesRe.exec(xml); m; m = seriesRe.exec(xml)) {
    const attrs: Record<string, string> = {}
    for (const [, k, v] of m[1].matchAll(/([A-Z_0-9]+)="([^"]*)"/g)) attrs[k] = v
    const obs: SdmxObs[] = []
    for (const [, o] of m[2].matchAll(/<Obs ([^/>]*)\/>/g)) {
      const period = /TIME_PERIOD="([^"]*)"/.exec(o)?.[1]
      const value = /OBS_VALUE="([^"]*)"/.exec(o)?.[1]
      if (period && value !== undefined && value !== '' && value !== 'NaN') {
        const n = Number(value)
        if (Number.isFinite(n)) obs.push({ period, value: n })
      }
    }
    out.push({ attrs, obs })
  }
  return out
}

// ------------------------------------------------------------- periods ----

/** "2024-Q3" | "2024" | "2024-06" → canonical quarter key "YYYY-Qn". */
export function toQuarter(period: string): string | null {
  const q = /^(\d{4})-Q([1-4])$/.exec(period)
  if (q) return `${q[1]}-Q${q[2]}`
  const y = /^(\d{4})$/.exec(period)
  if (y) return `${y[1]}-Q4` // annual figures land on year-end
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  if (m) return `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`
  return null
}

export function quarterEndDate(qk: string): string {
  const [y, q] = qk.split('-Q')
  const ends = ['03-31', '06-30', '09-30', '12-31']
  return `${y}-${ends[Number(q) - 1]}`
}

export function compareQuarters(a: string, b: string): number {
  return a.localeCompare(b) // "YYYY-Qn" sorts lexicographically
}

// -------------------------------------------------------------- output ----

export function writeJson(relPath: string, data: unknown): number {
  const path = join(OUT_DIR, relPath)
  mkdirSync(dirname(path), { recursive: true })
  const body = JSON.stringify(data)
  writeFileSync(path, body)
  return body.length
}

export function writeRawJson(relPath: string, data: unknown): void {
  const path = join(RAW_DIR, relPath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data))
}

export function readRawJson<T>(relPath: string): T | null {
  const path = join(RAW_DIR, relPath)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
