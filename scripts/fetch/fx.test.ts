/**
 * FX 파이프라인 계약 (Phase L, TDD): IMF ER(XDC_USD·EOP_RT — 실호출 프로브로
 * 확정) 분기 환율 + WB PA.NUS.FCRF 연간 Q4 폴백. 규칙:
 * - IMF 보유국 = quarterly, grade A / WB-only = Q4만, grade B + method 명시
 * - 어느 쪽도 없으면 미제공(정직 공백 — 날조 금지), rate<=0/비유한 드랍
 * - 통화코드는 world-countries 매핑, 없으면 제외
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENCY_BY_ISO3, assembleFx } from './fx.ts'
import { OUT_DIR } from './lib.ts'
import type { FxRatesFile } from '../../src/types/data.ts'

describe('CURRENCY_BY_ISO3 — world-countries mapping', () => {
  it('maps major economies to ISO 4217 codes', () => {
    expect(CURRENCY_BY_ISO3.get('KOR')).toBe('KRW')
    expect(CURRENCY_BY_ISO3.get('USA')).toBe('USD')
    expect(CURRENCY_BY_ISO3.get('JPN')).toBe('JPY')
    expect(CURRENCY_BY_ISO3.get('DEU')).toBe('EUR')
  })
})

describe('assembleFx — 소스 우선순위·정직 공백', () => {
  const imf = [
    { iso3: 'KOR', quarter: '2024-Q3', rate: 1319.6 },
    { iso3: 'KOR', quarter: '2024-Q4', rate: 1470 },
  ]
  const wb = [
    { iso3: 'KOR', year: 2024, rate: 1364 }, // IMF 보유국 — 무시되어야 함
    { iso3: 'AFG', year: 2024, rate: 70.6 },
    { iso3: 'AFG', year: 2023, rate: 72.1 },
  ]

  it('IMF quarterly entries: grade A · imf_ifs_fx · quarter-end effective date', () => {
    const out = assembleFx(imf, wb, ['KOR', 'AFG', 'PRK'])
    const kor = out.countries.KOR
    expect(kor.currency).toBe('KRW')
    expect(kor.quarterly).toBe(true)
    expect(kor.rates['2024-Q4']).toMatchObject({
      rate: 1470,
      grade: 'A',
      source_id: 'imf_ifs_fx',
      effective_date: '2024-12-31',
    })
    // WB 값(1364)이 IMF 보유국을 오염시키지 않는다
    expect(Object.values(kor.rates).some((r) => r?.rate === 1364)).toBe(false)
  })

  it('WB-only country: Q4 entries · grade B · method disclosed', () => {
    const out = assembleFx(imf, wb, ['KOR', 'AFG'])
    const afg = out.countries.AFG
    expect(afg.quarterly).toBe(false)
    expect(afg.rates['2024-Q4']).toMatchObject({
      rate: 70.6,
      grade: 'B',
      source_id: 'wb_wdi',
      method: 'wb_pa_nus_fcrf_annual_rate_q4',
    })
    expect(afg.rates['2023-Q4']?.rate).toBe(72.1)
  })

  it('publishes currency-level median rates and a fixed USD rate', () => {
    const out = assembleFx(
      [
        { iso3: 'DEU', quarter: '2024-Q4', rate: 0.9 },
        { iso3: 'FRA', quarter: '2024-Q4', rate: 0.92 },
      ],
      [],
      ['DEU', 'FRA'],
    )
    expect(out.currencies.EUR.rates['2024-Q4']).toMatchObject({
      rate: 0.91,
      grade: 'A',
      observations: 2,
    })
    expect(out.currencies.USD.rates['2024-Q4']).toMatchObject({
      rate: 1,
      grade: 'A',
    })
  })

  it('no source → country absent (정직 공백), invalid rates dropped', () => {
    const out = assembleFx(
      [{ iso3: 'KOR', quarter: '2024-Q4', rate: 0 }],
      [{ iso3: 'PRK', year: 2024, rate: -1 }],
      ['KOR', 'PRK'],
    )
    expect(out.countries.KOR).toBeUndefined()
    expect(out.countries.PRK).toBeUndefined()
  })

  it('country outside the master list is ignored', () => {
    const out = assembleFx([{ iso3: 'ZZZ', quarter: '2024-Q4', rate: 5 }], [], ['KOR'])
    expect(out.countries.ZZZ).toBeUndefined()
  })
})

describe('generated meta/fx_rates.json — 실생성물 검증', () => {
  const path = join(OUT_DIR, 'meta', 'fx_rates.json')

  it('exists (pipeline has run)', () => {
    expect(existsSync(path)).toBe(true)
  })

  it('KOR quarterly A-grade series in a sane KRW/USD range', () => {
    const f = JSON.parse(readFileSync(path, 'utf8')) as FxRatesFile
    const kor = f.countries.KOR
    expect(kor.currency).toBe('KRW')
    expect(kor.quarterly).toBe(true)
    const entries = Object.values(kor.rates).filter((e) => e !== undefined)
    expect(entries.length).toBeGreaterThanOrEqual(40) // 2010→최신 분기 대부분
    for (const e of entries) {
      expect(e.rate).toBeGreaterThan(900)
      expect(e.rate).toBeLessThan(1700)
      expect(['A', 'B']).toContain(e.grade)
      expect(e.source_id).toBeTruthy()
      expect(e.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('coverage: ≥100 economies, every entry carries lineage', () => {
    const f = JSON.parse(readFileSync(path, 'utf8')) as FxRatesFile
    const isoList = Object.keys(f.countries)
    expect(isoList.length).toBeGreaterThanOrEqual(100)
    expect(f.base).toBe('USD')
    for (const iso of isoList) {
      const c = f.countries[iso]
      expect(c.currency).toMatch(/^[A-Z]{3}$/)
      for (const e of Object.values(c.rates)) {
        if (!e) continue
        expect(e.rate).toBeGreaterThan(0)
        if (e.grade === 'B') expect(e.method).toBeTruthy()
      }
    }
  })
})
