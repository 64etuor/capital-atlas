/**
 * A deliberately narrow live-market overlay. It never mutates the official
 * quarter, country allocation, or snapshot vintage; it is a global control
 * total with a visible non-statistical label and a bounded refresh lifetime.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getGlobalCrypto } from '../lib/dataClient'
import { formatUsd } from '../lib/format'
import {
  LIVE_REFRESH_INTERVAL_MS,
  MAX_SCHEDULED_REFRESHES,
  loadLiveCrypto,
  parseCommittedCrypto,
  type CryptoNowcastReading,
} from '../lib/nowcast'
import { useViewStore } from '../store/viewStore'

export function NowcastStrip() {
  const { t } = useTranslation()
  const openDossier = useViewStore((state) => state.openDossier)
  const [reading, setReading] = useState<CryptoNowcastReading | null>(null)

  useEffect(() => {
    let alive = true
    let scheduledRefreshes = 0
    const controller = new AbortController()
    const fallbackPromise = getGlobalCrypto()
      .then(parseCommittedCrypto)
      .catch(() => null)

    void fallbackPromise.then((fallback) => {
      if (!alive || fallback === null) return
      setReading((current) => (current?.state === 'live' ? current : fallback))
    })

    const poll = async () => {
      try {
        const live = await loadLiveCrypto(controller.signal)
        if (alive) setReading(live)
      } catch {
        const fallback = await fallbackPromise
        if (alive && fallback !== null) setReading(fallback)
      }
    }
    void poll()
    const timer = setInterval(() => {
      if (!alive || scheduledRefreshes >= MAX_SCHEDULED_REFRESHES) {
        clearInterval(timer)
        return
      }
      scheduledRefreshes += 1
      void poll()
      if (scheduledRefreshes >= MAX_SCHEDULED_REFRESHES) clearInterval(timer)
    }, LIVE_REFRESH_INTERVAL_MS)

    return () => {
      alive = false
      controller.abort()
      clearInterval(timer)
    }
  }, [])

  const stateLabel =
    reading?.state === 'live'
      ? 'LIVE MARKET · NOT OFFICIAL STATISTICS · B'
      : reading?.state === 'fallback'
        ? 'SNAPSHOT FALLBACK · NOT OFFICIAL STATISTICS · B'
        : 'MARKET OVERLAY UNAVAILABLE · NO NUMBER'

  return (
    <aside
      aria-live="polite"
      aria-label={t('nowcast.aria')}
      className="absolute left-1/2 top-6 z-[12] w-[min(540px,44vw)] -translate-x-1/2 border-y border-paper/10 bg-ink-0/55 px-3 py-1"
    >
      {reading ? (
        <button
          type="button"
          onClick={() =>
            openDossier({
              title: 'Global crypto market capitalisation',
              subtitle: `${stateLabel} · ${reading.as_of}`,
              value_usd: reading.value_usd,
              grade: 'B',
              effective_date: reading.as_of.slice(0, 10),
              retrieved_at: reading.retrieved_at,
              source_ids: [reading.source_id],
              context: [
                ['Status', stateLabel],
                ['As of', reading.as_of],
                ['Scope', 'global control total only'],
                ['Country allocation', 'none — not inferred'],
                ['Official statistics', 'no — market API observation'],
              ],
            })
          }
          className="readout flex w-full items-baseline justify-between gap-4 text-left text-[9px] tracking-[0.08em] text-paper-dim transition-[color,transform] duration-140 hover:text-paper active:translate-y-px"
        >
          <span className="truncate">GLOBAL CRYPTO CAP · {stateLabel}</span>
          <span className="shrink-0 tabular-nums text-paper">
            {formatUsd(reading.value_usd, 2)}
          </span>
        </button>
      ) : (
        <p className="readout text-[9px] tracking-[0.08em] text-paper-dim/60">
          GLOBAL CRYPTO CAP · {stateLabel}
        </p>
      )}
    </aside>
  )
}
