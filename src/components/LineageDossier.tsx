import { useEffect, useState } from 'react'
import { useViewStore } from '../store/viewStore'
import { getSources } from '../lib/dataClient'
import { formatUsd } from '../lib/format'
import { fogAlpha } from '../lib/tokens'
import type { SourceRegistryEntry } from '../types/data'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-paper/8 py-1.5 first:border-t-0">
      <dt className="dial-label w-24 shrink-0 text-paper-dim/70">{label}</dt>
      <dd className="readout min-w-0 flex-1 text-[11px] leading-snug text-paper">
        {children}
      </dd>
    </div>
  )
}

/**
 * 계보 도시에 — "교정 증명서" (DESIGN.md §5). Every number opens here:
 * source, method, confidence, range, dates. §1.5 made concrete.
 */
export function LineageDossier() {
  // store keeps the last payload through the slide-out transition
  const payload = useViewStore((s) => s.dossier)
  const open = useViewStore((s) => s.dossierOpen)
  const closeDossier = useViewStore((s) => s.closeDossier)
  const [sources, setSources] = useState<Map<string, SourceRegistryEntry>>(
    () => new Map(),
  )

  useEffect(() => {
    getSources().then(setSources).catch(() => {
      /* dossier still renders source_ids raw if the registry fails */
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDossier()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeDossier])

  if (!payload) return null
  const fog = fogAlpha(payload.grade)
  const resolved = payload.source_ids.map((id) => sources.get(id) ?? null)
  const firstSource = resolved.find((s) => s !== null) ?? null

  return (
    <section
      role="dialog"
      aria-label="Data lineage"
      aria-hidden={!open}
      className={
        'absolute bottom-24 left-1/2 z-30 w-[min(720px,92vw)] -translate-x-1/2 border border-paper/12 bg-ink-0/95 transition-all duration-280 ease-(--ease-baro) ' +
        (open
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-6 opacity-0')
      }
    >
      <header className="flex items-center justify-between border-b border-paper/10 px-5 py-2">
        <p className="dial-label text-paper-dim">Calibration sheet</p>
        <button
          type="button"
          onClick={closeDossier}
          aria-label="Close lineage dossier"
          className="readout px-1 text-[12px] text-paper-dim transition-colors duration-140 hover:text-paper"
        >
          ✕
        </button>
      </header>

      <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:gap-8">
        <div className="shrink-0 sm:w-56">
          <p className="font-sans text-[12px] leading-snug text-paper-dim">
            {payload.title}
          </p>
          {payload.subtitle && (
            <p className="readout mt-0.5 text-[10px] tracking-[0.1em] text-paper-dim/70">
              {payload.subtitle}
            </p>
          )}
          <p
            className="font-display mt-2 text-[clamp(2rem,4vw,3rem)] leading-none text-paper"
            style={{ opacity: 1 - fog * 0.6 }}
          >
            {formatUsd(payload.value_usd)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span className="readout text-[11px] text-paper">
              GRADE {payload.grade}
            </span>
            <span className="relative h-1.5 w-20 bg-ink-2">
              <span
                className="absolute inset-y-0 left-0 bg-flow-in/70"
                style={{ width: `${(1 - fog / 0.45) * 100}%` }}
              />
            </span>
            <span className="readout text-[10px] text-paper-dim">
              FOG {fog.toFixed(2)}
            </span>
          </div>
        </div>

        <dl className="min-w-0 flex-1">
          <Row label="Source">
            {resolved.length === 0 && payload.source_ids.join(', ')}
            {resolved.map((s, i) =>
              s ? (
                <span key={s.source_id} className="block">
                  {s.name} — {s.publisher}{' '}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-flow-out/80 underline decoration-flow-out/30 underline-offset-2 hover:text-flow-out"
                  >
                    {s.url.replace(/^https?:\/\//, '').slice(0, 42)}
                  </a>
                </span>
              ) : (
                <span key={payload.source_ids[i]} className="block">
                  {payload.source_ids[i]}
                </span>
              ),
            )}
          </Row>
          <Row label="Method">
            {payload.method ?? 'DIRECT OBSERVATION'}
          </Row>
          <Row label="Range">
            {payload.lower_bound !== undefined &&
            payload.upper_bound !== undefined
              ? `${formatUsd(payload.lower_bound)} — ${formatUsd(payload.upper_bound)} (95%)`
              : '— (observed value)'}
          </Row>
          {payload.effective_date && (
            <Row label="Effective">{payload.effective_date}</Row>
          )}
          {firstSource && (
            <Row label="Retrieved">
              {firstSource.retrieved_at.slice(0, 10)}
            </Row>
          )}
          {firstSource && <Row label="License">{firstSource.license_note}</Row>}
          {payload.context.map(([label, value]) => (
            <Row key={label} label={label}>
              {value}
            </Row>
          ))}
        </dl>
      </div>
    </section>
  )
}
