import { useTranslation } from 'react-i18next'
import { useViewStore } from '../store/viewStore'
import type { Basis, CurrencyView, MeasureType } from '../types/data'

interface DialOption<T extends string> {
  value: T
  abbr: string
}

interface DialProps<T extends string> {
  label: string
  options: readonly DialOption<T>[]
  value: T
  onChange: (value: T) => void
}

/**
 * 계기 다이얼 (DESIGN.md §5) — 접힌 상태는 mono 약어, hover/focus 시 좌측으로
 * 트레이 확장. 다이얼 면 클릭 = 다음 값으로 스텝(키보드 Enter 포함).
 */
function Dial<T extends string>({ label, options, value, onChange }: DialProps<T>) {
  const { t } = useTranslation()
  const idx = options.findIndex((o) => o.value === value)
  const current = options[idx]

  return (
    <div className="group relative flex items-center justify-end">
      {/* expanded tray */}
      <div className="pointer-events-none absolute right-full mr-2 flex items-center gap-px opacity-0 transition-opacity duration-140 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={opt.value === value}
            className={
              'dial-label whitespace-nowrap border-y border-paper/10 bg-ink-1/90 px-2.5 py-1.5 transition-colors duration-140 ' +
              (opt.value === value
                ? 'text-flow-in'
                : 'text-paper-dim hover:text-paper')
            }
          >
            {t(`cluster.opts.${opt.value}`)}
          </button>
        ))}
      </div>

      {/* dial face — click/Enter steps to the next value */}
      <button
        type="button"
        onClick={() => onChange(options[(idx + 1) % options.length].value)}
        aria-label={t('cluster.optionAria', { label, text: t(`cluster.opts.${current.value}`) })}
        className="w-16 border-y border-paper/10 bg-ink-1/70 py-2 text-center transition-colors duration-140 hover:bg-ink-2/80"
      >
        <span className="dial-label block text-[9px] text-paper-dim/70">
          {label}
        </span>
        <span className="readout mt-0.5 block text-[13px] tracking-[0.14em] text-paper">
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
  { value: 'usd_current', abbr: 'USD' },
  { value: 'usd_constant_fx', abbr: 'FXD' },
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

  return (
    <nav
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
