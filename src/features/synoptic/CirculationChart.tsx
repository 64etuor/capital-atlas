/**
 * ② 순환도 — 해당 분기 최대 회랑(owner→issuer)의 커스텀 SVG 흐름도.
 * 링크 색 = cyan(소유자 유출측) → amber(발행자 유입측) 그라디언트,
 * 굵기 ∝ log 규모, §6: 관측=실선 / 유도=파선 / 모델=희박 점선 + 감쇠.
 */
import { useViewStore } from '../../store/viewStore'
import { useTranslation } from 'react-i18next'
import { ASSET_LABELS } from '../../lib/assetLabels'
import { formatUsd } from '../../lib/format'
import { fogAlpha } from '../../lib/tokens'
import type { AssetClass, PeriodKey, SynopticCorridor } from '../../types/data'
import { OBSERVED_GRADES, gradeDash } from './shared'

const SHOWN = 12

interface Props {
  /** 회랑이 존재하는 가장 가까운 과거 기간 (연간 CPIS — null이면 데이터 없음) */
  effPeriod: PeriodKey | null
  corridors: SynopticCorridor[]
  isFlow: boolean
  observedOnly: boolean
  filter: AssetClass | null
}

export function CirculationChart({
  effPeriod,
  corridors,
  isFlow,
  observedOnly,
  filter,
}: Props) {
  const { t } = useTranslation()
  const openDossier = useViewStore((s) => s.openDossier)
  const rows = corridors
    .filter((c) => (filter ? c.asset === filter : true))
    .filter((c) => (observedOnly ? OBSERVED_GRADES.has(c.grade) : true))
    .slice(0, SHOWN)

  const owners = [...new Set(rows.map((r) => r.owner))]
  const issuers = [...new Set(rows.map((r) => r.issuer))]
  const maxV = Math.max(...rows.map((r) => Math.abs(r.value)), 1)
  const y = (i: number, n: number) => ((i + 0.5) / Math.max(n, 1)) * 100

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <p className="dial-label shrink-0 text-paper-dim/70">
        CIRCULATION · TOP CORRIDORS ·{' '}
        {isFlow ? t('synoptic.circulationFlow') : t('synoptic.circulationPositions')}
        {effPeriod ? ` · ${effPeriod}` : ''}
      </p>
      {rows.length === 0 ? (
        <div className="readout flex flex-1 items-center justify-center text-[11px] tracking-[0.14em] text-paper-dim">
          {observedOnly && isFlow
            ? t('synoptic.circulationNoObserved')
            : t('synoptic.circulationAwaiting')}
        </div>
      ) : (
        <svg
          className="mt-1 min-h-0 w-full flex-1"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={t('synoptic.circulationAria')}
        >
          <defs>
            <linearGradient id="corridor-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--flow-out)" />
              <stop offset="100%" stopColor="var(--flow-in)" />
            </linearGradient>
          </defs>
          {rows.map((r, i) => {
            const y1 = y(owners.indexOf(r.owner), owners.length)
            const y2 = y(issuers.indexOf(r.issuer), issuers.length)
            const w = 0.6 + 3.4 * (Math.abs(r.value) / maxV)
            const fogged = 1 - fogAlpha(r.grade)
            return (
              <path
                key={`${r.owner}-${r.issuer}-${r.asset}-${i}`}
                d={`M 12 ${y1} C 45 ${y1}, 55 ${y2}, 88 ${y2}`}
                fill="none"
                stroke="url(#corridor-grad)"
                strokeWidth={w}
                strokeDasharray={gradeDash(r.grade)}
                opacity={0.35 + 0.55 * fogged}
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer transition-opacity duration-140 hover:opacity-100"
                onClick={() =>
                  openDossier({
                    title: `${r.owner} → ${r.issuer} · ${ASSET_LABELS[r.asset]}`,
                    subtitle: `${isFlow ? 'Derived bilateral net flow' : 'CPIS bilateral position'} · ${effPeriod ?? ''}`,
                    value_usd: r.value,
                    grade: r.grade,
                    method: r.method,
                    lower_bound: r.lower,
                    upper_bound: r.upper,
                    effective_date: r.effective_date,
                    source_ids: [r.source_id],
                    context: [['Rank', `#${i + 1} by |value| this period`]],
                  })
                }
              />
            )
          })}
          {owners.map((c, i) => (
            <text
              key={`o-${c}`}
              x={10.5}
              y={y(i, owners.length)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-paper-dim font-mono"
              fontSize={3.2}
            >
              {c}
            </text>
          ))}
          {issuers.map((c, i) => (
            <text
              key={`i-${c}`}
              x={89.5}
              y={y(i, issuers.length)}
              textAnchor="start"
              dominantBaseline="middle"
              className="fill-paper-dim font-mono"
              fontSize={3.2}
            >
              {c}
            </text>
          ))}
        </svg>
      )}
      {rows.length > 0 && (
        <p className="readout shrink-0 text-[10px] text-paper-dim/70">
          #1 {rows[0].owner} → {rows[0].issuer} · {ASSET_LABELS[rows[0].asset]} ·{' '}
          {formatUsd(rows[0].value, 1)} · GRADE {rows[0].grade}
        </p>
      )}
    </section>
  )
}
