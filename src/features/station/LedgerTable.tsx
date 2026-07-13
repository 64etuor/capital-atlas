/**
 * 계보 미니 원장 — 자산 상세의 기저 레코드 표(교정 시트 어법: 얇은 괘선,
 * mono). 행 클릭 = 계보 도시에(§1.5).
 */
import { useViewStore } from '../../store/viewStore'
import type { StationPoint } from '../../types/data'
import { formatUsd, formatUsdNet } from '../../lib/format'
import { fogAlpha } from '../../lib/tokens'
import { quarterEnd } from './shared'

const ROWS_SHOWN = 12

interface Props {
  points: StationPoint[]
  iso3: string
  assetLabel: string
}

export function LedgerTable({ points, iso3, assetLabel }: Props) {
  const openDossier = useViewStore((s) => s.openDossier)
  const rows = [...points]
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, ROWS_SHOWN)

  return (
    <section className="flex min-h-0 flex-col">
      <p className="dial-label shrink-0 text-paper-dim/70">
        OBSERVATION LEDGER · LATEST {rows.length}
      </p>
      <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="dial-label grid grid-cols-[64px_1fr_1fr_20px_1fr] gap-2 border-b border-paper/15 pb-1 text-[9px] text-paper-dim/60">
          <span>PERIOD</span>
          <span className="text-right">STOCK</span>
          <span className="text-right">NET FLOW</span>
          <span className="text-right">GR</span>
          <span className="text-right">SOURCE</span>
        </div>
        {rows.map((p) => (
          <button
            key={p.period}
            type="button"
            style={{ opacity: 1 - fogAlpha(p.grade) * 0.9 }}
            className="grid w-full grid-cols-[64px_1fr_1fr_20px_1fr] gap-2 border-t border-paper/8 py-[3px] text-left first:border-t-0 hover:bg-ink-2/50"
            onClick={() =>
              openDossier({
                title: `${iso3} · ${assetLabel} — cross-border stock`,
                subtitle: `OWNER BASIS · ${p.period}`,
                value_usd: p.stock,
                grade: p.grade,
                method: p.method,
                lower_bound: p.stock_lower,
                upper_bound: p.stock_upper,
                effective_date: quarterEnd(p.period),
                source_ids: [p.source_id ?? 'imf_iip'],
                context: [
                  ['Net flow', formatUsdNet(p.flow_in - p.flow_out)],
                  ['Valuation', formatUsdNet(p.valuation)],
                  ...(p.stock_issuer !== undefined
                    ? ([['Issuer-basis stock', formatUsd(p.stock_issuer, 1)]] as Array<
                        [string, string]
                      >)
                    : []),
                ],
              })
            }
          >
            <span className="readout text-[10px] text-paper">{p.period}</span>
            <span className="readout text-right text-[10px] text-paper">
              {formatUsd(p.stock, 1)}
            </span>
            <span
              className={
                'readout text-right text-[10px] ' +
                (p.flow_in - p.flow_out >= 0 ? 'text-flow-in' : 'text-flow-out')
              }
            >
              {p.flow_grade ? formatUsdNet(p.flow_in - p.flow_out) : '·'}
            </span>
            <span className="readout text-right text-[10px] text-paper-dim">
              {p.grade}
            </span>
            <span className="readout truncate text-right text-[10px] text-paper-dim/80">
              {p.source_id ?? '—'}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
