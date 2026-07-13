/**
 * money — CURR 다이얼(USD/LCU) 변환 계약 (Phase L, TDD):
 * - LCU는 국가 스코프에서만; 글로벌 집계는 통화 합산이 무의미 → 'global' 사유
 * - 환율 미보유국은 'nofx' 사유, 표시는 USD 폴백 (스토어 값은 불변)
 * - 변환은 분기별 환율(기말) × USD값 — 등급 왜곡 없는 산술
 * - 연간(WB Q4) 국가는 같은 해 Q4 환율을 분기에 적용(method로 공개)
 */
import { describe, expect, it } from 'vitest'
import {
  buildMoney,
  formatLcu,
  formatLcuNet,
  rateEntryFor,
} from './money'
import type { FxRatesFile, PeriodKey } from '../types/data'

const q = (s: string) => s as PeriodKey

const FX: FxRatesFile = {
  generated_at: '2026-07-13T00:00:00Z',
  base: 'USD',
  countries: {
    KOR: {
      currency: 'KRW',
      quarterly: true,
      rates: {
        '2024-Q4': {
          rate: 1470,
          grade: 'A',
          source_id: 'imf_ifs_fx',
          effective_date: '2024-12-31',
        },
        '2025-Q1': {
          rate: 1466.5,
          grade: 'A',
          source_id: 'imf_ifs_fx',
          effective_date: '2025-03-31',
        },
      },
    },
    AFG: {
      currency: 'AFN',
      quarterly: false,
      rates: {
        '2024-Q4': {
          rate: 70.6,
          grade: 'B',
          source_id: 'wb_wdi',
          effective_date: '2024-12-31',
          method: 'wb_pa_nus_fcrf_annual_rate_q4',
        },
      },
    },
  },
}

describe('formatLcu — 계기 구역 로케일 불변 표기 (Intl en-US compact 위임)', () => {
  it('pins Intl compact behavior for major currencies', () => {
    expect(formatLcu(2.74e12 * 1470, 'KRW')).toBe('₩4027.8T')
    expect(formatLcu(4.1e13, 'JPY')).toBe('¥41T')
    expect(formatLcu(1.23e12, 'EUR')).toBe('€1.23T')
  })
  it('uses the house minus sign (U+2212)', () => {
    expect(formatLcu(-5.03e11 * 1470, 'KRW')).toBe('−₩739.41T')
    expect(formatLcuNet(1000, 'KRW').startsWith('+')).toBe(true)
  })
})

describe('rateEntryFor — 분기 정확 조회 + 연간 Q4 폴백', () => {
  it('exact quarter wins', () => {
    expect(rateEntryFor(FX.countries.KOR, q('2024-Q4'))?.rate).toBe(1470)
  })
  it('annual-only country: same-year Q4 applied to other quarters', () => {
    expect(rateEntryFor(FX.countries.AFG, q('2024-Q2'))?.rate).toBe(70.6)
  })
  it('no rate for the year → null (정직 공백)', () => {
    expect(rateEntryFor(FX.countries.AFG, q('2019-Q2'))).toBeNull()
    expect(rateEntryFor(undefined, q('2024-Q4'))).toBeNull()
  })
})

describe('buildMoney — 스코프·가용성 게이트', () => {
  it('USD dial → identity formatting, no unavailability', () => {
    const m = buildMoney('usd', 'KOR', FX, 'country')
    expect(m.mode).toBe('usd')
    expect(m.unavailable).toBeNull()
    expect(m.fmtAt(2.74e12, q('2024-Q4'))).toBe('$2.74T')
  })

  it('LCU + country scope + fx entry → per-quarter conversion', () => {
    const m = buildMoney('lcu', 'KOR', FX, 'country')
    expect(m.mode).toBe('lcu')
    expect(m.code).toBe('KRW')
    expect(m.convertAt(2.74e12, q('2024-Q4'))).toBeCloseTo(2.74e12 * 1470)
    expect(m.fmtAt(2.74e12, q('2024-Q4'))).toBe('₩4027.8T')
    // 다른 분기는 그 분기 환율
    expect(m.convertAt(1e9, q('2025-Q1'))).toBeCloseTo(1.4665e12)
  })

  it('LCU + global scope → mixed-currency refusal, USD fallback', () => {
    const m = buildMoney('lcu', null, FX, 'global')
    expect(m.mode).toBe('usd')
    expect(m.unavailable).toBe('global')
    expect(m.fmtAt(1e12, q('2024-Q4'))).toBe('$1.00T')
  })

  it('LCU + no fx series → nofx refusal, USD fallback', () => {
    const m = buildMoney('lcu', 'PRK', FX, 'country')
    expect(m.mode).toBe('usd')
    expect(m.unavailable).toBe('nofx')
  })

  it('LCU + missing quarter rate → null conversion, em-dash display', () => {
    const m = buildMoney('lcu', 'KOR', FX, 'country')
    expect(m.convertAt(1e9, q('2010-Q1'))).toBeNull()
    expect(m.fmtAt(1e9, q('2010-Q1'))).toBe('—')
  })

  it('fxRows — 도시에 교정 시트용 FX RATE·USD VALUE 행', () => {
    const m = buildMoney('lcu', 'KOR', FX, 'country')
    const rows = m.fxRows(2.74e12, q('2024-Q4'))
    const flat = rows.map((r) => r.join('|')).join('\n')
    expect(flat).toContain('FX RATE')
    expect(flat).toContain('1470')
    expect(flat).toContain('KRW/USD')
    expect(flat).toContain('2024-12-31')
    expect(flat).toContain('imf_ifs_fx')
    expect(flat).toContain('USD VALUE')
    expect(flat).toContain('$2.74T')
    // USD 모드에선 빈 배열 — 도시에 오염 없음
    expect(buildMoney('usd', 'KOR', FX, 'country').fxRows(1, q('2024-Q4'))).toEqual([])
  })
})
