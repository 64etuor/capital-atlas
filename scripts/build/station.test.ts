/**
 * STATION 사전 집계 계약 (TDD RED 선행): 국가별 시계열(잔액·양측 흐름·
 * 평가변동·D/E 신뢰구간 밴드), CPIS 양방향 상대국, 세계 집계(WLD),
 * 생성 파일의 스키마·산술 정합. STATION 뷰는 국가당 파일 하나만 로드한다.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUT_DIR } from '../fetch/lib.ts'
import type { BilateralRecord, FlowRecord, StockRecord } from './synoptic.ts'
import {
  PARTNER_LIMIT,
  stationPartners,
  stationSeries,
  stationSummary,
  worldSeries,
  type StationPoint,
} from './station.ts'

const stock = (over: Partial<StockRecord>): StockRecord => ({
  country: 'KOR',
  asset: 'deposits',
  period: '2024-Q3',
  measure: 'stock',
  value_usd: 100,
  source_id: 'imf_iip',
  effective_date: '2024-09-30',
  confidence_grade: 'A',
  ...over,
})

const flow = (over: Partial<FlowRecord>): FlowRecord => ({
  country: 'KOR',
  asset: 'deposits',
  period: '2024-Q3',
  measure: 'flow',
  entry: 'assets',
  value_usd: 10,
  source_id: 'imf_bop',
  effective_date: '2024-09-30',
  confidence_grade: 'A',
  ...over,
})

const bilat = (over: Partial<BilateralRecord>): BilateralRecord => ({
  owner_country: 'KOR',
  issuer_country: 'USA',
  asset: 'listed_equity',
  period: '2024-Q4',
  measure: 'stock',
  value_usd: 1e9,
  source_id: 'imf_pip',
  effective_date: '2024-12-31',
  confidence_grade: 'A',
  ...over,
})

describe('stationSeries — 국가 시계열 조립', () => {
  it('merges owner stock, issuer parallel, flows and valuation per period, sorted asc', () => {
    const series = stationSeries(
      [
        stock({ period: '2024-Q4', value_usd: 900 }),
        stock({ period: '2024-Q3', value_usd: 800 }),
        stock({ asset: 'loans', period: '2024-Q4', value_usd: 55 }),
      ],
      [stock({ period: '2024-Q4', value_usd: 1200, confidence_grade: 'B' })],
      [
        flow({ period: '2024-Q4', entry: 'assets', value_usd: 40 }),
        flow({ period: '2024-Q4', entry: 'liabilities', value_usd: 90 }),
        flow({
          period: '2024-Q4',
          measure: 'valuation',
          entry: 'assets',
          value_usd: -15,
          confidence_grade: 'C',
        }),
      ],
    )
    const dep = series.deposits
    expect(dep?.map((p) => p.period)).toEqual(['2024-Q3', '2024-Q4'])
    const q4 = dep?.[1] as StationPoint
    expect(q4.stock).toBe(900)
    expect(q4.grade).toBe('A')
    expect(q4.source_id).toBe('imf_iip') // §1.5 — 점 단위 계보 운반
    expect(q4.stock_issuer).toBe(1200)
    expect(q4.issuer_grade).toBe('B')
    expect(q4.flow_out).toBe(40)
    expect(q4.flow_in).toBe(90)
    expect(q4.flow_grade).toBe('A')
    expect(q4.valuation).toBe(-15)
    // Q3: no flows observed that quarter
    expect(dep?.[0].flow_in).toBe(0)
    expect(dep?.[0].flow_grade).toBeUndefined()
    expect(series.loans?.[0].stock).toBe(55)
  })

  it('creates a flow-only point when a quarter has flows but no stock record', () => {
    const series = stationSeries(
      [],
      [],
      [flow({ period: '2023-Q1', entry: 'liabilities', value_usd: 70 })],
    )
    const p = series.deposits?.[0] as StationPoint
    expect(p.period).toBe('2023-Q1')
    expect(p.stock).toBe(0)
    expect(p.flow_in).toBe(70)
    expect(p.grade).toBe('A') // falls back to the flow grade
    expect(p.source_id).toBe('imf_bop') // lineage falls back with it
  })

  it('carries D/E confidence bands and omits them for observed grades', () => {
    const series = stationSeries(
      [
        stock({
          period: '2025-Q1',
          value_usd: 500,
          confidence_grade: 'D',
          estimate_method: 'rollforward',
          lower_bound: 400,
          upper_bound: 600,
        }),
        stock({ period: '2024-Q4', value_usd: 480 }),
      ],
      [],
      [],
    )
    const [obs, est] = series.deposits as StationPoint[]
    expect(obs.stock_lower).toBeUndefined()
    expect(obs.stock_upper).toBeUndefined()
    expect(est.grade).toBe('D')
    expect(est.stock_lower).toBe(400)
    expect(est.stock_upper).toBe(600)
    expect(est.method).toBe('rollforward')
    expect(obs.method).toBeUndefined()
  })
})

describe('stationPartners — CPIS 양방향 상대국', () => {
  it('splits holdings (owner=me) vs holders (issuer=me), sorts by |value|, caps per side', () => {
    const rows: BilateralRecord[] = []
    for (let i = 0; i < PARTNER_LIMIT + 4; i++) {
      rows.push(
        bilat({ issuer_country: `H${String(i).padStart(2, '0')}`, value_usd: (i + 1) * 1e8 }),
      )
    }
    rows.push(bilat({ owner_country: 'USA', issuer_country: 'KOR', value_usd: 3e9, confidence_grade: 'A' }))
    rows.push(bilat({ owner_country: 'JPN', issuer_country: 'KOR', value_usd: 1e9 }))
    // derived flow records must NOT enter the partner matrix (positions only)
    rows.push(bilat({ measure: 'flow', issuer_country: 'DEU', value_usd: 9e12, confidence_grade: 'D' }))
    const partners = stationPartners(rows, 'KOR')
    const entry = partners['2024-Q4']
    expect(entry).toBeDefined()
    const eq = entry.assets.listed_equity
    expect(eq?.holdings.length).toBe(PARTNER_LIMIT)
    expect(eq?.holdings[0].value).toBe((PARTNER_LIMIT + 4) * 1e8)
    expect(eq?.holders.map((p) => p.country)).toEqual(['USA', 'JPN'])
    expect(eq?.holders[0]).toMatchObject({
      grade: 'C',
      method: 'counterparty_assets_transposed_to_reconstructed_liability',
      lower: 0,
      upper: 4e9,
    })
    expect(eq?.holdings[0].grade).toBe('A')
    expect(eq?.holdings.some((p) => p.country === 'DEU')).toBe(false)
  })

  it('aggregates the ALL pseudo-asset across assets with worst-grade honesty', () => {
    const partners = stationPartners(
      [
        bilat({ value_usd: 5e9 }),
        bilat({ asset: 'debt_securities', value_usd: 2e9, confidence_grade: 'C', estimate_method: 'mirror' }),
        bilat({ issuer_country: 'GBR', value_usd: 1e9 }),
      ],
      'KOR',
    )
    const all = partners['2024-Q4'].all
    expect(all.holdings[0]).toMatchObject({ country: 'USA', value: 7e9, grade: 'C' })
    expect(all.holdings[1]).toMatchObject({ country: 'GBR', value: 1e9, grade: 'A' })
  })
})

describe('worldSeries — WLD 집계', () => {
  it('sums country series per asset/period with value-weighted obs_share', () => {
    const kor = stationSeries([stock({ value_usd: 700 })], [], [
      flow({ entry: 'liabilities', value_usd: 50 }),
    ])
    const usa = stationSeries(
      [stock({ country: 'USA', value_usd: 300, confidence_grade: 'E', estimate_method: 'residual', lower_bound: 200, upper_bound: 400 })],
      [],
      [],
    )
    const wld = worldSeries([kor, usa])
    const p = wld.deposits?.[0] as StationPoint
    expect(p.stock).toBe(1000)
    expect(p.flow_in).toBe(50)
    expect(p.obs_share).toBeCloseTo(0.7)
    // mapped aggregate grade is honest about the estimated share
    expect(p.grade).toBe('C')
  })
})

describe('stationSummary — 최신 스냅샷', () => {
  it('reports latest period, totals, composition and stock-weighted obs share', () => {
    const series = stationSeries(
      [
        stock({ period: '2024-Q4', value_usd: 600 }),
        stock({ period: '2024-Q3', value_usd: 550 }),
        stock({ asset: 'loans', period: '2024-Q4', value_usd: 400, confidence_grade: 'E', estimate_method: 'residual' }),
      ],
      [],
      [
        flow({ period: '2024-Q4', entry: 'liabilities', value_usd: 80 }),
        flow({ period: '2024-Q4', entry: 'assets', value_usd: 30 }),
      ],
    )
    const s = stationSummary(series)
    expect(s.latest).toBe('2024-Q4')
    expect(s.first).toBe('2024-Q3')
    expect(s.stock_total).toBe(1000)
    expect(s.flow_in).toBe(80)
    expect(s.flow_out).toBe(30)
    expect(s.composition.deposits).toBe(600)
    expect(s.composition.loans).toBe(400)
    expect(s.obs_share).toBeCloseTo(0.6)
    expect(s.n_points).toBe(3)
  })
})

describe('generated station/ files — 산술·스키마 정합', () => {
  const stationDir = join(OUT_DIR, 'station')
  const idxPath = join(stationDir, 'index.json')

  it('index lists countries incl. KOR/USA and every listed file exists under 5MB', () => {
    expect(existsSync(idxPath), 'run `pnpm data:station` first').toBe(true)
    const idx = JSON.parse(readFileSync(idxPath, 'utf8')) as {
      countries: string[]
    }
    expect(idx.countries).toContain('KOR')
    expect(idx.countries).toContain('USA')
    expect(idx.countries).not.toContain('WLD') // WLD is implicit, not a country
    for (const iso of [...idx.countries.slice(0, 3), 'KOR', 'USA']) {
      const p = join(stationDir, `${iso}.json`)
      expect(existsSync(p), p).toBe(true)
      expect(statSync(p).size).toBeLessThan(5 * 1024 * 1024)
    }
    expect(existsSync(join(stationDir, 'WLD.json'))).toBe(true)
  })

  it('KOR deposits 2024-Q4 stock matches the shard record exactly', () => {
    const kor = JSON.parse(
      readFileSync(join(stationDir, 'KOR.json'), 'utf8'),
    ) as { series: { deposits?: StationPoint[] } }
    const shard = JSON.parse(
      readFileSync(join(OUT_DIR, 'stocks_owner', '2024-Q4.json'), 'utf8'),
    ) as { records: Array<{ country: string; asset: string; value_usd: number }> }
    const direct = shard.records.find(
      (r) => r.country === 'KOR' && r.asset === 'deposits',
    )?.value_usd
    const point = kor.series.deposits?.find((p) => p.period === '2024-Q4')
    expect(direct).toBeDefined()
    expect(point?.stock).toBe(direct)
  })

  it('WLD deposits stock cross-checks against synoptic per_quarter (same shards)', () => {
    const wld = JSON.parse(
      readFileSync(join(stationDir, 'WLD.json'), 'utf8'),
    ) as { series: { deposits?: StationPoint[] } }
    const syn = JSON.parse(
      readFileSync(join(OUT_DIR, 'meta', 'synoptic.json'), 'utf8'),
    ) as { per_quarter: Record<string, Record<string, { stock: number }>> }
    const point = wld.series.deposits?.find((p) => p.period === '2024-Q4')
    expect(point?.stock).toBeCloseTo(syn.per_quarter['2024-Q4'].deposits.stock, 0)
  })
})
