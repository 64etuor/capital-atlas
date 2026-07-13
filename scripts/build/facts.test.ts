/**
 * Phase P-1 — 정본 사실 테이블(§11.2 축소) 계약 테스트.
 * 평탄화 스키마, 결정론(gzip 포함 바이트 동일), 실데이터 표본 왕복,
 * 요약(facts_summary)과 원 샤드의 정합.
 */
import { gunzipSync } from 'node:zlib'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUT_DIR } from '../fetch/lib.ts'
import {
  bilateralFact,
  buildFactsNdjson,
  flowFact,
  gzipDeterministic,
  stockFact,
} from './facts.ts'
import type {
  BilateralRecord,
  FlowRecord,
  StockRecord,
} from '../../src/types/data.ts'

const stock: StockRecord = {
  country: 'KOR',
  asset: 'listed_equity',
  period: '2024-Q4',
  measure: 'stock',
  value_usd: 123,
  source_id: 'imf_iip',
  effective_date: '2024-12-31',
  confidence_grade: 'A',
}
const flow: FlowRecord = {
  country: 'KOR',
  asset: 'deposits',
  period: '2024-Q4',
  measure: 'flow',
  entry: 'assets',
  value_usd: -5,
  source_id: 'imf_bop',
  effective_date: '2024-12-31',
  confidence_grade: 'A',
}
const bilateral: BilateralRecord = {
  owner_country: 'KOR',
  issuer_country: 'USA',
  asset: 'loans',
  period: '2024-Q4',
  measure: 'stock',
  value_usd: 9,
  source_id: 'bis_lbs',
  effective_date: '2024-12-31',
  confidence_grade: 'B',
  estimate_method: 'lbs_loans_and_deposits_instrument_mapped_by_position_side',
}

describe('fact line shapes — §11.2 축소 스키마', () => {
  it('stocks fact carries table/basis and full lineage', () => {
    expect(stockFact('owner', stock)).toEqual({
      table: 'stocks',
      basis: 'owner',
      country: 'KOR',
      asset: 'listed_equity',
      period: '2024-Q4',
      measure: 'stock',
      value_usd: 123,
      source_id: 'imf_iip',
      effective_date: '2024-12-31',
      confidence_grade: 'A',
    })
  })
  it('flow fact keeps BPM6 entry side', () => {
    expect(flowFact(flow)).toMatchObject({
      table: 'flows_country',
      entry: 'assets',
      measure: 'flow',
      value_usd: -5,
    })
  })
  it('bilateral fact keeps owner/issuer and estimate_method', () => {
    expect(bilateralFact(bilateral)).toMatchObject({
      table: 'flows_bilateral',
      owner_country: 'KOR',
      issuer_country: 'USA',
      estimate_method:
        'lbs_loans_and_deposits_instrument_mapped_by_position_side',
    })
  })
  it('optional lineage fields are omitted, not null', () => {
    const line = stockFact('owner', stock)
    expect('estimate_method' in line).toBe(false)
    expect('lower_bound' in line).toBe(false)
  })
})

describe('determinism — N1 규율 (gzip 포함)', () => {
  it('same input → byte-identical ndjson and gzip', () => {
    const lines = [stockFact('owner', stock), flowFact(flow)]
    const a = buildFactsNdjson(lines)
    const b = buildFactsNdjson(lines)
    expect(a).toBe(b)
    const ga = gzipDeterministic(Buffer.from(a))
    const gb = gzipDeterministic(Buffer.from(b))
    expect(ga.equals(gb)).toBe(true)
    expect(gunzipSync(ga).toString()).toBe(a)
  })
})

describe('generated artifact — 정합 게이트 (커밋된 산출물 검증)', () => {
  const gzPath = join(OUT_DIR, 'facts.ndjson.gz')
  const summaryPath = join(OUT_DIR, 'meta', 'facts_summary.json')

  it('facts.ndjson.gz and facts_summary.json exist', () => {
    expect(existsSync(gzPath)).toBe(true)
    expect(existsSync(summaryPath)).toBe(true)
  })

  it('summary counts equal the actual gzip line counts and shard sums', () => {
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as {
      records: number
      by_table: Record<string, number>
    }
    const text = gunzipSync(readFileSync(gzPath)).toString()
    const lines = text.split('\n').filter(Boolean)
    expect(lines.length).toBe(summary.records)

    // 표본 왕복: 첫/마지막 라인은 유효 JSON + 스키마 필드 보유
    const first = JSON.parse(lines[0]) as Record<string, unknown>
    const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
    for (const l of [first, last]) {
      expect(l.table).toBeTruthy()
      expect(l.period).toMatch(/^\d{4}-Q[1-4]$/)
      expect(typeof l.value_usd).toBe('number')
      expect(l.source_id).toBeTruthy()
      expect(l.confidence_grade).toMatch(/^[A-E]$/)
    }

    // 원 샤드 대조 표본: stocks_owner 총 레코드 수 = by_table 기여분과 정합
    const ownerDir = join(OUT_DIR, 'stocks_owner')
    const ownerCount = JSON.parse(
      readFileSync(join(OUT_DIR, 'index.json'), 'utf8'),
    ).periods.stocks_owner.reduce(
      (s: number, p: string) =>
        s +
        (
          JSON.parse(
            readFileSync(join(ownerDir, `${p}.json`), 'utf8'),
          ) as { records: unknown[] }
        ).records.length,
      0,
    )
    const ownerFacts = lines.filter((l) =>
      l.startsWith('{"table":"stocks","basis":"owner"'),
    ).length
    expect(ownerFacts).toBe(ownerCount)
  })
})
