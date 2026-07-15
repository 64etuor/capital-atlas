import { useTranslation } from 'react-i18next'

interface ObservationLoaderProps {
  className?: string
  label?: string
  detail?: string
}

/**
 * Shared boot/data loader. The motion reads as an observatory instrument,
 * not a generic activity wheel, and collapses to a static reticle when the
 * user requests reduced motion.
 */
export function ObservationLoader({
  className = '',
  label,
  detail,
}: ObservationLoaderProps) {
  const { t } = useTranslation()
  const resolvedLabel = label ?? t('common.preparing')
  const resolvedDetail = detail ?? t('common.syncing')

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('common.loadingAria')}
      className={`flex flex-col items-center justify-center gap-3 ${className}`}
    >
      <div className="observation-loader" aria-hidden="true">
        <span
          data-loader-orbit="outer"
          className="observation-loader__orbit observation-loader__orbit--outer"
        />
        <span
          data-loader-orbit="inner"
          className="observation-loader__orbit observation-loader__orbit--inner"
        />
        <span className="observation-loader__reticle" />
        <span className="observation-loader__sweep" />
        <span className="observation-loader__core" />
      </div>
      <div className="text-center">
        <p className="dial-label text-paper-dim">{resolvedLabel}</p>
        <p className="readout mt-1 text-[10px] tracking-[0.16em] text-flow-out/60">
          {resolvedDetail}
        </p>
      </div>
    </div>
  )
}
