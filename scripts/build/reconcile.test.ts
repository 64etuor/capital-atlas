/**
 * Phase P-2 — 미러 폐합 엔진(§12-3) 계약 테스트.
 * BIS LBS 양방향: A 보고 claims(A→B, loans) vs B 보고 liabilities(A→B, deposits)
 * 는 같은 경제 실체(A 거주자의 대B 은행 포지션)의 두 관측 — gap을 계산하되
 * 조정하지 않는다(§12 기록 정신). PIP 직접 관측은 단방향이라 독립 미러 불가이며,
 * v3 재구성 부채(C)를 직접 미러로 승격하지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUT_DIR } from '../fetch/lib.ts'
import { mirrorFromRecords, summarizeMirrors } from './reconcile.ts'
import type { BilateralRecord } from '../../src/types/data.ts'

const bank = (
  owner: string,
  issuer: string,
  asset: 'loans' | 'deposits',
  value: number,
): BilateralRecord => ({
  owner_country: owner,
  issuer_country: issuer,
  asset,
  period: '2024-Q4',
  measure: 'stock',
  value_usd: value,
  source_id: 'bis_lbs',
  effective_date: '2024-12-31',
  confidence_grade: 'B',
  estimate_method: 'lbs_loans_and_deposits_instrument_mapped_by_position_side',
})

describe('mirrorFromRecords — 양방향 쌍 구성', () => {
  it('pairs A-reported claims with B-reported liabilities on the same direction', () => {
    const pairs = mirrorFromRecords([
      bank('KOR', 'USA', 'loans', 100), // KOR 보고: 대미 claims
      bank('KOR', 'USA', 'deposits', 80), // USA 보고: 대KOR liabilities
    ])
    expect(pairs).toEqual([
      {
        owner: 'KOR',
        issuer: 'USA',
        claims_usd: 100,
        liabilities_usd: 80,
        gap_usd: 20,
        gap_share: 0.2,
      },
    ])
  })
  it('one-sided observations produce no pair (정직 공백)', () => {
    expect(mirrorFromRecords([bank('KOR', 'USA', 'loans', 100)])).toEqual([])
  })
  it('ignores non-bis records (CPIS는 단방향 — 미러 대상 아님)', () => {
    const cpis: BilateralRecord = {
      ...bank('KOR', 'USA', 'loans', 100),
      asset: 'listed_equity',
      source_id: 'imf_pip',
      confidence_grade: 'A',
    }
    expect(mirrorFromRecords([cpis, bank('KOR', 'USA', 'deposits', 80)])).toEqual([])
  })
  it('directions are independent pairs and output is deterministically sorted', () => {
    const pairs = mirrorFromRecords([
      bank('USA', 'KOR', 'loans', 50),
      bank('USA', 'KOR', 'deposits', 60),
      bank('KOR', 'USA', 'loans', 100),
      bank('KOR', 'USA', 'deposits', 80),
    ])
    expect(pairs.map((p) => `${p.owner}→${p.issuer}`)).toEqual([
      'KOR→USA',
      'USA→KOR',
    ])
    expect(pairs[1].gap_share).toBeCloseTo(10 / 60, 10)
  })
})

describe('summarizeMirrors — 분포 요약(조정 없음)', () => {
  it('computes median/quartiles of gap_share per period', () => {
    const s = summarizeMirrors(
      new Map([
        [
          '2024-Q4',
          [0.1, 0.2, 0.3, 0.4, 0.5].map((g, i) => ({
            owner: 'A' + i,
            issuer: 'B',
            claims_usd: 100,
            liabilities_usd: 100 * (1 - g),
            gap_usd: 100 * g,
            gap_share: g,
          })),
        ],
      ]),
    )
    expect(s.periods['2024-Q4'].pairs).toBe(5)
    expect(s.periods['2024-Q4'].median_gap_share).toBeCloseTo(0.3, 10)
    expect(s.periods['2024-Q4'].p25_gap_share).toBeCloseTo(0.2, 10)
    expect(s.periods['2024-Q4'].p75_gap_share).toBeCloseTo(0.4, 10)
  })
})

describe('generated artifacts — 실데이터 (커밋된 산출물 검증)', () => {
  it('reconciliation shards + meta summary exist and KOR↔USA mirror is present', () => {
    const meta = JSON.parse(
      readFileSync(join(OUT_DIR, 'meta', 'reconciliation.json'), 'utf8'),
    ) as {
      method: string
      periods: Record<string, { pairs: number; median_gap_share: number }>
    }
    expect(meta.method).toContain('lbs')
    const periods = Object.keys(meta.periods)
    expect(periods.length).toBeGreaterThan(30)
    const latest = periods.sort().at(-1)!
    expect(meta.periods[latest].pairs).toBeGreaterThan(100)
    // gap 중앙값은 관대 범위(BIS 문헌상 미러 gap은 수십% 가능) — 0 초과 90% 미만
    expect(meta.periods[latest].median_gap_share).toBeGreaterThan(0)
    expect(meta.periods[latest].median_gap_share).toBeLessThan(0.9)

    const shardPath = join(OUT_DIR, 'reconciliation', `${latest}.json`)
    expect(existsSync(shardPath)).toBe(true)
    const shard = JSON.parse(readFileSync(shardPath, 'utf8')) as {
      pairs: Array<{ owner: string; issuer: string; gap_share: number }>
    }
    const korUsa = shard.pairs.find(
      (p) =>
        (p.owner === 'KOR' && p.issuer === 'USA') ||
        (p.owner === 'USA' && p.issuer === 'KOR'),
    )
    expect(korUsa, 'KOR↔USA mirror pair should exist (both report)').toBeTruthy()
  })
})
