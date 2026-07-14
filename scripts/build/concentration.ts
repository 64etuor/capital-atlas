/**
 * CONCENTRATION 집계 — 초안 §14 집중도 지표의 순수 계산부.
 *
 * 정직성 규율:
 * - 상대국 HHI/top-5는 **발행 bilateral 샤드 전체**에서 계산한다 — station
 *   파일의 top-15 상대국 리스트로 계산하면 꼬리를 잘라 HHI가 과대평가된다.
 * - 단, 샤드 자체가 업스트림에서 |값| ≥ $100M로 프루닝된 산출물이므로 그
 *   한계를 method 문구에 그대로 남긴다. 가치 보존율은 계산하지 않는다.
 * - 모든 지표는 파생값: source_id 상속 + 산식 문구 + 구성 레코드 worst 등급.
 */
import type { BilateralRecord } from './synoptic.ts'
import type { StationSeries } from './station.ts'

type Grade = 'A' | 'B' | 'C' | 'D' | 'E'
const GRADE_ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 }
const worst = (a: Grade | undefined, b: Grade): Grade =>
  a === undefined || GRADE_ORDER[b] > GRADE_ORDER[a] ? b : a
const OBSERVED = new Set<Grade>(['A', 'B'])

export const CP_METHOD =
  'HHI = sum of squared counterparty shares over bilateral positions ' +
  '(CPIS securities + BIS LBS banking channel); ' +
  'top-5 = combined share of the five largest counterparties. ' +
  'Limitation: computed from published shards pruned upstream at |value| ≥ $100M ' +
  'so the long tail is truncated and HHI is slightly overstated; value retention ' +
  'is not computed.'

export const QUARTERLY_METHOD =
  'share_of_world = country total ÷ world total (stocks_owner shards, ' +
  'exact-period sums); asset_shares = asset stock ÷ country total.'

export const CORRIDOR_CONC_METHOD =
  'top-N corridor gross ÷ total bilateral gross (CPIS securities + BIS LBS ' +
  'banking positions, pruned ' +
  'upstream at |value| ≥ $100M). *_obs variants restrict both numerator and ' +
  'denominator to observed (A/B) records.'

/** Σ (|vᵢ|/Σ|v|)² — 빈 배열은 0 (분포 없음 ≠ 완전 집중). */
export function hhiOf(values: readonly number[]): number {
  let gross = 0
  for (const v of values) gross += Math.abs(v)
  if (gross <= 0) return 0
  let h = 0
  for (const v of values) h += (Math.abs(v) / gross) ** 2
  return h
}

export interface CpConcentration {
  period: string
  scope: string // 'all' | AssetClass
  hhi: number
  top5_share: number
  top5: Array<{ country: string; share: number }>
  gross_usd: number
  n_partners: number
  grade: Grade
  source_ids: string[]
  method: string
}

/**
 * 상대국 집중도 — holdings 방향(owner === iso3), CPIS 포지션(measure=stock)만.
 * 스코프 = 'all' + 자산별. 같은 상대국의 복수 자산 레코드는 국가 단위로 합산.
 */
export function counterpartyConcentration(
  bilat: readonly BilateralRecord[],
  iso3: string,
): CpConcentration[] {
  // period → scope → issuer → {value, grade, sources}
  const acc = new Map<
    string,
    Map<string, Map<string, { value: number; grade: Grade; sources: Set<string> }>>
  >()
  const add = (period: string, scope: string, r: BilateralRecord) => {
    let scopes = acc.get(period)
    if (!scopes) acc.set(period, (scopes = new Map()))
    let issuers = scopes.get(scope)
    if (!issuers) scopes.set(scope, (issuers = new Map()))
    const cur = issuers.get(r.issuer_country)
    if (cur) {
      cur.value += Math.abs(r.value_usd)
      cur.grade = worst(cur.grade, r.confidence_grade)
      cur.sources.add(r.source_id)
    } else {
      issuers.set(r.issuer_country, {
        value: Math.abs(r.value_usd),
        grade: r.confidence_grade,
        sources: new Set([r.source_id]),
      })
    }
  }
  for (const r of bilat) {
    if (r.owner_country !== iso3 || r.measure !== 'stock') continue
    add(r.period, 'all', r)
    add(r.period, r.asset, r)
  }

  const out: CpConcentration[] = []
  for (const [period, scopes] of acc) {
    for (const [scope, issuers] of scopes) {
      const rows = [...issuers.entries()].sort((a, b) => b[1].value - a[1].value)
      const gross = rows.reduce((a, [, v]) => a + v.value, 0)
      if (gross <= 0) continue
      let grade: Grade | undefined
      const sources = new Set<string>()
      for (const [, v] of rows) {
        grade = worst(grade, v.grade)
        for (const s of v.sources) sources.add(s)
      }
      const top5 = rows
        .slice(0, 5)
        .map(([country, v]) => ({ country, share: v.value / gross }))
      out.push({
        period,
        scope,
        hhi: hhiOf(rows.map(([, v]) => v.value)),
        top5_share: top5.reduce((a, t) => a + t.share, 0),
        top5,
        gross_usd: gross,
        n_partners: rows.length,
        grade: grade ?? 'E',
        source_ids: [...sources].sort(),
        method: CP_METHOD,
      })
    }
  }
  return out.sort(
    (a, b) => a.period.localeCompare(b.period) || a.scope.localeCompare(b.scope),
  )
}

export interface QuarterlyConcentration {
  period: string
  share_of_world: number
  share_of_world_assets: Partial<Record<string, number>>
  asset_shares: Partial<Record<string, number>>
  grade: Grade
  source_ids: string[]
  method: string
}

/** 분기별 세계 대비 비중 + 국가 내부 자산 구성 비중 (정확-기간 합). */
export function quarterlyConcentration(
  country: StationSeries,
  world: StationSeries,
): QuarterlyConcentration[] {
  const worldAt = new Map<string, Map<string, number>>() // period → asset → stock
  for (const [asset, pts] of Object.entries(world)) {
    for (const p of pts ?? []) {
      let assets = worldAt.get(p.period)
      if (!assets) worldAt.set(p.period, (assets = new Map()))
      assets.set(asset, p.stock)
    }
  }

  const periods = new Set<string>()
  for (const pts of Object.values(country))
    for (const p of pts ?? []) periods.add(p.period)

  const out: QuarterlyConcentration[] = []
  for (const period of [...periods].sort()) {
    let countryTotal = 0
    let worldTotal = 0
    let grade: Grade | undefined
    const sources = new Set<string>()
    const assetStocks: Array<[string, number]> = []
    const shareWorldAssets: Partial<Record<string, number>> = {}
    for (const [asset, pts] of Object.entries(country)) {
      const p = pts?.find((x) => x.period === period)
      if (!p || p.stock <= 0) continue
      assetStocks.push([asset, p.stock])
      countryTotal += p.stock
      grade = worst(grade, p.grade)
      if (p.source_id) sources.add(p.source_id)
      const w = worldAt.get(period)?.get(asset)
      if (w !== undefined && w > 0) shareWorldAssets[asset] = p.stock / w
    }
    for (const w of worldAt.get(period)?.values() ?? []) worldTotal += w
    if (countryTotal <= 0) continue
    const asset_shares: Partial<Record<string, number>> = {}
    for (const [asset, stock] of assetStocks)
      asset_shares[asset] = stock / countryTotal
    out.push({
      period,
      share_of_world: worldTotal > 0 ? countryTotal / worldTotal : 0,
      share_of_world_assets: shareWorldAssets,
      asset_shares,
      grade: grade ?? 'E',
      source_ids: [...sources].sort(),
      method: QUARTERLY_METHOD,
    })
  }
  return out
}

export interface CorridorConcentration {
  top10_share: number
  top20_share: number
  gross_usd: number
  top10_share_obs: number
  top20_share_obs: number
  gross_obs_usd: number
}

/** 상위 회랑(포지션) 비중 — 분모는 샤드의 전체 stock 레코드 gross. */
export function corridorConcentration(
  records: readonly BilateralRecord[],
): CorridorConcentration {
  const all: number[] = []
  const obs: number[] = []
  for (const r of records) {
    if (r.measure !== 'stock') continue
    const v = Math.abs(r.value_usd)
    all.push(v)
    if (OBSERVED.has(r.confidence_grade)) obs.push(v)
  }
  const shareTop = (values: number[], n: number): [number, number] => {
    const gross = values.reduce((a, b) => a + b, 0)
    if (gross <= 0) return [0, 0]
    const top = values
      .sort((a, b) => b - a)
      .slice(0, n)
      .reduce((a, b) => a + b, 0)
    return [top / gross, gross]
  }
  const [top10, gross] = shareTop([...all], 10)
  const [top20] = shareTop([...all], 20)
  const [top10Obs, grossObs] = shareTop([...obs], 10)
  const [top20Obs] = shareTop([...obs], 20)
  return {
    top10_share: top10,
    top20_share: top20,
    gross_usd: gross,
    top10_share_obs: top10Obs,
    top20_share_obs: top20Obs,
    gross_obs_usd: grossObs,
  }
}
