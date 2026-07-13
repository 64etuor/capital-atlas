/**
 * 분기 환율 파이프라인 (Phase L) — CURR=LCU 다이얼의 근거 시계열.
 *
 * IMF Data API ER dataflow (실호출 프로브 2026-07-13):
 *   key COUNTRY.INDICATOR.TYPE_OF_TRANSFORMATION.FREQUENCY
 *   INDICATOR=XDC_USD (domestic currency per USD),
 *   TYPE_OF_TRANSFORMATION=EOP_RT (기말 — 잔액 변환과 정합)
 *   검증: KOR 2024-Q4 = 1470.0 KRW/USD.
 *
 * 폴백 사다리: IMF 분기(A) → WB PA.NUS.FCRF 연간을 Q4에 적용(B, method 공개)
 * → 둘 다 없으면 미제공(정직 공백 — 날조 금지).
 */
import { createRequire } from 'node:module'
import {
  chunk,
  fetchCached,
  parseSdmxSeries,
  pooled,
  quarterEndDate,
  toQuarter,
  writeJson,
  writeRawJson,
} from './lib.ts'
import { buildCountries } from './countries.ts'
import type { FxRatesFile } from '../../src/types/data.ts'

const BASE = 'https://api.imf.org/external/sdmx/2.1/data'

interface WorldCountryCurrency {
  cca3: string
  currencies?: Record<string, unknown>
}

const wc = createRequire(import.meta.url)('world-countries') as WorldCountryCurrency[]

/** ISO3 → ISO 4217 (world-countries 첫 통화 — 복수 통화국은 대표 통화). */
export const CURRENCY_BY_ISO3: ReadonlyMap<string, string> = new Map(
  wc.flatMap((c) => {
    const code = Object.keys(c.currencies ?? {})[0]
    return code && /^[A-Z]{3}$/.test(code) ? [[c.cca3, code] as const] : []
  }),
)

export interface ErObs {
  iso3: string
  quarter: string
  rate: number
}

export interface WbFxObs {
  iso3: string
  year: number
  rate: number
}

/** 순수 조립 — 테스트 대상. IMF 보유국은 IMF만, WB는 IMF 무보유국 전용. */
export function assembleFx(
  imf: ErObs[],
  wb: WbFxObs[],
  iso3s: string[],
): FxRatesFile {
  const master = new Set(iso3s)
  const countries: FxRatesFile['countries'] = {}
  const valid = (r: number) => Number.isFinite(r) && r > 0

  for (const o of imf) {
    if (!master.has(o.iso3) || !valid(o.rate)) continue
    const currency = CURRENCY_BY_ISO3.get(o.iso3)
    if (!currency) continue
    const c = (countries[o.iso3] ??= { currency, quarterly: true, rates: {} })
    c.rates[o.quarter as keyof typeof c.rates] = {
      rate: o.rate,
      grade: 'A',
      source_id: 'imf_ifs_fx',
      effective_date: quarterEndDate(o.quarter),
    }
  }

  for (const o of wb) {
    if (!master.has(o.iso3) || !valid(o.rate)) continue
    if (countries[o.iso3]) continue // IMF 분기 보유국은 오염 금지
    const currency = CURRENCY_BY_ISO3.get(o.iso3)
    if (!currency) continue
    const q = `${o.year}-Q4`
    const c = (countries[o.iso3] ??= { currency, quarterly: false, rates: {} })
    c.rates[q as keyof typeof c.rates] = {
      rate: o.rate,
      grade: 'B',
      source_id: 'wb_wdi',
      effective_date: quarterEndDate(q),
      method: 'wb_pa_nus_fcrf_annual_rate_q4',
    }
  }

  // 결정론(Phase N): 수집 시각은 sources.json retrieved_at이 정본 — 여기엔 금지
  return {
    base: 'USD',
    countries,
  }
}

async function fetchImfEr(iso3s: string[]): Promise<ErObs[]> {
  const out: ErObs[] = []
  const chunks = chunk(iso3s, 12)
  await pooled(chunks, 5, async (group, i) => {
    const key = `${group.join('+')}.XDC_USD.EOP_RT.Q`
    const url = `${BASE}/IMF.STA,ER/${key}?startPeriod=2010-Q1`
    const xml = await fetchCached(`imf/er_xdc-usd_eop_chunk${i}.xml`, url)
    if (xml === null) return
    for (const s of parseSdmxSeries(xml)) {
      const iso3 = s.attrs.COUNTRY
      if (!iso3) continue
      for (const o of s.obs) {
        const q = toQuarter(o.period)
        if (q) out.push({ iso3, quarter: q, rate: o.value })
      }
    }
  })
  return out
}

interface WbApiRow {
  countryiso3code: string
  date: string
  value: number | null
}

async function fetchWbFx(): Promise<WbFxObs[]> {
  const rows: WbFxObs[] = []
  for (let page = 1; page <= 10; page++) {
    const url =
      'https://api.worldbank.org/v2/country/all/indicator/PA.NUS.FCRF' +
      `?format=json&date=2010:2026&per_page=20000&page=${page}`
    const body = await fetchCached(`wb/PA.NUS.FCRF_p${page}.json`, url)
    if (body === null) return rows
    const parsed = JSON.parse(body) as [{ pages: number }, WbApiRow[] | null]
    for (const r of parsed[1] ?? []) {
      if (r.value === null || !r.countryiso3code || r.countryiso3code === 'WLD')
        continue
      rows.push({ iso3: r.countryiso3code, year: Number(r.date), rate: r.value })
    }
    if (page >= parsed[0].pages) break
  }
  return rows
}

export async function runFx(iso3s: string[]): Promise<FxRatesFile> {
  const [imf, wb] = [await fetchImfEr(iso3s), await fetchWbFx()]
  const file = assembleFx(imf, wb, iso3s)
  writeRawJson('fx_normalized.json', { imf: imf.length, wb: wb.length })
  const bytes = writeJson('meta/fx_rates.json', file)
  const list = Object.values(file.countries)
  console.log(
    `[fx] ${list.length} economies (${list.filter((c) => c.quarterly).length} quarterly A / ` +
      `${list.filter((c) => !c.quarterly).length} annual-Q4 B) → meta/fx_rates.json (${(bytes / 1024).toFixed(0)}KB)`,
  )
  return file
}

// CLI: pnpm data:fx — 환율만 단독 재수집 (raw 캐시 24h 존중)
if (process.argv[1]?.endsWith('fx.ts')) {
  const iso3s = buildCountries().map((c) => c.iso3)
  await runFx(iso3s)
}
