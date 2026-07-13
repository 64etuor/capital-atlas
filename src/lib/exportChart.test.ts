/**
 * I-1 차트 내보내기 — 순수 로직 TDD: 출처 표기 라인 조립(IMF attribution ·
 * WB CC BY-4.0 의무 이행 지점), CSV 직렬화(RFC4180 이스케이프 + 메타 주석),
 * 파일명 규약. PNG 캔버스 합성은 DOM 의존이라 playwright에서 검증한다.
 */
import { describe, expect, it } from 'vitest'
import {
  buildAttributionLine,
  csvFilename,
  serializeCsv,
} from './exportChart'

const SRC = (publisher: string, license_note: string, retrieved_at: string) => ({
  publisher,
  license_note,
  retrieved_at,
})

describe('buildAttributionLine — 표기 의무 이행', () => {
  it('joins publishers with license notes and the latest retrieved date', () => {
    const line = buildAttributionLine([
      SRC('IMF', 'IMF terms — attribution', '2026-07-12T14:50:27.178Z'),
      SRC('World Bank', 'CC BY-4.0', '2026-07-12T14:50:27.178Z'),
    ])
    expect(line).toBe(
      'Source: IMF (IMF terms — attribution) · World Bank (CC BY-4.0) — capital-atlas · retrieved 2026-07-12',
    )
  })

  it('dedupes repeated publishers, keeping first license note and input order', () => {
    const line = buildAttributionLine([
      SRC('IMF', 'IMF terms — attribution', '2026-07-10T00:00:00Z'),
      SRC('IMF', 'IMF terms (long form)', '2026-07-12T00:00:00Z'),
      SRC('World Bank', 'CC BY-4.0', '2026-07-11T00:00:00Z'),
    ])
    expect(line).toBe(
      'Source: IMF (IMF terms — attribution) · World Bank (CC BY-4.0) — capital-atlas · retrieved 2026-07-12',
    )
  })

  it('falls back to a bare capital-atlas line when no sources resolve', () => {
    expect(buildAttributionLine([])).toBe('capital-atlas')
  })
})

describe('serializeCsv — RFC4180 + 메타 주석', () => {
  it('emits # meta lines, a header row and data rows', () => {
    const csv = serializeCsv({
      meta: { Source: 'IMF BOP', Grade: 'A', Generated: '2026-07-13' },
      columns: [
        { key: 'period', label: 'period' },
        { key: 'flow_in', label: 'flow_in_usd' },
      ],
      rows: [
        { period: '2024-Q4', flow_in: 1000 },
        { period: '2025-Q1', flow_in: null },
      ],
    })
    expect(csv.split('\n')).toEqual([
      '# Source: IMF BOP',
      '# Grade: A',
      '# Generated: 2026-07-13',
      'period,flow_in_usd',
      '2024-Q4,1000',
      '2025-Q1,',
    ])
  })

  it('escapes commas, quotes and newlines per RFC4180', () => {
    const csv = serializeCsv({
      meta: {},
      columns: [
        { key: 'a', label: 'label,with,commas' },
        { key: 'b', label: 'plain' },
      ],
      rows: [{ a: 'he said "hi"', b: 'two\nlines' }],
    })
    expect(csv.split('\n').slice(0, 1)).toEqual(['"label,with,commas",plain'])
    expect(csv).toContain('"he said ""hi""","two\nlines"')
  })

  it('renders numbers without locale formatting', () => {
    const csv = serializeCsv({
      meta: {},
      columns: [{ key: 'v', label: 'v' }],
      rows: [{ v: 1234567.89 }],
    })
    expect(csv).toContain('1234567.89')
    expect(csv).not.toContain('1,234,567')
  })
})

describe('csvFilename — 규약 파일명', () => {
  it('follows capital-atlas_{country}_{asset}_{period}.csv', () => {
    expect(csvFilename('KOR', 'listed_equity', '2026-Q1')).toBe(
      'capital-atlas_KOR_listed_equity_2026-Q1.csv',
    )
  })
  it('sanitizes unsafe characters', () => {
    expect(csvFilename('W/LD', 'all assets', '2026-Q1')).toBe(
      'capital-atlas_W-LD_all-assets_2026-Q1.csv',
    )
  })
})
