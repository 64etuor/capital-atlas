/**
 * 숫자·기간 포맷 — 두 구역 규칙(UX_RESEARCH §4):
 * - 축·계기 리드아웃(밀도 구간): 로케일 불문 `$223.72T` mono (formatUsd*)
 * - 툴팁·도시에·프로즈(설명 구간): Intl 완전 로케일화 (*Prose) —
 *   ko 만/억/조 그룹핑은 Intl에 위임, K/M/B/T·조 하드코딩 금지,
 *   로케일 인자 없는 toLocaleString 금지.
 */
export type Locale = 'en' | 'ko'

const UNITS = [
  { v: 1e12, s: 'T' },
  { v: 1e9, s: 'B' },
  { v: 1e6, s: 'M' },
  { v: 1e3, s: 'K' },
] as const

/** Compact USD: $12.34T / $503B / −$1.2M. */
export function formatUsd(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '−' : ''
  const abs = Math.abs(value)
  for (const u of UNITS) {
    if (abs >= u.v) return `${sign}$${(abs / u.v).toFixed(digits)}${u.s}`
  }
  return `${sign}$${abs.toFixed(0)}`
}

/** Explicit sign for net readings: +$1.2B / −$430M / ±$0. */
export function formatUsdNet(value: number, digits = 1): string {
  if (!Number.isFinite(value) || value === 0) return '±$0'
  return (value > 0 ? '+' : '') + formatUsd(value, digits)
}

/** 프로즈 구간 USD — en "$223.72 trillion", ko "US$223.72조" (Intl 위임). */
export function formatUsdProse(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return '—'
  if (locale === 'en') {
    // ICU는 currency 스타일에서 compactDisplay:'long'을 무시(축약 강제) —
    // 숫자만 long-compact로 만들고 통화 기호를 조합한다.
    const n = new Intl.NumberFormat('en', {
      notation: 'compact',
      compactDisplay: 'long',
      maximumFractionDigits: 2,
    }).format(Math.abs(value))
    return `${value < 0 ? '−' : ''}$${n}`
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
}

/** 분기 코드 "2026-Q1"은 불변 — 프로즈에서만 en "Q1 2026" / ko "2026년 1분기". */
export function formatQuarterProse(period: string, locale: Locale): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(period)
  if (!m) return period
  return locale === 'ko' ? `${m[1]}년 ${m[2]}분기` : `Q${m[2]} ${m[1]}`
}

/** ISO 날짜 → 프로즈 (도시에 원값 표기는 ISO 유지 — 호출부 책임). */
export function formatDateProse(isoDate: string, locale: Locale): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return isoDate
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(d)
}
