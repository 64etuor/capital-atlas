/**
 * Phase M (TDD): BIS LBS(위치기준 국제은행통계) — SDMX-CSV 파싱, 은행 회랑
 * 매핑(§5 중복 가드: IIP 총계 불변, bilateral 은행 채널만 추가), 멱등 병합.
 *
 * 실호출 프로브로 확정한 DSD (2026-07-13):
 *   dataflow BIS/WS_LBS_D_PUB/1.0, key 12차원
 *   Q.S.{C|L}.G.TO1.A.5J.A.{REP}.A.{CP}.N — S=잔액, G=loans and deposits,
 *   TO1=전통화, 5J=전체 모행 소재국, N=cross-border. UNIT_MULT=6 (백만 USD).
 */
import { describe, expect, it } from 'vitest'
import type { BilateralRecord } from '../../src/types/data.ts'
import { BIS_MIN_USD, parseLbsCsv, toBankRecords } from './bis.ts'
import { mergeBankCorridors } from '../build/bank_merge.ts'
import { sourceById } from './registry.ts'

const HEADER =
  'FREQ,L_MEASURE,L_POSITION,L_INSTR,L_DENOM,L_CURR_TYPE,L_PARENT_CTY,' +
  'L_REP_BANK_TYPE,L_REP_CTY,L_CP_SECTOR,L_CP_COUNTRY,L_POS_TYPE,DECIMALS,' +
  'UNIT_MEASURE,UNIT_MULT,AVAILABILITY,TITLE_GRP,TIME_FORMAT,COLLECTION,' +
  'ORG_VISIBILITY,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK'

const row = (
  pos: string,
  rep: string,
  cp: string,
  period: string,
  value: string,
) =>
  `Q,S,${pos},G,TO1,A,5J,A,${rep},A,${cp},N,3,USD,6,K,,,E,E,${period},${value},A,F,`

const ISO3 = new Map([
  ['KR', 'KOR'],
  ['US', 'USA'],
  ['JP', 'JPN'],
])

describe('parseLbsCsv — SDMX-CSV 파싱', () => {
  it('parses rows, scales by UNIT_MULT (millions → USD)', () => {
    const csv = [HEADER, row('C', 'KR', 'US', '2024-Q4', '47669.987')].join('\n')
    const rows = parseLbsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      position: 'C',
      rep2: 'KR',
      cp2: 'US',
      period: '2024-Q4',
    })
    expect(rows[0].valueUsd).toBeCloseTo(47_669_987_000, -3)
  })

  it('skips rows with empty or non-finite OBS_VALUE', () => {
    const csv = [
      HEADER,
      row('C', 'KR', 'US', '2024-Q3', ''),
      row('C', 'KR', 'US', '2024-Q4', 'NaN'),
      row('C', 'KR', 'US', '2025-Q1', '1.5'),
    ].join('\n')
    expect(parseLbsCsv(csv)).toHaveLength(1)
  })
})

describe('toBankRecords — 은행 회랑 매핑 (§5 중복 가드)', () => {
  it('maps claims → loans (owner=reporter) and liabilities → deposits (owner=counterparty)', () => {
    const rows = parseLbsCsv(
      [
        HEADER,
        row('C', 'KR', 'US', '2024-Q4', '47669.987'),
        row('L', 'KR', 'US', '2024-Q4', '14191.485'),
      ].join('\n'),
    )
    const recs = toBankRecords(rows, ISO3)
    expect(recs).toHaveLength(2)
    const claims = recs.find((r) => r.asset === 'loans')!
    expect(claims).toMatchObject({
      owner_country: 'KOR',
      issuer_country: 'USA',
      period: '2024-Q4',
      measure: 'stock',
      source_id: 'bis_lbs',
      confidence_grade: 'B',
      effective_date: '2024-12-31',
    })
    const deposits = recs.find((r) => r.asset === 'deposits')!
    // 예치자(상대국)가 보유자 — 방향 반전
    expect(deposits.owner_country).toBe('USA')
    expect(deposits.issuer_country).toBe('KOR')
    // 계기 매핑 주석: G(loans and deposits) 합산 상품을 포지션 방향으로 분류
    expect(claims.estimate_method).toMatch(/lbs/i)
  })

  it('drops aggregates, self-pairs, unknown iso2 and sub-threshold values', () => {
    const rows = parseLbsCsv(
      [
        HEADER,
        row('C', 'KR', '5A', '2024-Q4', '99999'), // aggregate cp
        row('C', 'KR', 'KR', '2024-Q4', '99999'), // self
        row('C', 'KR', 'XX', '2024-Q4', '99999'), // unknown iso2
        row('C', 'KR', 'US', '2024-Q4', '50'), // $50M < $100M prune
        row('C', 'KR', 'JP', '2024-Q4', '150'), // $150M keeps
      ].join('\n'),
    )
    const recs = toBankRecords(rows, ISO3)
    expect(recs).toHaveLength(1)
    expect(recs[0].issuer_country).toBe('JPN')
    expect(BIS_MIN_USD).toBe(100_000_000)
  })
})

describe('mergeBankCorridors — 멱등 병합', () => {
  const pip: BilateralRecord = {
    owner_country: 'KOR',
    issuer_country: 'USA',
    asset: 'listed_equity',
    period: '2024-Q4',
    measure: 'stock',
    value_usd: 1e9,
    source_id: 'imf_pip',
    effective_date: '2024-12-31',
    confidence_grade: 'A',
  }
  const oldBis: BilateralRecord = {
    ...pip,
    asset: 'loans',
    value_usd: 5e8,
    source_id: 'bis_lbs',
    confidence_grade: 'B',
  }
  const newBis: BilateralRecord = { ...oldBis, value_usd: 6e8 }

  it('replaces prior bis_lbs records without touching other sources', () => {
    const merged = mergeBankCorridors([pip, oldBis], [newBis])
    expect(merged).toHaveLength(2)
    expect(merged.find((r) => r.source_id === 'imf_pip')?.value_usd).toBe(1e9)
    expect(merged.find((r) => r.source_id === 'bis_lbs')?.value_usd).toBe(6e8)
  })

  it('is idempotent across repeated merges', () => {
    const once = mergeBankCorridors([pip, oldBis], [newBis])
    const twice = mergeBankCorridors(once, [newBis])
    expect(twice).toEqual(once)
  })
})

describe('registry — bis_lbs 분류', () => {
  it('registers bis_lbs as batch_official quarterly', () => {
    const s = sourceById.get('bis_lbs')
    expect(s?.collection_mode).toBe('batch_official')
    expect(s?.update_frequency).toBe('quarterly')
    expect(s?.license_note).toMatch(/BIS/i)
  })
})
