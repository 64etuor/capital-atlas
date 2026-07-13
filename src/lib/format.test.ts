/**
 * 포맷 2구역 계약(UX_RESEARCH §4): 계기 구간은 로케일 불변 mono,
 * 프로즈 구간은 Intl 위임(ko 조/억 그룹핑 하드코딩 금지).
 * 프로즈 단언은 ICU 버전 간 안정성을 위해 포함(contains) 기준.
 */
import { describe, expect, it } from 'vitest'
import {
  formatDateProse,
  formatQuarterProse,
  formatUsd,
  formatUsdNet,
  formatUsdProse,
} from './format'

describe('instrument zone — locale-invariant mono', () => {
  it('formatUsd compacts with T/B/M/K regardless of locale', () => {
    expect(formatUsd(223.72e12)).toBe('$223.72T')
    expect(formatUsd(503.2e9, 1)).toBe('$503.2B')
    expect(formatUsd(-1.2e6, 1)).toBe('−$1.2M')
    expect(formatUsd(Number.NaN)).toBe('—')
  })
  it('formatUsdNet carries an explicit sign', () => {
    expect(formatUsdNet(1.5e12)).toBe('+$1.5T')
    expect(formatUsdNet(0)).toBe('±$0')
  })
})

describe('prose zone — full Intl localization', () => {
  it('en prose spells the unit out', () => {
    const s = formatUsdProse(223.72e12, 'en')
    expect(s).toContain('trillion')
    expect(s).toContain('223.72')
  })
  it('ko prose uses 만/억/조 grouping via Intl (no hardcoded units)', () => {
    const s = formatUsdProse(223.72e12, 'ko')
    expect(s).toContain('조')
    const b = formatUsdProse(5.03e11, 'ko')
    expect(b).toContain('억') // 5030억
  })
  it('negative values keep the locale sign', () => {
    expect(formatUsdProse(-1.2e9, 'en')).toContain('billion')
  })
  it('quarter codes stay codes; prose localizes', () => {
    expect(formatQuarterProse('2026-Q1', 'en')).toBe('Q1 2026')
    expect(formatQuarterProse('2026-Q1', 'ko')).toBe('2026년 1분기')
    expect(formatQuarterProse('garbage', 'ko')).toBe('garbage')
  })
  it('dates localize with a fixed UTC frame', () => {
    expect(formatDateProse('2026-03-31', 'en')).toContain('2026')
    expect(formatDateProse('2026-03-31', 'ko')).toContain('2026')
    expect(formatDateProse('not-a-date', 'ko')).toBe('not-a-date')
  })
})
