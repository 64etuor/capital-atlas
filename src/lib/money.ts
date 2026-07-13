/**
 * CURR 다이얼(USD/LCU) 변환 계약 (Phase L).
 *
 * - LCU = 선택 국가의 현지통화. 변환 = USD값 × 그 분기 기말 환율(수학적으로
 *   정확 — 등급 왜곡 없음). 분기 환율이 없으면 같은 해 Q4(연간 폴백, method
 *   공개), 그것도 없으면 '—' (정직 공백).
 * - 글로벌 집계(WORLD/SYNOPTIC/choropleth)는 통화 합산이 무의미 → USD 고정
 *   ('global' 사유). 환율 미보유국은 'nofx' 사유. 두 경우 표시는 USD 폴백,
 *   스토어의 다이얼 값은 건드리지 않는다(내비게이션 간 의도 보존).
 * - 도시에(교정 시트)의 원값은 항상 USD — LCU 표시 수치는 fxRows()로
 *   FX RATE·LCU/USD VALUE 행을 계보에 병기한다(§1.5).
 */
import { useEffect, useState } from 'react'
import type {
  CurrencyView,
  FxCountry,
  FxRateEntry,
  FxRatesFile,
  PeriodKey,
} from '../types/data'
import { formatUsd, formatUsdNet } from './format'
import { getFxRates } from './dataClient'
import { useViewStore } from '../store/viewStore'

/** 계기 구역 LCU 표기 — 로케일 불변(Intl en-US compact 위임), U+2212 부호. */
export function formatLcu(display: number, code: string, digits = 2): string {
  if (!Number.isFinite(display)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    notation: 'compact',
    maximumFractionDigits: digits,
  })
    .format(display)
    .replace('-', '−')
}

export function formatLcuNet(display: number, code: string, digits = 1): string {
  if (!Number.isFinite(display) || display === 0)
    return `±${formatLcu(0, code, 0)}`
  return (display > 0 ? '+' : '') + formatLcu(display, code, digits)
}

/** 분기 정확 조회 → 같은 해 Q4(연간 국가) → null. */
export function rateEntryFor(
  country: FxCountry | undefined,
  period: PeriodKey,
): FxRateEntry | null {
  if (!country) return null
  const exact = country.rates[period]
  if (exact) return exact
  const q4 = country.rates[`${period.slice(0, 4)}-Q4` as PeriodKey]
  return q4 ?? null
}

export type MoneyUnavailable = 'global' | 'nofx' | null

export interface Money {
  /** 'lcu'일 때만 변환 활성 — 그 외 전부 USD 표시 */
  mode: 'usd' | 'lcu'
  code: string | null
  /** LCU 다이얼이 이 스코프에서 왜 죽어있는지 (회색+사유 hover 근거) */
  unavailable: MoneyUnavailable
  convertAt: (valueUsd: number, period: PeriodKey) => number | null
  fmtAt: (valueUsd: number, period: PeriodKey, digits?: number) => string
  fmtNetAt: (valueUsd: number, period: PeriodKey, digits?: number) => string
  /** 이미 변환된 수(차트 축·툴팁)의 표시 — mode에 맞는 통화 기호 */
  display: (value: number, digits?: number) => string
  displayNet: (value: number, digits?: number) => string
  /** LCU 표시 수치의 도시에 계보 행 — USD 모드에선 빈 배열 */
  fxRows: (valueUsd: number, period: PeriodKey) => Array<[string, string]>
}

export function buildMoney(
  currency: CurrencyView,
  iso3: string | null,
  fx: FxRatesFile | null,
  scope: 'country' | 'global',
): Money {
  const entry = iso3 && fx ? fx.countries[iso3] : undefined
  let unavailable: MoneyUnavailable = null
  if (currency === 'lcu') {
    if (scope === 'global' || iso3 === null) unavailable = 'global'
    else if (!entry) unavailable = 'nofx'
  }
  const active = currency === 'lcu' && unavailable === null && !!entry
  const code = active ? entry.currency : null

  const convertAt = (valueUsd: number, period: PeriodKey): number | null => {
    if (!active) return valueUsd
    const e = rateEntryFor(entry, period)
    return e ? valueUsd * e.rate : null
  }

  return {
    mode: active ? 'lcu' : 'usd',
    code,
    unavailable,
    convertAt,
    fmtAt: (v, period, digits = 2) => {
      if (!active) return formatUsd(v, digits)
      const c = convertAt(v, period)
      return c === null ? '—' : formatLcu(c, entry.currency, digits)
    },
    fmtNetAt: (v, period, digits = 1) => {
      if (!active) return formatUsdNet(v, digits)
      const c = convertAt(v, period)
      return c === null ? '—' : formatLcuNet(c, entry.currency, digits)
    },
    display: (v, digits = 2) =>
      active ? formatLcu(v, entry.currency, digits) : formatUsd(v, digits),
    displayNet: (v, digits = 1) =>
      active ? formatLcuNet(v, entry.currency, digits) : formatUsdNet(v, digits),
    fxRows: (valueUsd, period) => {
      if (!active) return []
      const e = rateEntryFor(entry, period)
      if (!e) return [['FX RATE', '— no rate for this quarter']]
      const c = valueUsd * e.rate
      return [
        [
          'FX RATE',
          `${e.rate} ${entry.currency}/USD · EOP ${e.effective_date} · ${e.source_id} (${e.grade})` +
            (e.method ? ` · ${e.method}` : ''),
        ],
        ['LCU VALUE', formatLcu(c, entry.currency)],
        ['USD VALUE', formatUsd(valueUsd)],
      ]
    },
  }
}

/** fx_rates.json 1회 로드 + 스토어 currency 구독 — 컴포넌트용. */
export function useMoney(iso3: string | null, scope: 'country' | 'global'): Money {
  const currency = useViewStore((s) => s.currency)
  const [fx, setFx] = useState<FxRatesFile | null>(null)
  useEffect(() => {
    let alive = true
    getFxRates()
      .then((f) => {
        if (alive) setFx(f)
      })
      .catch(() => {
        /* LCU 다이얼이 nofx로 죽을 뿐 — USD 표시는 무영향 */
      })
    return () => {
      alive = false
    }
  }, [])
  return buildMoney(currency, iso3, fx, scope)
}
