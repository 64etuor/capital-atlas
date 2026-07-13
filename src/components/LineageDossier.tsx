import { useEffect, useState } from 'react'
import { useViewStore } from '../store/viewStore'
import { getSources, getVintage, getVintagesIndex } from '../lib/dataClient'
import { formatUsd } from '../lib/format'
import { fogAlpha } from '../lib/tokens'
import { useTranslation } from 'react-i18next'
import type { SourceRegistryEntry } from '../types/data'
import type { DossierPayload } from '../types/dossier'

/**
 * REVISIONS (Phase N, §15.5) — 빈티지 다이제스트와 현재 값을 대조해 소급
 * 개정을 노출한다. 흐름/파생 지표는 revision_key가 없어 행 자체가 생략된다.
 */
type RevisionState =
  | { kind: 'loading' }
  | { kind: 'none'; since: string }
  | { kind: 'notTracked'; first: string }
  | { kind: 'rows'; rows: Array<{ date: string; from: number; to: number }> }

const MAX_REVISION_VINTAGES = 6

async function loadRevisions(
  key: NonNullable<DossierPayload['revision_key']>,
  current: number,
): Promise<RevisionState> {
  const { vintages } = await getVintagesIndex()
  if (vintages.length === 0) return { kind: 'notTracked', first: '—' }
  const recent = vintages.slice(-MAX_REVISION_VINTAGES).reverse()
  const rows: Array<{ date: string; from: number; to: number }> = []
  let tracked = false
  for (const date of recent) {
    const d = await getVintage(date)
    const entry =
      key.asset === 'total'
        ? d.totals[key.basis]?.[key.country]
        : d.stocks[key.basis]?.[key.country]?.[key.asset]
    if (!entry || entry.p !== key.period) continue // 분기 불일치 = 비교 불가
    tracked = true
    if (Math.abs(entry.v - current) / (Math.abs(current) || 1) > 1e-4)
      rows.push({ date, from: entry.v, to: current })
  }
  if (!tracked) return { kind: 'notTracked', first: vintages[0] }
  return rows.length > 0
    ? { kind: 'rows', rows }
    : { kind: 'none', since: vintages[0] }
}

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
  const { t } = useTranslation()
  // store keeps the last payload through the slide-out transition
  const payload = useViewStore((s) => s.dossier)
  const open = useViewStore((s) => s.dossierOpen)
  const closeDossier = useViewStore((s) => s.closeDossier)
  const [sources, setSources] = useState<Map<string, SourceRegistryEntry>>(
    () => new Map(),
  )
  const [revResult, setRevResult] = useState<{
    id: string
    state: RevisionState
  } | null>(null)

  useEffect(() => {
    getSources().then(setSources).catch(() => {
      /* dossier still renders source_ids raw if the registry fails */
    })
  }, [])

  // REVISIONS (§15.5) — 열릴 때만 빈티지 다이제스트 lazy-load, 날조 금지.
  // 로딩 상태는 결과 id 불일치로 파생(effect 내 동기 setState 금지 규칙 준수).
  const revisionKey = payload?.revision_key
  const revisionValue = payload?.value_usd
  const revId = revisionKey
    ? `${revisionKey.basis}|${revisionKey.country}|${revisionKey.asset}|${revisionKey.period}|${revisionValue}`
    : null
  useEffect(() => {
    if (!open || !revisionKey || revisionValue === undefined || revId === null)
      return
    let alive = true
    loadRevisions(revisionKey, revisionValue)
      .then((state) => {
        if (alive) setRevResult({ id: revId, state })
      })
      .catch(() => {
        // 빈티지 인덱스 부재 = 아직 추적 이력 없음 (정직 표기)
        if (alive)
          setRevResult({ id: revId, state: { kind: 'notTracked', first: '—' } })
      })
    return () => {
      alive = false
    }
  }, [open, revisionKey, revisionValue, revId])
  const revisions: RevisionState =
    revResult && revResult.id === revId
      ? revResult.state
      : { kind: 'loading' }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc 계층(I-2/I-4): 팔레트·튜토리얼이 위에 열려 있으면 그쪽이 소비
      const s = useViewStore.getState()
      if (s.paletteOpen || s.tutorialOpen) return
      closeDossier()
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
      aria-label={t('dossier.aria')}
      aria-hidden={!open}
      inert={!open}
      className={
        'absolute bottom-24 left-1/2 z-30 w-[min(720px,92vw)] -translate-x-1/2 border border-paper/12 bg-ink-0/95 transition-all duration-280 ease-(--ease-baro) ' +
        (open
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-6 opacity-0')
      }
    >
      <header className="flex items-center justify-between border-b border-paper/10 px-5 py-2">
        <p className="dial-label text-paper-dim">{t('dossier.title')}</p>
        <button
          type="button"
          onClick={closeDossier}
          aria-label={t('dossier.closeAria')}
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
          <Row label={t('dossier.rows.source')}>
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
          <Row label={t('dossier.rows.collection')}>
            {[
              ...new Set(
                resolved
                  .filter((s) => s != null)
                  .map(
                    (s) =>
                      `${t(`dossier.modes.${s.collection_mode}`)} · ${s.update_frequency.toUpperCase()}`,
                  ),
              ),
            ].join(' / ') || '—'}
          </Row>
          <Row label={t('dossier.rows.method')}>
            {payload.method ?? t('dossier.directObservation')}
          </Row>
          <Row label={t('dossier.rows.range')}>
            {payload.lower_bound !== undefined &&
            payload.upper_bound !== undefined
              ? `${formatUsd(payload.lower_bound)} — ${formatUsd(payload.upper_bound)} (95%)`
              : t('dossier.observedValue')}
          </Row>
          {payload.effective_date && (
            <Row label={t('dossier.rows.effective')}>
              {payload.effective_date}
            </Row>
          )}
          {payload.revision_key && (
            <Row label={t('dossier.rows.revisions')}>
              {revisions.kind === 'loading' && '…'}
              {revisions.kind === 'none' &&
                t('dossier.revisions.none', { date: revisions.since })}
              {revisions.kind === 'notTracked' &&
                t('dossier.revisions.notTracked', { date: revisions.first })}
              {revisions.kind === 'rows' &&
                revisions.rows.map((r) => {
                  const pct = ((r.to - r.from) / Math.abs(r.from)) * 100
                  return (
                    <span key={r.date} className="block">
                      {r.date} · {formatUsd(r.from)} → {formatUsd(r.to)} ·{' '}
                      {pct >= 0 ? '+' : ''}
                      {pct.toFixed(2)}%
                    </span>
                  )
                })}
            </Row>
          )}
          {firstSource && (
            <Row label={t('dossier.rows.retrieved')}>
              {firstSource.retrieved_at.slice(0, 10)}
            </Row>
          )}
          {firstSource && (
            <Row label={t('dossier.rows.license')}>
              {firstSource.license_note}
            </Row>
          )}
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
