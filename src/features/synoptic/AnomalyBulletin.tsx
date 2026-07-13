/**
 * ④ 이상 관측 특보 — 그 분기 최대 흐름 변동의 에디토리얼 모노 조판.
 * 등급 낮을수록 안개(§6), 행 클릭 = 계보 도시에.
 * ⑤ 시정 바 — A~E 레코드 구성. "관측 몇 % 위에 서 있는가"를 항상 노출.
 */
import { useViewStore } from '../../store/viewStore'
import { useTranslation } from 'react-i18next'
import { ASSET_LABELS } from '../../lib/assetLabels'
import { formatUsdNet } from '../../lib/format'
import { fogAlpha } from '../../lib/tokens'
import type {
  AssetClass,
  ConfidenceGrade,
  PeriodKey,
  SynopticAnomaly,
} from '../../types/data'
import { OBSERVED_GRADES } from './shared'

interface BulletinProps {
  period: PeriodKey
  anomalies: SynopticAnomaly[]
  observedOnly: boolean
  filter: AssetClass | null
  /** hover 연결 하이라이트(P2-12) */
  highlight?: AssetClass | null
}

export function AnomalyBulletin({
  period,
  anomalies,
  observedOnly,
  filter,
  highlight,
}: BulletinProps) {
  const openDossier = useViewStore((s) => s.openDossier)
  // anomalies는 자산별 top-12의 |value| 내림차순 합본 — 전역 뷰는 앞 12개만
  const rows = anomalies
    .filter((a) => (filter ? a.asset === filter : true))
    .filter((a) => (observedOnly ? OBSERVED_GRADES.has(a.grade) : true))
    .slice(0, 12)

  return (
    <section className="flex min-h-0 flex-col">
      <p className="dial-label shrink-0 text-paper-dim/70">
        ANOMALY BULLETIN · LARGEST FLOWS · {period}
      </p>
      {rows.length === 0 ? (
        <p className="readout mt-2 text-[11px] tracking-[0.14em] text-paper-dim">
          NO QUALIFYING OBSERVATIONS THIS QUARTER
        </p>
      ) : (
        <div className="mt-1.5 grid min-h-0 flex-1 grid-cols-2 content-start gap-x-10 gap-y-0.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {rows.map((a, i) => (
            <button
              key={`${a.country}-${a.asset}-${a.entry}-${i}`}
              type="button"
              style={{ opacity: 1 - fogAlpha(a.grade) * 0.9 }}
              className={
                'group flex items-baseline gap-2 border-t border-paper/8 py-1 text-left transition-all duration-140 first:border-t-0 [&:nth-child(2)]:border-t-0 hover:bg-ink-2/50 ' +
                (highlight
                  ? a.asset === highlight
                    ? 'bg-ink-2/60'
                    : 'opacity-40'
                  : '')
              }
              onClick={() =>
                openDossier({
                  title: `${a.country} · ${ASSET_LABELS[a.asset]} — quarterly flow`,
                  subtitle: `BOP ${a.entry === 'assets' ? 'resident outflow side' : 'nonresident inflow side'} · ${period}`,
                  value_usd: a.value,
                  grade: a.grade,
                  method: a.method,
                  lower_bound: a.lower,
                  upper_bound: a.upper,
                  effective_date: a.effective_date,
                  source_ids: [a.source_id],
                  context: [
                    ['Rank', `#${i + 1} by |flow| this quarter`],
                    ['Sign', 'BPM6 — net acquisition basis'],
                  ],
                })
              }
            >
              <span className="readout w-6 shrink-0 text-[10px] text-paper-dim/60">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="readout w-10 shrink-0 text-[11px] text-paper">
                {a.country}
              </span>
              <span className="dial-label min-w-0 flex-1 truncate text-paper-dim">
                {ASSET_LABELS[a.asset]} · {a.entry === 'assets' ? 'OUT' : 'IN'}
              </span>
              <span
                className={
                  'readout shrink-0 text-[11px] ' +
                  (a.value >= 0 ? 'text-flow-in' : 'text-flow-out')
                }
              >
                {formatUsdNet(a.value)}
              </span>
              <span className="readout w-4 shrink-0 text-right text-[10px] text-paper-dim">
                {a.grade}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

const GRADES: readonly ConfidenceGrade[] = ['A', 'B', 'C', 'D', 'E']

interface VisibilityProps {
  period: PeriodKey
  gradeMix: Partial<Record<ConfidenceGrade, number>>
}

export function VisibilityBar({ period, gradeMix }: VisibilityProps) {
  const { t } = useTranslation()
  const openDossier = useViewStore((s) => s.openDossier)
  const total = GRADES.reduce((s, g) => s + (gradeMix[g] ?? 0), 0)
  if (total === 0) return null
  const observed = (gradeMix.A ?? 0) + (gradeMix.B ?? 0)
  const pct = (observed / total) * 100

  return (
    <button
      type="button"
      className="flex shrink-0 items-center gap-3 text-left"
      title={t('synoptic.visibilityTitle')}
      onClick={() =>
        openDossier({
          title: 'Visibility — observation grade mix',
          subtitle: `SYNOPTIC · ${period}`,
          value_usd: total,
          grade: 'A',
          source_ids: ['imf_iip', 'imf_bop'],
          context: GRADES.map((g) => [
            `Grade ${g}`,
            `${gradeMix[g] ?? 0} records`,
          ]),
        })
      }
    >
      <span className="dial-label shrink-0 text-paper-dim/70">VISIBILITY</span>
      <span className="flex h-2 min-w-0 flex-1 border border-paper/15">
        {GRADES.map((g) => {
          const n = gradeMix[g] ?? 0
          if (n === 0) return null
          return (
            <span
              key={g}
              style={{
                width: `${(n / total) * 100}%`,
                background: 'var(--atlas-paper)',
                opacity: 0.85 - fogAlpha(g) * 1.6,
              }}
            />
          )
        })}
      </span>
      <span className="readout shrink-0 text-[10px] text-paper-dim">
        OBSERVED {pct.toFixed(0)}% · ESTIMATED {(100 - pct).toFixed(0)}% ·{' '}
        {total} RECORDS
      </span>
    </button>
  )
}
