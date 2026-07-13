/**
 * SYNOPTIC 사전 집계 계약 (TDD RED 선행): 순수 집계 함수의 산술 정확성 +
 * 생성된 meta/synoptic.json의 스키마 완전성. 대시보드는 이 파일 하나만
 * lazy-load 한다 — 65분기 샤드 순회 금지의 근거.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUT_DIR } from '../fetch/lib.ts'
import {
  ANOMALY_LIMIT,
  CORRIDOR_LIMIT,
  aggregateQuarter,
  topAnomalies,
  topCorridors,
  type BilateralRecord,
  type FlowRecord,
  type StockRecord,
} from './synoptic.ts'

const stock = (over: Partial<StockRecord>): StockRecord => ({
  country: 'KOR',
  asset: 'deposits',
  period: '2024-Q4',
  measure: 'stock',
  value_usd: 100,
  source_id: 'imf_iip',
  effective_date: '2024-12-31',
  confidence_grade: 'A',
  ...over,
})

const flow = (over: Partial<FlowRecord>): FlowRecord => ({
  country: 'KOR',
  asset: 'deposits',
  period: '2024-Q4',
  measure: 'flow',
  entry: 'assets',
  value_usd: 10,
  source_id: 'imf_bop',
  effective_date: '2024-12-31',
  confidence_grade: 'A',
  ...over,
})

describe('aggregateQuarter — 산술 정확성', () => {
  it('sums stock/flow/valuation per asset with observed(A/B)-only variants', () => {
    const cellMap = aggregateQuarter(
      [
        stock({ value_usd: 700, confidence_grade: 'A' }),
        stock({ country: 'USA', value_usd: 300, confidence_grade: 'E' }),
        stock({ asset: 'loans', value_usd: 50 }),
      ],
      [
        flow({ entry: 'assets', value_usd: 40 }), // resident outflow side
        flow({ entry: 'liabilities', value_usd: 90 }), // nonresident inflow side
        flow({ entry: 'liabilities', value_usd: -30, confidence_grade: 'D' }),
        flow({ measure: 'valuation', entry: 'assets', value_usd: -15, confidence_grade: 'C' }),
      ],
    )
    const dep = cellMap.cells.deposits
    expect(dep).toBeDefined()
    expect(dep?.stock).toBe(1000)
    expect(dep?.stock_obs).toBe(700) // E-grade 300 excluded
    expect(dep?.obs_share).toBeCloseTo(0.7)
    expect(dep?.flow_out).toBe(40)
    expect(dep?.flow_in).toBe(60) // 90 + (−30)
    expect(dep?.flow_in_obs).toBe(90) // D-grade −30 excluded
    expect(dep?.flow_gross).toBe(160) // |40|+|90|+|−30|
    expect(dep?.flow_gross_obs).toBe(130)
    expect(dep?.valuation).toBe(-15)
    expect(cellMap.cells.loans?.stock).toBe(50)
    // grade counts span both stocks and flows
    expect(cellMap.gradeMix).toEqual({ A: 4, C: 1, D: 1, E: 1 })
  })

  it('keeps obs_share in [0,1] even when nothing is observed', () => {
    const { cells } = aggregateQuarter(
      [stock({ confidence_grade: 'E', value_usd: 500 })],
      [],
    )
    expect(cells.deposits?.obs_share).toBe(0)
  })
})

describe('topCorridors — 정렬·상한·측정 분리', () => {
  it('splits by measure, sorts by |value| desc, caps at CORRIDOR_LIMIT', () => {
    const rows: BilateralRecord[] = []
    for (let i = 0; i < CORRIDOR_LIMIT + 5; i++) {
      rows.push({
        owner_country: 'KOR',
        issuer_country: `C${String(i).padStart(2, '0')}`,
        asset: 'listed_equity',
        period: '2024-Q4',
        measure: 'stock',
        value_usd: (i + 1) * 1e9,
        source_id: 'imf_pip',
        effective_date: '2024-12-31',
        confidence_grade: 'A',
      })
    }
    rows.push({
      owner_country: 'JPN',
      issuer_country: 'USA',
      asset: 'debt_securities',
      period: '2024-Q4',
      measure: 'flow',
      value_usd: -7e9,
      source_id: 'imf_pip',
      effective_date: '2024-12-31',
      confidence_grade: 'D',
      estimate_method: 'position_change_unadjusted',
      lower_bound: -9e9,
      upper_bound: -5e9,
    })
    const c = topCorridors(rows)
    expect(c.stock.length).toBe(CORRIDOR_LIMIT)
    expect(c.stock[0].value).toBe((CORRIDOR_LIMIT + 5) * 1e9)
    const sorted = [...c.stock].every(
      (r, i, a) => i === 0 || Math.abs(a[i - 1].value) >= Math.abs(r.value),
    )
    expect(sorted).toBe(true)
    expect(c.flow.length).toBe(1)
    expect(c.flow[0]).toMatchObject({
      owner: 'JPN',
      issuer: 'USA',
      grade: 'D',
      method: 'position_change_unadjusted',
      lower: -9e9,
      upper: -5e9,
    })
  })
})

describe('topAnomalies — 자산별 상한·계보 필드', () => {
  it('caps at ANOMALY_LIMIT per asset so filtered views are never empty-by-construction', () => {
    const rows = Array.from({ length: ANOMALY_LIMIT + 8 }, (_, i) =>
      flow({
        country: `C${String(i).padStart(2, '0')}`,
        value_usd: (i % 2 === 0 ? 1 : -1) * (i + 1) * 1e8,
        confidence_grade: i % 3 === 0 ? 'D' : 'A',
      }),
    )
    // 두 번째 자산군 — 자산별로 별도 상한을 가져야 한다
    for (let i = 0; i < 5; i++) {
      rows.push(flow({ asset: 'listed_equity', country: `E${i}`, value_usd: (i + 1) * 1e6 }))
    }
    // valuation records must not enter the anomaly bulletin
    rows.push(flow({ measure: 'valuation', value_usd: 9e15 }))
    const a = topAnomalies(rows)
    expect(a.filter((r) => r.asset === 'deposits').length).toBe(ANOMALY_LIMIT)
    expect(a.filter((r) => r.asset === 'listed_equity').length).toBe(5)
    // 전체 정렬: |value| 내림차순 (전역 표시는 UI가 앞에서 12개만 자른다)
    const sorted = a.every(
      (r, i, arr) => i === 0 || Math.abs(arr[i - 1].value) >= Math.abs(r.value),
    )
    expect(sorted).toBe(true)
    expect(Math.abs(a[0].value)).toBe((ANOMALY_LIMIT + 8) * 1e8)
    for (const row of a) {
      expect(row.grade).toMatch(/^[A-E]$/)
      expect(row.source_id).toBeTruthy()
      expect(row.effective_date).toBeTruthy()
    }
  })
})

describe('generated meta/synoptic.json — 스키마 완전성', () => {
  const path = join(OUT_DIR, 'meta', 'synoptic.json')
  const ASSETS = new Set([
    'deposits',
    'loans',
    'debt_securities',
    'listed_equity',
    'unlisted_equity_fdi',
    'funds',
    'reserves_gold',
    'residential_property',
    'commodities',
    'crypto',
  ])

  it('exists, is <5MB, and covers every stocks_owner period', () => {
    expect(existsSync(path), 'run `pnpm data:synoptic` first').toBe(true)
    const raw = readFileSync(path, 'utf8')
    expect(raw.length).toBeLessThan(5 * 1024 * 1024)
    const syn = JSON.parse(raw) as {
      periods: string[]
      per_quarter: Record<string, Record<string, { stock: number; obs_share: number }>>
      corridors: Record<string, { stock: unknown[]; flow: unknown[] }>
      anomalies: Record<string, Array<{ grade: string }>>
      grade_mix: Record<string, Record<string, number>>
    }
    const index = JSON.parse(
      readFileSync(join(OUT_DIR, 'index.json'), 'utf8'),
    ) as { periods: { stocks_owner: string[] } }
    for (const p of index.periods.stocks_owner) {
      expect(syn.periods, `period ${p}`).toContain(p)
      expect(syn.per_quarter[p], `per_quarter[${p}]`).toBeDefined()
    }
    for (const [p, cells] of Object.entries(syn.per_quarter)) {
      for (const [asset, cell] of Object.entries(cells)) {
        expect(ASSETS.has(asset), `${p}: unknown asset ${asset}`).toBe(true)
        expect(cell.obs_share).toBeGreaterThanOrEqual(0)
        expect(cell.obs_share).toBeLessThanOrEqual(1)
      }
    }
    for (const rows of Object.values(syn.anomalies)) {
      // 자산별 상한 12 — 자산군 수 × 12 이하
      expect(rows.length).toBeLessThanOrEqual(12 * 10)
      const byAsset = new Map<string, number>()
      for (const r of rows as Array<{ grade: string; asset: string }>) {
        expect(r.grade).toMatch(/^[A-E]$/)
        byAsset.set(r.asset, (byAsset.get(r.asset) ?? 0) + 1)
      }
      for (const [asset, n] of byAsset) {
        expect(n, `asset ${asset}`).toBeLessThanOrEqual(12)
      }
    }
  })

  it('matches a direct shard sum for a sample quarter (deposits, 2024-Q4)', () => {
    const syn = JSON.parse(readFileSync(path, 'utf8')) as {
      per_quarter: Record<string, Record<string, { stock: number }>>
    }
    const shard = JSON.parse(
      readFileSync(join(OUT_DIR, 'stocks_owner', '2024-Q4.json'), 'utf8'),
    ) as { records: Array<{ asset: string; value_usd: number }> }
    const direct = shard.records
      .filter((r) => r.asset === 'deposits')
      .reduce((s, r) => s + r.value_usd, 0)
    expect(syn.per_quarter['2024-Q4'].deposits.stock).toBeCloseTo(direct, 0)
  })
})
