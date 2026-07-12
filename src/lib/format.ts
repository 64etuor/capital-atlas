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
