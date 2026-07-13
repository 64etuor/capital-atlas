/**
 * ① 자산 기압계 뱅크 — 자산군별 수직 계기 칼럼 (공유 베이스라인).
 * 칼럼 높이 = 글로벌 국경간 잔액(log), 니들 = 분기 순흐름(amber 팽창 /
 * cyan 수축), 추정 비중만큼 §6 안개. 칼럼 클릭 = 자산 필터.
 */
import { useViewStore } from '../../store/viewStore'
import { useTranslation } from 'react-i18next'
import { ASSET_LABELS } from '../../lib/assetLabels'
import { formatUsd, formatUsdNet } from '../../lib/format'
import { pressureColor, rgbaCss } from '../../lib/tokens'
import type { AssetClass, PeriodKey, SynopticCell } from '../../types/data'
import { ASSET_ABBR, logT, modeCell } from './shared'

interface Props {
  period: PeriodKey
  cells: Partial<Record<AssetClass, SynopticCell>>
  assets: AssetClass[]
  observedOnly: boolean
  filter: AssetClass | null
  onFilter: (asset: AssetClass | null) => void
  /** hover 연결 하이라이트(P2-12) — 지진계·특보가 같은 자산을 함께 밝힌다 */
  onHover?: (asset: AssetClass | null) => void
}

export function BarometerBank({
  period,
  cells,
  assets,
  observedOnly,
  filter,
  onFilter,
  onHover,
}: Props) {
  const { t } = useTranslation()
  const openDossier = useViewStore((s) => s.openDossier)
  const mode = assets.map((a) => ({
    asset: a,
    cell: cells[a] ? modeCell(cells[a], observedOnly) : null,
  }))
  const maxStock = Math.max(...mode.map((m) => m.cell?.stock ?? 0), 1)
  const maxFlow = Math.max(...mode.map((m) => Math.abs(m.cell?.flowNet ?? 0)), 1)
  const total = mode.reduce((s, m) => s + (m.cell?.stock ?? 0), 0)
  const totalNet = mode.reduce((s, m) => s + (m.cell?.flowNet ?? 0), 0)
  const totalObs =
    total > 0
      ? mode.reduce((s, m) => s + (m.cell?.stock ?? 0) * (m.cell?.obsShare ?? 0), 0) /
        total
      : 0

  return (
    <section className="flex min-h-0 items-stretch gap-6">
      {/* 좌측 앵커 — 에디토리얼 헤드라인 수치 */}
      <div className="flex w-64 shrink-0 flex-col justify-end pb-7">
        <p className="dial-label text-paper-dim/70">
          PRESSURE BANK · GLOBAL CROSS-BORDER
        </p>
        <button
          type="button"
          className="mt-1 text-left font-display text-[clamp(2.4rem,4.5vw,3.6rem)] leading-none text-paper transition-opacity duration-140 hover:opacity-80"
          onClick={() =>
            openDossier({
              title: 'Global cross-border position — all asset classes',
              subtitle: `SYNOPTIC · BASIS OWNER · ${period}`,
              value_usd: total,
              grade: totalObs >= 0.995 ? 'A' : 'C',
              method:
                totalObs >= 0.995
                  ? undefined
                  : 'sum of country-level records (observed + estimated)',
              source_ids: ['imf_iip'],
              context: [
                ['Observed share', `${(totalObs * 100).toFixed(1)}%`],
                ['Net flow (qtr)', formatUsdNet(totalNet)],
                ['View', observedOnly ? 'observed only' : 'observed + estimated'],
              ],
            })
          }
        >
          {formatUsd(total)}
        </button>
        <p className="readout mt-1 text-[11px] text-paper-dim">
          NET FLOW {period}{' '}
          <span className={totalNet >= 0 ? 'text-flow-in' : 'text-flow-out'}>
            {formatUsdNet(totalNet)}
          </span>
        </p>
      </div>

      {/* 계기 칼럼들 — 공유 베이스라인 */}
      <div className="flex min-w-0 flex-1 items-stretch justify-around gap-2 border-b border-paper/15">
        {mode.map(({ asset, cell }) => {
          const dimmed = filter !== null && filter !== asset
          const h = cell ? logT(cell.stock, maxStock) : 0
          const net = cell?.flowNet ?? 0
          const needle = cell ? 8 + 14 * (Math.abs(net) / maxFlow) : 0
          const fog = cell ? (1 - cell.obsShare) * 0.55 : 0
          return (
            <div
              key={asset}
              onPointerEnter={() => onHover?.(asset)}
              onPointerLeave={() => onHover?.(null)}
              className={
                'flex w-20 min-w-0 flex-col items-center justify-end transition-opacity duration-140 ' +
                (dimmed ? 'opacity-35' : 'opacity-100')
              }
            >
              <button
                type="button"
                aria-pressed={filter === asset}
                title={t('synoptic.filterTitle', { label: ASSET_LABELS[asset] })}
                onClick={() => onFilter(filter === asset ? null : asset)}
                className="relative flex w-10 flex-1 items-end justify-center"
              >
                {/* 순흐름 니들 */}
                {cell && net !== 0 && (
                  <svg
                    className="absolute left-1/2 -translate-x-1/2"
                    style={{ bottom: `calc(${h * 100}% + 4px)` }}
                    width={needle}
                    height={needle}
                    viewBox="0 0 10 10"
                    aria-hidden
                  >
                    <path
                      d={net > 0 ? 'M5 0 L10 10 L0 10 Z' : 'M5 10 L10 0 L0 0 Z'}
                      fill={net > 0 ? 'var(--flow-in)' : 'var(--flow-out)'}
                      opacity={0.9}
                    />
                  </svg>
                )}
                {/* 기압 튜브 */}
                <span
                  className={
                    'relative block w-full border border-paper/15 transition-all duration-280 ' +
                    (filter === asset ? 'border-flow-in/60' : '')
                  }
                  style={{
                    height: `${h * 100}%`,
                    background: `linear-gradient(to top, ${rgbaCss(pressureColor(h * 0.35), 0.9)}, ${rgbaCss(pressureColor(h), 0.9)})`,
                  }}
                >
                  {/* §6 안개 — 추정 비중만큼 문자 그대로 뿌옇게 */}
                  {fog > 0.01 && (
                    <span
                      className="atlas-grain absolute inset-0"
                      style={{ background: 'var(--atlas-ink-1)', opacity: fog }}
                    />
                  )}
                </span>
              </button>
              <span className="dial-label mt-2 text-paper-dim">
                {ASSET_ABBR[asset]}
              </span>
              <button
                type="button"
                className="readout text-[11px] text-paper transition-colors duration-140 hover:text-flow-in"
                onClick={() =>
                  cell &&
                  openDossier({
                    title: `Global ${ASSET_LABELS[asset]} — cross-border stock`,
                    subtitle: `SYNOPTIC · BASIS OWNER · ${period}`,
                    value_usd: cell.stock,
                    grade: cell.obsShare >= 0.995 ? 'A' : 'C',
                    method:
                      cell.obsShare >= 0.995
                        ? undefined
                        : 'sum of country-level records (observed + estimated)',
                    source_ids: ['imf_iip'],
                    context: [
                      ['Observed share', `${(cell.obsShare * 100).toFixed(1)}%`],
                      ['Net flow (qtr)', formatUsdNet(cell.flowNet)],
                      ['Valuation (qtr)', formatUsdNet(cell.valuation)],
                      ['Records', String(cell.records)],
                    ],
                  })
                }
              >
                {cell && cell.stock > 0 ? formatUsd(cell.stock, 1) : '—'}
              </button>
              <span
                className={
                  'readout text-[10px] ' +
                  ((cell?.flowNet ?? 0) >= 0 ? 'text-flow-in/80' : 'text-flow-out/80')
                }
              >
                {cell && cell.flowNet !== 0 ? formatUsdNet(cell.flowNet, 0) : ''}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
