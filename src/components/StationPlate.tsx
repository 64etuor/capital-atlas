import { useTranslation } from 'react-i18next'
import { latestPeriod } from '../lib/periods'
import { useViewStore } from '../store/viewStore'
import { LOCALES, applyLocale, currentLocale } from '../i18n'

/** 뷰 코드는 계기 코드 — 로케일 불변 (UX_RESEARCH §3). */
const SURFACES = [
  { value: 'globe', label: 'GLOBE' },
  { value: 'synoptic', label: 'SYNOPTIC' },
  { value: 'station', label: 'STATION' },
] as const

/** 좌상 관측소 명판 — 워드마크 + 이중 시각 스탬프 + 관측 표면 전환 (§5).
 *  estimatedAsOf = 데이터 스냅샷 빈티지(index.generated_at); index 로드
 *  실패 시 null → 날짜를 지어내지 않고 '—'로 표시한다. */
export function StationPlate({
  estimatedAsOf,
}: {
  estimatedAsOf: string | null
}) {
  const { t } = useTranslation()
  const appView = useViewStore((s) => s.appView)
  const setAppView = useViewStore((s) => s.setAppView)
  const locale = currentLocale()
  return (
    <div className="pointer-events-none absolute left-6 top-5 z-10 select-none">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-[28px] leading-none tracking-wide text-paper">
          Capital <span className="italic">Atlas</span>
        </h1>
        <div
          role="group"
          aria-label={t('plate.localeAria')}
          className="pointer-events-auto flex gap-1"
        >
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={locale === l}
              onClick={() => applyLocale(l)}
              className={
                'dial-label px-1 py-0.5 transition-colors duration-140 ' +
                (locale === l
                  ? 'text-flow-in'
                  : 'text-paper-dim/60 hover:text-paper')
              }
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="readout mt-2 space-y-0.5 text-[11px] leading-tight text-paper-dim">
        <p>
          <span className="opacity-60">{t('plate.lastObs')}</span>{' '}
          {latestPeriod()}
        </p>
        <p>
          <span className="opacity-60">{t('plate.estimatedAsOf')}</span>{' '}
          {estimatedAsOf ?? '—'}
        </p>
      </div>
      <div
        role="group"
        data-tour="surfaces"
        aria-label={t('plate.surfaceAria')}
        className="pointer-events-auto mt-3 flex gap-px"
      >
        {SURFACES.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={appView === s.value}
            onClick={() => setAppView(s.value)}
            className={
              'dial-label border-y border-paper/10 bg-ink-1/70 px-2.5 py-1.5 transition-colors duration-140 ' +
              (appView === s.value
                ? 'text-flow-in'
                : 'text-paper-dim hover:text-paper')
            }
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
