/**
 * SYNOPTIC — 종관도 (DESIGN.md 어법: 계기 뱅크 + 기상 특보 조판, 카드 금지).
 * 모든 자산군의 잔액·흐름·평가변동·회랑·이상 관측을 한 화면에.
 * meta/synoptic.json 하나만 lazy-load (65분기 샤드 순회 금지).
 *
 * 항상 마운트되어 있고 GLOBE 위를 불투명하게 덮는다 — MapCanvas를
 * 언마운트하지 않아 지구본 로드 시퀀스가 재생되지 않는다(§4 "1회만").
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewStore } from '../../store/viewStore'
import { getSynoptic, nearestAvailable } from '../../lib/dataClient'
import { periodFromIndex } from '../../lib/periods'
import type { AssetClass, PeriodKey, SynopticFile } from '../../types/data'
import { BarometerBank } from './BarometerBank'
import { CirculationChart } from './CirculationChart'
import { StripBank } from './StripBank'
import { AnomalyBulletin, VisibilityBar } from './AnomalyBulletin'

export function SynopticView() {
  const { t } = useTranslation()
  const appView = useViewStore((s) => s.appView)
  const periodIndex = useViewStore((s) => s.periodIndex)
  const measure = useViewStore((s) => s.measure)
  const includeEstimates = useViewStore((s) => s.includeEstimates)
  const [syn, setSyn] = useState<SynopticFile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<AssetClass | null>(null)
  // hover 연결 하이라이트(P2-12) — 선택(filter)이 아닌 시선 수준의 동기화
  const [hovered, setHovered] = useState<AssetClass | null>(null)

  const visible = appView === 'synoptic'
  const observedOnly = !includeEstimates

  useEffect(() => {
    if (!visible || syn) return
    let alive = true
    getSynoptic()
      .then((d) => {
        if (alive) setSyn(d)
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(String(err))
      })
    return () => {
      alive = false
    }
  }, [visible, syn])

  const period = periodFromIndex(periodIndex)
  const corridorPeriods = syn
    ? (Object.keys(syn.corridors).sort() as PeriodKey[])
    : []
  const corridorEff = syn ? nearestAvailable(corridorPeriods, period) : null
  const corridorSet = corridorEff ? syn?.corridors[corridorEff] : undefined
  const isFlow = measure === 'flow' || measure === 'valuation'
  // §14 회랑 집중도 — 자산 필터 중엔 분모가 전체라 오도되므로 생략
  const corridorConc =
    corridorEff && filter === null
      ? (syn?.corridor_concentration[corridorEff] ?? null)
      : null
  const top20Share = corridorConc
    ? observedOnly
      ? corridorConc.top20_share_obs
      : corridorConc.top20_share
    : null

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={
        'absolute inset-0 z-[6] transition-opacity duration-280 ease-baro ' +
        (visible ? 'opacity-100' : 'pointer-events-none opacity-0')
      }
      style={{
        background:
          'linear-gradient(180deg, var(--atlas-ink-0) 0%, var(--atlas-ink-1) 55%, var(--atlas-ink-2) 130%)',
      }}
    >
      {!syn ? (
        <div className="readout flex h-full items-center justify-center text-[12px] tracking-[0.18em] text-paper-dim">
          {loadError
            ? `SYNOPTIC FEED UNAVAILABLE — ${loadError}`
            : t('common.preparing')}
        </div>
      ) : (
        <div className="grid h-full grid-rows-[minmax(0,32fr)_minmax(0,34fr)_minmax(0,26fr)_auto] gap-4 pb-24 pl-6 pr-28 pt-28">
          <BarometerBank
            period={period}
            cells={syn.per_quarter[period] ?? {}}
            assets={syn.assets}
            observedOnly={observedOnly}
            filter={filter}
            onFilter={setFilter}
            onHover={setHovered}
          />
          <div className="grid min-h-0 grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-10">
            <CirculationChart
              effPeriod={corridorEff}
              corridors={
                corridorSet ? (isFlow ? corridorSet.flow : corridorSet.stock) : []
              }
              isFlow={isFlow}
              observedOnly={observedOnly}
              filter={filter}
              top20Share={top20Share}
            />
            <StripBank
              syn={syn}
              periodIndex={periodIndex}
              observedOnly={observedOnly}
              filter={filter ?? hovered}
              onFilter={setFilter}
            />
          </div>
          <AnomalyBulletin
            highlight={hovered}
            period={period}
            anomalies={syn.anomalies[period] ?? []}
            observedOnly={observedOnly}
            filter={filter}
          />
          <VisibilityBar period={period} gradeMix={syn.grade_mix[period] ?? {}} />
        </div>
      )}
    </div>
  )
}
