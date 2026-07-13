import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewStore } from '../store/viewStore'
import { getFxRates } from '../lib/dataClient'
import type { Basis, CurrencyView, FxRatesFile, MeasureType } from '../types/data'

interface DialOption<T extends string> {
  value: T
  abbr: string
}

interface DialProps<T extends string> {
  label: string
  options: readonly DialOption<T>[]
  value: T
  onChange: (value: T) => void
  /** 사용 불가 옵션 → 사유 (회색+hover 사유 — OECD 패턴, 숨기지 않는다) */
  disabledValues?: Partial<Record<T, string>>
}

/**
 * 계기 다이얼 (DESIGN.md §5) — 접힌 상태는 mono 약어, hover/focus 시 좌측으로
 * 트레이 확장. 다이얼 면 클릭 = 다음 "가용" 값으로 스텝(키보드 Enter 포함).
 */
function Dial<T extends string>({
  label,
  options,
  value,
  onChange,
  disabledValues,
}: DialProps<T>) {
  const { t } = useTranslation()
  const idx = options.findIndex((o) => o.value === value)
  const current = options[idx]
  const currentReason = disabledValues?.[current.value]
  const step = () => {
    for (let i = 1; i <= options.length; i++) {
      const next = options[(idx + i) % options.length]
      if (!disabledValues?.[next.value]) {
        if (next.value !== value) onChange(next.value)
        return
      }
    }
  }

  return (
    <div className="group relative flex items-center justify-end">
      {/* expanded tray */}
      <div className="pointer-events-none absolute right-full mr-2 flex items-center gap-px opacity-0 transition-opacity duration-140 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        {options.map((opt) => {
          const reason = disabledValues?.[opt.value]
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => !reason && onChange(opt.value)}
              aria-pressed={opt.value === value}
              aria-disabled={!!reason}
              title={reason}
              className={
                'dial-label whitespace-nowrap border-y border-paper/10 bg-ink-1/90 px-2.5 py-1.5 transition-colors duration-140 ' +
                (reason
                  ? 'cursor-not-allowed text-paper-dim/40'
                  : opt.value === value
                    ? 'text-flow-in'
                    : 'text-paper-dim hover:text-paper')
              }
            >
              {t(`cluster.opts.${opt.value}`)}
            </button>
          )
        })}
      </div>

      {/* dial face — click/Enter steps to the next available value */}
      <button
        type="button"
        onClick={step}
        title={currentReason}
        aria-label={t('cluster.optionAria', { label, text: t(`cluster.opts.${current.value}`) })}
        className="w-16 border-y border-paper/10 bg-ink-1/70 py-2 text-center transition-colors duration-140 hover:bg-ink-2/80"
      >
        <span className="dial-label block text-[9px] text-paper-dim/70">
          {label}
        </span>
        <span
          className={
            'readout mt-0.5 block text-[13px] tracking-[0.14em] ' +
            (currentReason ? 'text-paper-dim/40' : 'text-paper')
          }
        >
          {current.abbr}
        </span>
      </button>
    </div>
  )
}

const BASIS: readonly DialOption<Basis>[] = [
  { value: 'owner', abbr: 'OWN' },
  { value: 'issuer', abbr: 'ISS' },
  { value: 'location', abbr: 'LOC' },
]

const MEASURE: readonly DialOption<MeasureType>[] = [
  { value: 'stock', abbr: 'STK' },
  { value: 'flow', abbr: 'FLW' },
  { value: 'valuation', abbr: 'VAL' },
  { value: 'turnover', abbr: 'TRN' },
]

const CURRENCY: readonly DialOption<CurrencyView>[] = [
  { value: 'usd', abbr: 'USD' },
  { value: 'lcu', abbr: 'LCU' },
]

type EstimateView = 'obs' | 'est'
const ESTIMATES: readonly DialOption<EstimateView>[] = [
  { value: 'est', abbr: 'EST+' },
  { value: 'obs', abbr: 'OBS' },
]

/** 우측 계기 클러스터 — basis · measure · currency · estimates 수직 스택. */
export function InstrumentCluster() {
  const { t } = useTranslation()
  const reportOpen = useViewStore(
    (s) => s.selectedCountry !== null && s.appView === 'globe',
  )
  const basis = useViewStore((s) => s.basis)
  const measure = useViewStore((s) => s.measure)
  const currency = useViewStore((s) => s.currency)
  const includeEstimates = useViewStore((s) => s.includeEstimates)
  const setBasis = useViewStore((s) => s.setBasis)
  const setMeasure = useViewStore((s) => s.setMeasure)
  const setCurrency = useViewStore((s) => s.setCurrency)
  const toggleEstimates = useViewStore((s) => s.toggleEstimates)

  // LCU 가용성 (Phase L): 국가 스코프 + 환율 시계열 보유국에서만.
  // 불가 시 회색+사유 — 숨기지 않는다(OECD 패턴). 스토어 값은 보존.
  const appView = useViewStore((s) => s.appView)
  const selectedCountry = useViewStore((s) => s.selectedCountry)
  const [fx, setFx] = useState<FxRatesFile | null>(null)
  useEffect(() => {
    let alive = true
    getFxRates()
      .then((f) => {
        if (alive) setFx(f)
      })
      .catch(() => {
        /* nofx 사유로 표시될 뿐 — USD 표시는 무영향 */
      })
    return () => {
      alive = false
    }
  }, [])
  const countryScope = appView !== 'synoptic' && selectedCountry !== null
  const lcuReason = !countryScope
    ? t('cluster.lcuMixed')
    : fx && !fx.countries[selectedCountry]
      ? t('cluster.lcuNoFx')
      : fx
        ? undefined
        : t('cluster.lcuNoFx')
  const currencyDisabled: Partial<Record<CurrencyView, string>> | undefined =
    lcuReason ? { lcu: lcuReason } : undefined

  return (
    <nav
      data-tour="cluster"
      aria-label={t('cluster.aria')}
      className={
        'absolute top-1/2 z-30 flex -translate-y-1/2 flex-col gap-3 pr-4 transition-[right] duration-280 ease-(--ease-baro) ' +
        // slide clear of the observation report so the dials stay reachable
        (reportOpen ? 'right-[420px]' : 'right-0')
      }
    >
      <Dial label={t('cluster.labels.basis')} options={BASIS} value={basis} onChange={setBasis} />
      <Dial
        label={t('cluster.labels.measure')}
        options={MEASURE}
        value={measure}
        onChange={setMeasure}
      />
      <Dial
        label={t('cluster.labels.currency')}
        options={CURRENCY}
        value={currency}
        onChange={setCurrency}
        disabledValues={currencyDisabled}
      />
      <Dial
        label={t('cluster.labels.estimates')}
        options={ESTIMATES}
        value={includeEstimates ? 'est' : 'obs'}
        onChange={(v) => {
          if ((v === 'est') !== includeEstimates) toggleEstimates()
        }}
      />
    </nav>
  )
}
