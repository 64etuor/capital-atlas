/**
 * data:changed 분류기 (Phase N) — 주간 크론의 커밋 게이트.
 * 타임스탬프-전용 변경(index.generated_at·sources.retrieved_at)과 실질 변경을
 * 구분한다: 실질 변경이 없으면 커밋하지 않는다(레포·배포 churn 0).
 */
import { describe, expect, it } from 'vitest'
import { classifyAll, classifyChange, type FileChange } from './changed.ts'

const j = (o: unknown) => JSON.stringify(o)

const change = (path: string, head: unknown, work: unknown): FileChange => ({
  path,
  head: head === null ? null : j(head),
  work: work === null ? null : j(work),
})

describe('classifyChange — 파일 단위 분류', () => {
  it('샤드 변경은 무조건 실질', () => {
    expect(
      classifyChange(change('stocks_owner/2026-Q1.json', { records: [1] }, { records: [2] })),
    ).toBe('substantive')
    expect(
      classifyChange(change('flows_bilateral/2024-Q4.json', null, { records: [] })),
    ).toBe('substantive')
    expect(
      classifyChange(change('station/KOR.json', { a: 1 }, { a: 2 })),
    ).toBe('substantive')
    expect(
      classifyChange(change('exposure/KOR.json', { currency: [] }, { currency: [1] })),
    ).toBe('substantive')
    expect(
      classifyChange(
        change('position_closure/2024-Q4.json', { assets: {} }, { assets: { debt: {} } }),
      ),
    ).toBe('substantive')
  })

  it('index.json: generated_at만 다르면 타임스탬프-전용', () => {
    const head = { generated_at: '2026-07-13T00:00:00Z', latest_quarter: '2026-Q1', periods: { a: [1] } }
    const work = { ...head, generated_at: '2026-07-14T05:17:00Z' }
    expect(classifyChange(change('index.json', head, work))).toBe('timestamp-only')
  })

  it('index.json: periods가 다르면 실질', () => {
    const head = { generated_at: '2026-07-13T00:00:00Z', latest_quarter: '2026-Q1', periods: { a: [1] } }
    const work = { generated_at: '2026-07-14T05:17:00Z', latest_quarter: '2026-Q2', periods: { a: [1, 2] } }
    expect(classifyChange(change('index.json', head, work))).toBe('substantive')
  })

  it('sources.json: retrieved_at만 다르면 타임스탬프-전용', () => {
    const head = [{ source_id: 'imf_iip', publisher: 'IMF', retrieved_at: '2026-07-13T00:00:00Z' }]
    const work = [{ source_id: 'imf_iip', publisher: 'IMF', retrieved_at: '2026-07-14T05:17:00Z' }]
    expect(classifyChange(change('meta/sources.json', head, work))).toBe('timestamp-only')
  })

  it('sources.json: 등록 소스가 달라지면 실질', () => {
    const head = [{ source_id: 'imf_iip', retrieved_at: '2026-07-13T00:00:00Z' }]
    const work = [
      { source_id: 'imf_iip', retrieved_at: '2026-07-14T00:00:00Z' },
      { source_id: 'new_src', retrieved_at: '2026-07-14T00:00:00Z' },
    ]
    expect(classifyChange(change('meta/sources.json', head, work))).toBe('substantive')
  })

  it('pipeline_report·global_crypto는 단독으로는 메타데이터(비실질)', () => {
    expect(
      classifyChange(change('meta/pipeline_report.json', { g: 1 }, { g: 2 })),
    ).toBe('metadata')
    expect(
      classifyChange(change('meta/global_crypto.json', { v: 1 }, { v: 2 })),
    ).toBe('metadata')
  })

  it('파싱 불가(비JSON) 변경은 안전하게 실질로 승격', () => {
    expect(
      classifyChange({ path: 'index.json', head: '{broken', work: '{}' }),
    ).toBe('substantive')
  })
})

describe('classifyAll — 집계', () => {
  it('실질 1건이라도 있으면 substantive에 노출', () => {
    const r = classifyAll([
      change('index.json',
        { generated_at: 'a', x: 1 },
        { generated_at: 'b', x: 1 }),
      change('stocks_owner/2026-Q1.json', { records: [1] }, { records: [2] }),
      change('meta/global_crypto.json', { v: 1 }, { v: 2 }),
    ])
    expect(r.substantive).toEqual(['stocks_owner/2026-Q1.json'])
    expect(r.timestampOnly).toEqual(['index.json'])
    expect(r.metadata).toEqual(['meta/global_crypto.json'])
  })

  it('타임스탬프·메타데이터뿐이면 substantive 빈 배열', () => {
    const r = classifyAll([
      change('index.json', { generated_at: 'a' }, { generated_at: 'b' }),
      change('meta/pipeline_report.json', { g: 1 }, { g: 2 }),
    ])
    expect(r.substantive).toEqual([])
  })
})
