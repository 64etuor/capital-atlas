import { useTranslation } from 'react-i18next'

interface ObservationLoaderProps {
  className?: string
  label?: string
  detail?: string
  variant?: 'full' | 'compact' | 'inline'
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
  variant = 'full',
}: ObservationLoaderProps) {
  const { t } = useTranslation()
  const resolvedLabel = label ?? t('common.preparing')
  const resolvedDetail = detail ?? t('common.syncing')
  const layout =
    variant === 'full'
      ? 'flex flex-col items-center justify-center gap-3'
      : variant === 'compact'
        ? 'flex items-center gap-2.5'
        : 'inline-flex items-center align-middle'

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${resolvedLabel} — ${resolvedDetail}`}
      className={`${layout} ${className}`}
    >
      <div
        data-loader-variant={variant}
        className={`observation-loader observation-loader--${variant}`}
        aria-hidden="true"
      >
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
      {variant !== 'inline' && (
        <div className={variant === 'full' ? 'text-center' : 'text-left'}>
          <p
            className={
              variant === 'full'
                ? 'dial-label text-paper-dim'
                : 'readout text-[9px] tracking-[0.12em] text-paper-dim'
            }
          >
            {resolvedLabel}
          </p>
          {variant === 'full' && (
            <p className="readout mt-1 text-[10px] tracking-[0.16em] text-flow-out/60">
              {resolvedDetail}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
