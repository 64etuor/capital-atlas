/**
 * 상대국 매트릭스 — CPIS 양방향 발산 바. 좌(cyan) = 이 나라를 보유한
 * 상대(피보유), 우(amber) = 이 나라가 보유한 상대(보유). 등급 안개(§6),
 * 행 클릭 = 계보 도시에(§1.5).
 */
import { useViewStore } from '../../store/viewStore'
import type {
  PeriodKey,
  StationPartner,
  StationPartnerSides,
} from '../../types/data'
import { formatUsd } from '../../lib/format'
import { fogAlpha } from '../../lib/tokens'
import { OBSERVED_GRADES } from './shared'

const ROWS_SHOWN = 12

interface Props {
  sides: StationPartnerSides | undefined
  effPeriod: PeriodKey | null
  iso3: string
  assetLabel: string
  observedOnly: boolean
  /** WLD 등 양자 데이터가 구조적으로 없는 경우의 정직한 안내 */
  emptyHint: string
  /** Phase L: LCU 표시 포맷터 (기본 USD) — 행 표시 전용, 도시에 원값은 USD */
  fmt?: (v: number, digits?: number) => string
  /** LCU 활성 시 도시에에 붙는 FX RATE·LCU/USD VALUE 행 */
  fxRows?: (valueUsd: number) => Array<[string, string]>
}

interface Row {
  country: string
  holding?: StationPartner
  holder?: StationPartner
  max: number
}

export function PartnerMatrix({
  sides,
  effPeriod,
  iso3,
  assetLabel,
  observedOnly,
  emptyHint,
  fmt = formatUsd,
  fxRows,
}: Props) {
  const openDossier = useViewStore((s) => s.openDossier)

  const keep = (p: StationPartner) =>
    !observedOnly || OBSERVED_GRADES.has(p.grade)
  const byCountry = new Map<string, Row>()
  for (const p of sides?.holdings.filter(keep) ?? []) {
    byCountry.set(p.country, {
      country: p.country,
      holding: p,
      max: Math.abs(p.value),
    })
  }
  for (const p of sides?.holders.filter(keep) ?? []) {
    const row = byCountry.get(p.country)
    if (row) {
      row.holder = p
      row.max = Math.max(row.max, Math.abs(p.value))
    } else {
      byCountry.set(p.country, {
        country: p.country,
        holder: p,
        max: Math.abs(p.value),
      })
    }
  }
  const rows = [...byCountry.values()]
    .sort((a, b) => b.max - a.max)
    .slice(0, ROWS_SHOWN)
  const scale = rows[0]?.max ?? 1

  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <p className="dial-label text-paper-dim/70">
          COUNTERPARTY MATRIX · {assetLabel} · {effPeriod ?? '—'}
        </p>
        <p className="dial-label text-[9px] text-paper-dim/50">
          ← HELD BY · HOLDS →
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="readout mt-2 text-[11px] tracking-[0.14em] text-paper-dim">
          {emptyHint}
        </p>
      ) : (
        <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {rows.map((r) => {
            const grade =
              r.holding && r.holder
                ? fogAlpha(r.holding.grade) > fogAlpha(r.holder.grade)
                  ? r.holding.grade
                  : r.holder.grade
                : (r.holding ?? r.holder)?.grade ?? 'E'
            const main = r.holding ?? r.holder
            return (
              <button
                key={r.country}
                type="button"
                style={{ opacity: 1 - fogAlpha(grade) * 0.9 }}
                className="group flex w-full items-center gap-2 border-t border-paper/8 py-[3px] first:border-t-0 hover:bg-ink-2/50"
                onClick={() => {
                  if (!main) return
                  openDossier({
                    title: `${iso3} ⇄ ${r.country} · ${assetLabel} — bilateral positions`,
                    subtitle: `CPIS/PIP · ${effPeriod ?? ''}`,
                    value_usd: main.value,
                    grade,
                    method: main.method,
                    lower_bound: main.lower,
                    upper_bound: main.upper,
                    effective_date: main.effective_date,
                    source_ids: [main.source_id],
                    context: [
                      [
                        `${iso3} holds ${r.country}`,
                        r.holding ? formatUsd(r.holding.value, 1) : 'no observation',
                      ],
                      [
                        `${r.country} holds ${iso3}`,
                        r.holder ? formatUsd(r.holder.value, 1) : 'no observation',
                      ],
                      ...(fxRows?.(main.value) ?? []),
                    ],
                  })
                }}
              >
                <span className="readout w-8 shrink-0 text-[10px] text-paper">
                  {r.country}
                </span>
                {/* 발산 바 — 중앙축 기준 좌: 피보유(cyan) / 우: 보유(amber) */}
                <span className="relative h-2 min-w-0 flex-1">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-paper/15" />
                  {r.holder && (
                    <span
                      className="absolute inset-y-0 right-1/2 bg-flow-out/75 transition-colors group-hover:bg-flow-out"
                      style={{
                        width: `${(Math.abs(r.holder.value) / scale) * 48}%`,
                      }}
                    />
                  )}
                  {r.holding && (
                    <span
                      className="absolute inset-y-0 left-1/2 bg-flow-in/80 transition-colors group-hover:bg-flow-in"
                      style={{
                        width: `${(Math.abs(r.holding.value) / scale) * 48}%`,
                      }}
                    />
                  )}
                </span>
                <span className="readout w-14 shrink-0 text-right text-[10px] text-flow-out/90">
                  {r.holder ? fmt(r.holder.value, 1) : '·'}
                </span>
                <span className="readout w-14 shrink-0 text-right text-[10px] text-flow-in">
                  {r.holding ? fmt(r.holding.value, 1) : '·'}
                </span>
                <span className="readout w-3 shrink-0 text-right text-[10px] text-paper-dim">
                  {grade}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
