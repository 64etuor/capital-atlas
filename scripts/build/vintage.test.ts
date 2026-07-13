/**
 * 빈티지 다이제스트 (Phase N, 초안 §10 이중 시간) — 실질 변경 커밋마다 스냅샷의
 * 경량 요약을 보존해, IMF/WB의 소급 개정을 도시에 REVISIONS 행에서 추적한다.
 * 184MB 전체 복사가 아니라 (basis,country,asset) 최신분기 값+등급 다이제스트.
 */
import { describe, expect, it } from 'vitest'
import {
  buildVintageDigest,
  lookupVintage,
  type VintageInput,
} from './vintage.ts'
import type { PeriodKey, StockRecord } from '../../src/types/data.ts'

const rec = (
  country: string,
  asset: string,
  period: string,
  value: number,
  grade = 'A',
): StockRecord =>
  ({
    country,
    asset,
    period,
    measure: 'stock',
    value_usd: value,
    source_id: 'imf_iip',
    effective_date: `${period.slice(0, 4)}-12-31`,
    confidence_grade: grade,
  }) as unknown as StockRecord

const input = (): VintageInput => ({
  index: {
    generated_at: '2026-07-13T11:34:00.000Z',
    latest_quarter: '2026-Q1' as PeriodKey,
    periods: {
      stocks_owner: ['2025-Q4', '2026-Q1'] as PeriodKey[],
      stocks_issuer: ['2025-Q4'] as PeriodKey[],
      stocks_location: ['2025-Q4'] as PeriodKey[],
      flows_country: ['2026-Q1'] as PeriodKey[],
      flows_bilateral: ['2025-Q4'] as PeriodKey[],
    },
  },
  stocksByBasis: {
    owner: [
      rec('KOR', 'listed_equity', '2025-Q4', 900),
      rec('KOR', 'listed_equity', '2026-Q1', 966),
      rec('KOR', 'deposits', '2025-Q4', 80, 'B'), // 2026-Q1 결측 — 희소 허용
      rec('USA', 'listed_equity', '2026-Q1', 15000),
    ],
    issuer: [rec('KOR', 'listed_equity', '2025-Q4', 2500)],
    location: [rec('KOR', 'residential_property', '2025-Q4', 7000, 'E')],
  },
  flowIntensity: [
    { period: '2025-Q4' as PeriodKey, gross_flow_usd: 111 },
    { period: '2026-Q1' as PeriodKey, gross_flow_usd: 222 },
  ],
})

describe('buildVintageDigest', () => {
  it('빈티지 날짜 = index.generated_at의 날짜부', () => {
    expect(buildVintageDigest(input()).vintage).toBe('2026-07-13')
  })

  it('(basis,country,asset)별 최신 관측 분기를 담는다 — 희소 허용', () => {
    const d = buildVintageDigest(input())
    expect(d.stocks.owner.KOR.listed_equity).toEqual({ p: '2026-Q1', v: 966, g: 'A' })
    expect(d.stocks.owner.KOR.deposits).toEqual({ p: '2025-Q4', v: 80, g: 'B' })
    expect(d.stocks.location.KOR.residential_property.g).toBe('E')
  })

  it('국가 총계 = 그 basis의 최신 분기에 존재하는 레코드 합', () => {
    const d = buildVintageDigest(input())
    // owner 최신 = 2026-Q1: KOR은 listed_equity 966만 관측(2026-Q1 예금 결측)
    expect(d.totals.owner.KOR).toEqual({ p: '2026-Q1', v: 966 })
    expect(d.totals.owner.USA).toEqual({ p: '2026-Q1', v: 15000 })
    // issuer 최신 = 2025-Q4
    expect(d.totals.issuer.KOR).toEqual({ p: '2025-Q4', v: 2500 })
  })

  it('글로벌 요약 = owner 최신 분기 합 + 자산별 분해', () => {
    const d = buildVintageDigest(input())
    expect(d.global.total_usd).toBe(966 + 15000)
    expect(d.global.per_asset.listed_equity).toBe(966 + 15000)
  })

  it('flow_intensity 시계열을 (p,v)로 축약 보존', () => {
    const d = buildVintageDigest(input())
    expect(d.flow_intensity).toEqual([
      { p: '2025-Q4', v: 111 },
      { p: '2026-Q1', v: 222 },
    ])
  })

  it('결정론 — 동일 입력 2회 = 동일 직렬화 (타임스탬프 없음)', () => {
    const a = JSON.stringify(buildVintageDigest(input()))
    const b = JSON.stringify(buildVintageDigest(input()))
    expect(a).toBe(b)
    expect(a).not.toContain('generated_at')
  })
})

describe('lookupVintage — 도시에 REVISIONS 조회', () => {
  it('총계 키와 자산 키를 분기 일치 조건으로 찾는다', () => {
    const d = buildVintageDigest(input())
    expect(
      lookupVintage(d, { basis: 'owner', country: 'KOR', asset: 'total', period: '2026-Q1' as PeriodKey }),
    ).toEqual({ p: '2026-Q1', v: 966 })
    expect(
      lookupVintage(d, { basis: 'owner', country: 'KOR', asset: 'listed_equity', period: '2026-Q1' as PeriodKey }),
    ).toEqual({ p: '2026-Q1', v: 966, g: 'A' })
    // 분기 불일치 = 비교 불가 → null (다른 분기 값을 개정으로 오인 금지)
    expect(
      lookupVintage(d, { basis: 'owner', country: 'KOR', asset: 'listed_equity', period: '2025-Q4' as PeriodKey }),
    ).toBeNull()
    // 미추적 키 → null
    expect(
      lookupVintage(d, { basis: 'owner', country: 'FRA', asset: 'total', period: '2026-Q1' as PeriodKey }),
    ).toBeNull()
  })
})
