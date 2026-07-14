/**
 * 상대국 매트릭스 — PIP/DIP/BIS 포지션 발산 바. 좌(cyan) = 이 나라를 보유한
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
import { partnerDossierPayload } from './partnerDossier'

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
  /**
   * 구체 자산 스코프(자산 탭) — 은행 채널(deposits/loans)일 때만 도시에
   * MIRROR 행(§12-3)의 조회 키를 부여한다. ALL 스코프는 자산 모호 → 미부여.
   */
  asset?: string
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
  asset,
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
            const holder = r.holder
            const holding = r.holding
            const grade =
              holding && holder
                ? fogAlpha(holding.grade) > fogAlpha(holder.grade)
                  ? holding.grade
                  : holder.grade
                : (holding ?? holder)?.grade ?? 'E'
            return (
              <div
                key={r.country}
                style={{ opacity: 1 - fogAlpha(grade) * 0.9 }}
                className="group flex w-full items-center gap-2 border-t border-paper/8 py-[3px] first:border-t-0 hover:bg-ink-2/50"
              >
                <span className="readout w-8 shrink-0 text-[10px] text-paper">
                  {r.country}
                </span>
                {/* 발산 바 — 중앙축 기준 좌: 피보유(cyan) / 우: 보유(amber) */}
                <span className="relative h-2 min-w-0 flex-1">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-paper/15" />
                  {holder && (
                    <span
                      className="absolute inset-y-0 right-1/2 bg-flow-out/75 transition-colors group-hover:bg-flow-out"
                      style={{
                        width: `${(Math.abs(holder.value) / scale) * 48}%`,
                      }}
                    />
                  )}
                  {holding && (
                    <span
                      className="absolute inset-y-0 left-1/2 bg-flow-in/80 transition-colors group-hover:bg-flow-in"
                      style={{
                        width: `${(Math.abs(holding.value) / scale) * 48}%`,
                      }}
                    />
                  )}
                </span>
                {holder && effPeriod ? (
                  <button
                    type="button"
                    className="readout w-[72px] shrink-0 text-right text-[10px] text-flow-out/90 hover:text-flow-out"
                    onClick={() =>
                      openDossier(
                        partnerDossierPayload(holder, {
                          owner: r.country,
                          issuer: iso3,
                          assetLabel,
                          period: effPeriod,
                          asset,
                          fxRows,
                        }),
                      )
                    }
                  >
                    {fmt(holder.value, 1)} · {holder.grade}
                  </button>
                ) : (
                  <span className="readout w-[72px] shrink-0 text-right text-[9px] text-paper-dim/45">
                    UNAVAIL
                  </span>
                )}
                {holding && effPeriod ? (
                  <button
                    type="button"
                    className="readout w-[72px] shrink-0 text-right text-[10px] text-flow-in hover:text-flow-in/80"
                    onClick={() =>
                      openDossier(
                        partnerDossierPayload(holding, {
                          owner: iso3,
                          issuer: r.country,
                          assetLabel,
                          period: effPeriod,
                          asset,
                          fxRows,
                        }),
                      )
                    }
                  >
                    {fmt(holding.value, 1)} · {holding.grade}
                  </button>
                ) : (
                  <span className="readout w-[72px] shrink-0 text-right text-[9px] text-paper-dim/45">
                    UNAVAIL
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
