/**
 * 빈티지 다이제스트 (Phase N, 초안 §10 이중 시간 · §15.5 데이터 개정 이력).
 * 실질 변경 커밋마다 스냅샷의 경량 요약을 vintages/{YYYY-MM-DD}.json으로
 * 보존한다 — 184MB 전체 복사가 아니라 (basis,country,asset) 최신분기
 * 값+등급, 국가 총계, 글로벌 요약, 바로그래프 시계열만. 도시에 REVISIONS
 * 행이 이 다이제스트들과 현재 값을 대조해 소급 개정을 노출한다.
 *
 * 결정론: 입력이 같으면 바이트가 같다(타임스탬프 없음 — vintage 날짜는
 * index.generated_at에서 파생).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUT_DIR, writeJson } from '../fetch/lib.ts'
import type {
  Basis,
  FlowIntensityFile,
  PeriodIndexFile,
  PeriodKey,
  StockRecord,
  StocksFile,
} from '../../src/types/data.ts'

export interface VintageEntry {
  p: string
  v: number
  g?: string
}

export interface VintageDigest {
  vintage: string // YYYY-MM-DD = index.generated_at 날짜부
  latest_quarter: PeriodKey
  /** basis → country → 최신분기 총계(그 basis의 최신 분기에 존재하는 레코드 합) */
  totals: Record<Basis, Record<string, VintageEntry>>
  /** basis → country → asset → 그 키의 최신 관측 {p,v,g} (희소 허용) */
  stocks: Record<Basis, Record<string, Record<string, VintageEntry>>>
  global: { total_usd: number; per_asset: Record<string, number> }
  flow_intensity: Array<{ p: string; v: number }>
}

export interface VintageInput {
  index: PeriodIndexFile
  stocksByBasis: Record<Basis, StockRecord[]>
  flowIntensity: Array<{ period: PeriodKey; gross_flow_usd: number }>
}

const BASES: Basis[] = ['owner', 'issuer', 'location']

const sortedRecord = <V>(entries: Array<[string, V]>): Record<string, V> =>
  Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))

export function buildVintageDigest(input: VintageInput): VintageDigest {
  const stocks = {} as VintageDigest['stocks']
  const totals = {} as VintageDigest['totals']

  for (const basis of BASES) {
    const records = input.stocksByBasis[basis] ?? []
    const periods = input.index.periods[`stocks_${basis}`]
    const basisLatest = periods.length ? periods[periods.length - 1] : null

    // (country, asset) → 최신 관측
    const latestByKey = new Map<string, StockRecord>()
    for (const r of records) {
      const k = `${r.country}|${r.asset}`
      const prev = latestByKey.get(k)
      if (!prev || r.period > prev.period) latestByKey.set(k, r)
    }
    const byCountry = new Map<string, Array<[string, VintageEntry]>>()
    for (const r of latestByKey.values()) {
      const list = byCountry.get(r.country) ?? []
      list.push([r.asset, { p: r.period, v: r.value_usd, g: r.confidence_grade }])
      byCountry.set(r.country, list)
    }
    stocks[basis] = sortedRecord(
      [...byCountry.entries()].map(([c, assets]) => [c, sortedRecord(assets)]),
    )

    // 국가 총계 — basis 최신 분기에 존재하는 레코드만 합산
    const totalByCountry = new Map<string, number>()
    if (basisLatest) {
      for (const r of records) {
        if (r.period !== basisLatest) continue
        totalByCountry.set(r.country, (totalByCountry.get(r.country) ?? 0) + r.value_usd)
      }
    }
    totals[basis] = sortedRecord(
      [...totalByCountry.entries()].map(([c, v]) => [
        c,
        { p: basisLatest as string, v },
      ]),
    )
  }

  // 글로벌 요약 — owner 최신 분기
  const ownerPeriods = input.index.periods.stocks_owner
  const ownerLatest = ownerPeriods[ownerPeriods.length - 1]
  let total_usd = 0
  const perAsset = new Map<string, number>()
  for (const r of input.stocksByBasis.owner ?? []) {
    if (r.period !== ownerLatest) continue
    total_usd += r.value_usd
    perAsset.set(r.asset, (perAsset.get(r.asset) ?? 0) + r.value_usd)
  }

  return {
    vintage: input.index.generated_at.slice(0, 10),
    latest_quarter: input.index.latest_quarter,
    totals,
    stocks,
    global: { total_usd, per_asset: sortedRecord([...perAsset.entries()]) },
    flow_intensity: input.flowIntensity.map((x) => ({
      p: x.period,
      v: x.gross_flow_usd,
    })),
  }
}

export interface VintageKey {
  basis: Basis
  country: string
  asset: string | 'total'
  period: PeriodKey
}

/** 도시에 REVISIONS 조회 — 분기 불일치는 개정이 아니라 다른 관측이므로 null. */
export function lookupVintage(
  d: VintageDigest,
  key: VintageKey,
): VintageEntry | null {
  const entry =
    key.asset === 'total'
      ? d.totals[key.basis]?.[key.country]
      : d.stocks[key.basis]?.[key.country]?.[key.asset]
  if (!entry || entry.p !== key.period) return null
  return entry
}

// ------------------------------------------------------------------ CLI ----

const readOut = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(OUT_DIR, rel), 'utf8')) as T

if (process.argv[1]?.endsWith('vintage.ts')) {
  const index = readOut<PeriodIndexFile>('index.json')
  const stocksByBasis = {} as Record<Basis, StockRecord[]>
  for (const basis of BASES) {
    const all: StockRecord[] = []
    for (const p of index.periods[`stocks_${basis}`]) {
      all.push(...readOut<StocksFile>(`stocks_${basis}/${p}.json`).records)
    }
    stocksByBasis[basis] = all
  }
  const fi = readOut<FlowIntensityFile>('meta/flow_intensity.json')
  const digest = buildVintageDigest({
    index,
    stocksByBasis,
    flowIntensity: fi.series,
  })

  const bytes = writeJson(`vintages/${digest.vintage}.json`, digest)
  if (bytes >= 5 * 1024 * 1024)
    throw new Error(`[vintage] ${digest.vintage}.json exceeds the 5MB clause`)

  const idxPath = join(OUT_DIR, 'vintages', 'index.json')
  const existing = existsSync(idxPath)
    ? (JSON.parse(readFileSync(idxPath, 'utf8')) as { vintages: string[] })
    : { vintages: [] }
  const vintages = [...new Set([...existing.vintages, digest.vintage])].sort()
  writeJson('vintages/index.json', { vintages })
  console.log(
    `[vintage] vintages/${digest.vintage}.json — ${(bytes / 1024).toFixed(0)}KiB, ` +
      `${vintages.length} vintage(s) tracked`,
  )
}
