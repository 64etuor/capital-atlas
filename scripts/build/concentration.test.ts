/**
 * CONCENTRATION 집계 계약 (TDD RED 선행) — 초안 §14의 집중도 지표:
 * 상대국 HHI(전체 bilateral에서 계산, top-15 리스트 기반 금지), 상위 5 비중,
 * 자산 구성 비중, share_of_world. 생성 파일 검증은 독립 재계산과 대조한다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUT_DIR } from '../fetch/lib.ts'
import type { BilateralRecord } from './synoptic.ts'
import type { StationSeries } from './station.ts'
import {
  corridorConcentration,
  counterpartyConcentration,
  hhiOf,
  quarterlyConcentration,
} from './concentration.ts'

const readOut = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(OUT_DIR, rel), 'utf8')) as T

const rec = (
  owner: string,
  issuer: string,
  asset: string,
  value: number,
  grade: 'A' | 'B' | 'C' | 'D' | 'E' = 'A',
  measure: 'stock' | 'flow' = 'stock',
): BilateralRecord => ({
  owner_country: owner,
  issuer_country: issuer,
  asset,
  period: '2024-Q4',
  measure,
  value_usd: value,
  source_id: 'imf_pip',
  effective_date: '2024-12-31',
  confidence_grade: grade,
})

describe('hhiOf — 알려진 분포', () => {
  it('완전 독점 = 1, 균등 n개 = 1/n', () => {
    expect(hhiOf([42])).toBeCloseTo(1, 12)
    expect(hhiOf([5, 5, 5, 5])).toBeCloseTo(0.25, 12)
    expect(hhiOf([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBeCloseTo(0.1, 12)
  })
  it('비균등 분포와 빈 배열', () => {
    expect(hhiOf([3, 1])).toBeCloseTo(0.625, 12) // 0.75² + 0.25²
    expect(hhiOf([])).toBe(0)
  })
})

describe('counterpartyConcentration — 상대국 집중도', () => {
  const bilat = [
    rec('KOR', 'USA', 'listed_equity', 60),
    rec('KOR', 'USA', 'debt_securities', 20, 'B'), // 같은 상대국, 다른 자산 → 합산
    rec('KOR', 'JPN', 'listed_equity', 20),
    rec('KOR', 'DEU', 'listed_equity', 5, 'A', 'flow'), // 파생 flow는 제외
    rec('USA', 'KOR', 'listed_equity', 999), // 타 owner 제외 (holders 방향 아님)
  ]
  const entries = counterpartyConcentration(bilat, 'KOR')

  it('all 스코프: 상대국 단위로 합산 후 HHI/top5', () => {
    const all = entries.find((e) => e.period === '2024-Q4' && e.scope === 'all')
    expect(all).toBeDefined()
    expect(all!.gross_usd).toBeCloseTo(100, 9)
    expect(all!.n_partners).toBe(2) // USA(80)+JPN(20) — DEU flow 제외
    expect(all!.hhi).toBeCloseTo(0.8 * 0.8 + 0.2 * 0.2, 12)
    expect(all!.top5_share).toBeCloseTo(1, 12)
    expect(all!.top5[0]).toMatchObject({ country: 'USA' })
    expect(all!.top5[0].share).toBeCloseTo(0.8, 12)
    expect(all!.grade).toBe('B') // 구성 레코드 worst
  })

  it('자산 스코프가 분리 계산된다', () => {
    const eq = entries.find(
      (e) => e.scope === 'listed_equity' && e.period === '2024-Q4',
    )
    expect(eq!.hhi).toBeCloseTo(0.75 * 0.75 + 0.25 * 0.25, 12)
    const debt = entries.find((e) => e.scope === 'debt_securities')
    expect(debt!.hhi).toBeCloseTo(1, 12)
  })

  it('산식 문구에 업스트림 프루닝($100M) 한계를 명시한다', () => {
    for (const e of entries) expect(e.method).toMatch(/\$100M/)
  })
})

describe('quarterlyConcentration — 세계 대비·자산 구성 비중', () => {
  const P = '2024-Q4'
  const pt = (stock: number, grade: 'A' | 'C' = 'A') => ({
    period: P,
    stock,
    grade,
    flow_in: 0,
    flow_out: 0,
    valuation: 0,
    source_id: 'imf_iip',
  })
  const country: StationSeries = {
    deposits: [pt(30)],
    loans: [pt(10, 'C')],
  }
  const world: StationSeries = {
    deposits: [pt(100)],
    loans: [pt(100)],
  }
  const [q] = quarterlyConcentration(country, world)

  it('share_of_world = 국가 총액 ÷ 세계 총액', () => {
    expect(q.period).toBe(P)
    expect(q.share_of_world).toBeCloseTo(40 / 200, 12)
    expect(q.share_of_world_assets.deposits).toBeCloseTo(0.3, 12)
    expect(q.share_of_world_assets.loans).toBeCloseTo(0.1, 12)
  })
  it('asset_shares 합 = 1, 등급 = 구성 worst', () => {
    expect(q.asset_shares.deposits).toBeCloseTo(0.75, 12)
    expect(q.asset_shares.loans).toBeCloseTo(0.25, 12)
    const sum = Object.values(q.asset_shares).reduce(
      (a: number, b) => a + (b ?? 0),
      0,
    )
    expect(sum).toBeCloseTo(1, 9)
    expect(q.grade).toBe('C')
  })
})

describe('corridorConcentration — 상위 회랑 비중', () => {
  it('top10/top20 비중과 관측-한정 변형', () => {
    const recs = Array.from({ length: 30 }, (_, i) =>
      rec('C' + i, 'USA', 'listed_equity', 30 - i, i % 2 ? 'D' : 'A'),
    )
    const c = corridorConcentration(recs)
    const gross = recs.reduce((a, r) => a + Math.abs(r.value_usd), 0)
    expect(c.gross_usd).toBeCloseTo(gross, 9)
    expect(c.top10_share).toBeLessThanOrEqual(c.top20_share)
    expect(c.top20_share).toBeLessThanOrEqual(1)
    expect(c.top10_share_obs).toBeLessThanOrEqual(1)
    expect(c.gross_obs_usd).toBeLessThan(gross)
  })
})

// ------------------------------------------------- 생성 파일 (regen 후 GREEN) ----

interface CpEntry {
  period: string
  scope: string
  hhi: number
  top5_share: number
  gross_usd: number
}
interface StationConc {
  concentration: {
    quarterly: Array<{
      period: string
      share_of_world: number
      asset_shares: Record<string, number>
    }>
    counterparty: CpEntry[]
  }
}

describe('생성 파일 — station/{KOR,WLD}.json + synoptic.json', () => {
  it('KOR counterparty(all, 2024-Q4)가 샤드 독립 재계산과 일치한다', () => {
    const { concentration } = readOut<StationConc>('station/KOR.json')
    const entry = concentration.counterparty.find(
      (e) => e.period === '2024-Q4' && e.scope === 'all',
    )
    expect(entry).toBeDefined()
    // 독립 재계산 — 프루닝된 발행 샤드 전체(top-15 리스트 아님)에서
    const shard = readOut<{ records: BilateralRecord[] }>(
      'flows_bilateral/2024-Q4.json',
    )
    const byIssuer = new Map<string, number>()
    for (const r of shard.records) {
      if (r.owner_country !== 'KOR' || r.measure !== 'stock') continue
      byIssuer.set(
        r.issuer_country,
        (byIssuer.get(r.issuer_country) ?? 0) + Math.abs(r.value_usd),
      )
    }
    const values = [...byIssuer.values()]
    const gross = values.reduce((a, b) => a + b, 0)
    const hhi = values.reduce((a, v) => a + (v / gross) ** 2, 0)
    const top5 =
      values.sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0) /
      gross
    expect(entry!.hhi).toBeCloseTo(hhi, 9)
    expect(entry!.top5_share).toBeCloseTo(top5, 9)
    expect(entry!.gross_usd).toBeCloseTo(gross, 3)
  })

  it('KOR quarterly: 자산 비중 합=1, 세계 비중 ∈ (0,1)', () => {
    const { concentration } = readOut<StationConc>('station/KOR.json')
    const latest = concentration.quarterly.at(-1)!
    const sum = Object.values(latest.asset_shares).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 6)
    expect(latest.share_of_world).toBeGreaterThan(0)
    expect(latest.share_of_world).toBeLessThan(1)
  })

  it('WLD: share_of_world = 1(전 분기), counterparty는 비어 있다', () => {
    const { concentration } = readOut<StationConc>('station/WLD.json')
    expect(concentration.quarterly.length).toBeGreaterThan(0)
    for (const q of concentration.quarterly)
      expect(q.share_of_world).toBeCloseTo(1, 9)
    expect(concentration.counterparty).toHaveLength(0)
  })

  it('synoptic: 셀 share 합=1(분기당), corridor_concentration 재계산 일치', () => {
    const syn = readOut<{
      per_quarter: Record<string, Record<string, { stock: number; share: number }>>
      corridor_concentration: Record<
        string,
        { top10_share: number; top20_share: number; gross_usd: number }
      >
    }>('meta/synoptic.json')
    const cells = Object.values(syn.per_quarter['2024-Q4'])
    const shareSum = cells.reduce((a, c) => a + c.share, 0)
    expect(shareSum).toBeCloseTo(1, 6)

    const cc = syn.corridor_concentration['2024-Q4']
    const shard = readOut<{ records: BilateralRecord[] }>(
      'flows_bilateral/2024-Q4.json',
    )
    const stocks = shard.records
      .filter((r) => r.measure === 'stock')
      .map((r) => Math.abs(r.value_usd))
      .sort((a, b) => b - a)
    const gross = stocks.reduce((a, b) => a + b, 0)
    const top20 = stocks.slice(0, 20).reduce((a, b) => a + b, 0)
    expect(cc.gross_usd).toBeCloseTo(gross, 3)
    expect(cc.top20_share).toBeCloseTo(top20 / gross, 9)
    expect(cc.top10_share).toBeLessThanOrEqual(cc.top20_share)
  })
})
