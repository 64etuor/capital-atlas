import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewStore } from '../store/viewStore'
import {
  getBilateral,
  getCountries,
  getFlowsCountry,
  getIndex,
  getStocks,
  nearestAvailable,
} from '../lib/dataClient'
import { indexFromPeriod, periodFromIndex } from '../lib/periods'
import { formatUsdNet } from '../lib/format'
import { useMoney } from '../lib/money'
import { fogAlpha } from '../lib/tokens'
import { OBSERVED_GRADES, summarizeStocks } from '../features/map/aggregate'
import { Odometer } from './Odometer'
import { AssetTreemap } from './AssetTreemap'
import { ASSET_LABELS, type TreemapItem } from '../lib/assetLabels'
import type {
  BilateralRecord,
  ConfidenceGrade,
  CountryMaster,
  PeriodKey,
  StockRecord,
} from '../types/data'
import type { DossierPayload } from '../types/dossier'

const GRADES: readonly ConfidenceGrade[] = ['A', 'B', 'C', 'D', 'E']

interface QuarterFlow {
  period: PeriodKey
  inflow: number
  outflow: number
  grade: ConfidenceGrade
  n: number
}

interface ReportData {
  key: string
  stocks: StockRecord[]
  stocksEff: PeriodKey | null
  flows: QuarterFlow[]
  partners: BilateralRecord[]
  partnersEff: PeriodKey | null
}

function NoObservation({ title, note }: { title: string; note: string }) {
  const { t } = useTranslation()
  return (
    <section className="border-t border-paper/10 px-6 py-5">
      <h3 className="dial-label text-paper-dim">{title}</h3>
      <div className="mt-3 border border-dashed border-paper/15 px-3 py-6 text-center">
        <p className="readout text-[11px] tracking-[0.12em] text-paper-dim/80">
          {t('common.noObservation')}
        </p>
        <p className="mt-1 font-sans text-[11px] text-paper-dim/60">{note}</p>
      </div>
    </section>
  )
}

/** grade mark: solid = observed, half = derived, hollow = modelled (§6) */
function gradeMark(grade: ConfidenceGrade): string {
  if (OBSERVED_GRADES.has(grade)) return '●'
  return grade === 'C' ? '◐' : '○'
}

/** 우측 슬라이드 관측 리포트 — 에디토리얼 조판, 실데이터 (DESIGN.md §5). */
export function ObservationReport() {
  const { t } = useTranslation()
  const selectedCountry = useViewStore((s) => s.selectedCountry)
  const selectCountry = useViewStore((s) => s.selectCountry)
  const setAppView = useViewStore((s) => s.setAppView)
  const openDossier = useViewStore((s) => s.openDossier)
  const basis = useViewStore((s) => s.basis)
  const includeEstimates = useViewStore((s) => s.includeEstimates)
  const periodIndex = useViewStore((s) => s.periodIndex)
  const appView = useViewStore((s) => s.appView)
  // STATION/SYNOPTIC은 자체 표면이 국가 데이터를 보여준다 — 리포트는 지구본 전용
  const open = selectedCountry !== null && appView === 'globe'

  const [countries, setCountries] = useState<Map<string, CountryMaster>>(
    () => new Map(),
  )
  const [data, setData] = useState<ReportData | null>(null)

  const period = periodFromIndex(periodIndex)
  // Phase L: CURR=LCU — 표시 층만 변환, 도시에 원값은 USD + FX 행 병기
  const money = useMoney(selectedCountry, 'country')
  const desiredKey = `${selectedCountry}|${basis}|${period}|${includeEstimates}`

  useEffect(() => {
    getCountries().then(setCountries).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedCountry) return
    let alive = true
    async function load() {
      const iso3 = selectedCountry as string
      const index = await getIndex()

      const stocksEff = nearestAvailable(
        index.periods[`stocks_${basis}`],
        period,
      )
      const stocks = stocksEff
        ? (await getStocks(basis, stocksEff)).records.filter(
            (r) =>
              r.country === iso3 &&
              (includeEstimates || OBSERVED_GRADES.has(r.confidence_grade)),
          )
        : []

      const flowPeriods = index.periods.flows_country
        .filter((p) => indexFromPeriod(p) <= indexFromPeriod(period))
        .slice(-12)
      const flows: QuarterFlow[] = []
      for (const p of flowPeriods) {
        const recs = (await getFlowsCountry(p)).records.filter(
          (r) =>
            r.country === iso3 &&
            r.measure === 'flow' &&
            (includeEstimates || OBSERVED_GRADES.has(r.confidence_grade)),
        )
        if (recs.length === 0) continue
        let inflow = 0
        let outflow = 0
        let grade: ConfidenceGrade = 'A'
        let maxAbs = -1
        for (const r of recs) {
          if (r.entry === 'liabilities') inflow += r.value_usd
          else outflow += r.value_usd
          if (Math.abs(r.value_usd) > maxAbs) {
            maxAbs = Math.abs(r.value_usd)
            grade = r.confidence_grade
          }
        }
        flows.push({ period: p, inflow, outflow, grade, n: recs.length })
      }

      const partnersEff = nearestAvailable(
        index.periods.flows_bilateral,
        period,
      )
      const partners = partnersEff
        ? (await getBilateral(partnersEff)).records
            .filter(
              (r) =>
                r.measure === 'stock' &&
                (r.owner_country === iso3 || r.issuer_country === iso3) &&
                (includeEstimates ||
                  OBSERVED_GRADES.has(r.confidence_grade)),
            )
            .sort((a, b) => Math.abs(b.value_usd) - Math.abs(a.value_usd))
            .slice(0, 6)
        : []

      if (alive) {
        setData({
          key: `${iso3}|${basis}|${period}|${includeEstimates}`,
          stocks,
          stocksEff,
          flows,
          partners,
          partnersEff,
        })
      }
    }
    load().catch(() => {
      if (alive) setData(null)
    })
    return () => {
      alive = false
    }
  }, [selectedCountry, basis, period, includeEstimates])

  const master = selectedCountry ? countries.get(selectedCountry) : undefined
  const current = data && data.key === desiredKey ? data : null
  const syncing = open && !current

  // ── headline aggregation ──────────────────────────────────────────────
  const reading = current
    ? summarizeStocks(current.stocks, includeEstimates).get(
        selectedCountry ?? '',
      )
    : undefined
  const estimated = current
    ? current.stocks.filter((r) => r.estimate_method !== undefined)
    : []
  const bounds =
    estimated.length > 0 && current
      ? current.stocks.reduce(
          (acc, r) => [
            acc[0] + (r.lower_bound ?? r.value_usd),
            acc[1] + (r.upper_bound ?? r.value_usd),
          ],
          [0, 0],
        )
      : null

  const headlineDossier = (): DossierPayload | null => {
    if (!current || !reading) return null
    return {
      title: `${master?.name ?? selectedCountry} — total cross-border position`,
      subtitle: `BASIS ${basis.toUpperCase()} · ${current.stocksEff ?? period}`,
      value_usd: reading.value,
      grade: reading.grade,
      method:
        estimated.length > 0
          ? `sum over ${current.stocks.length} asset classes (${estimated.length} estimated)`
          : undefined,
      lower_bound: bounds?.[0],
      upper_bound: bounds?.[1],
      effective_date: current.stocks[0]?.effective_date,
      source_ids: [...new Set(current.stocks.map((r) => r.source_id))],
      context: [
        [
          t('report.ctxCoverage'),
          t('report.ctxCoverageValue', { count: current.stocks.length }),
        ],
        [
          t('report.ctxView'),
          includeEstimates ? t('report.viewEst') : t('report.viewObs'),
        ],
        ...money.fxRows(reading.value, current.stocksEff ?? period),
      ],
    }
  }

  const treemapItems: TreemapItem[] = current
    ? current.stocks
        .map((r) => ({
          asset: r.asset,
          value: Math.abs(r.value_usd),
          grade: r.confidence_grade,
          fog: fogAlpha(r.confidence_grade),
        }))
        .filter((i) => i.value > 0)
    : []

  const maxFlow = current
    ? Math.max(
        1,
        ...current.flows.flatMap((f) => [
          Math.abs(f.inflow),
          Math.abs(f.outflow),
        ]),
      )
    : 1

  return (
    <aside
      aria-hidden={!open}
      inert={!open}
      className={
        'absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-full flex-col overflow-y-auto border-l border-paper/10 bg-ink-2/95 transition-transform duration-280 ease-(--ease-baro) ' +
        (open ? 'translate-x-0' : 'pointer-events-none translate-x-full')
      }
    >
      <div className="flex items-start justify-between px-6 pt-6">
        <div>
          <p className="readout text-[11px] tracking-[0.12em] text-paper-dim">
            {t('report.title')} · {period}
            {current?.stocksEff && current.stocksEff !== period
              ? ` · OBS ${current.stocksEff}`
              : ''}
          </p>
          <h2 className="font-display text-[clamp(3rem,6vw,5.5rem)] leading-[0.95] text-paper">
            {master?.name ?? selectedCountry ?? '—'}
          </h2>
          <p className="readout mt-1 text-[11px] tracking-[0.12em] text-paper-dim/70">
            {selectedCountry ?? ''}
            {master ? ` · ${master.region.toUpperCase()}` : ''}
          </p>
          <button
            type="button"
            onClick={() => setAppView('station')}
            aria-label={t('report.openStationAria')}
            className="dial-label mt-3 border-y border-flow-in/25 bg-ink-1/70 px-2.5 py-1.5 text-flow-in transition-colors duration-140 hover:border-flow-in/60"
          >
            {t('report.openStation')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => selectCountry(null)}
          aria-label={t('report.closeAria')}
          className="readout mt-1 px-2 py-1 text-[13px] text-paper-dim transition-colors duration-140 hover:text-paper"
        >
          ✕
        </button>
      </div>

      {syncing && (
        <p className="readout px-6 pt-3 text-[10px] tracking-[0.12em] text-flow-in/80">
          {t('report.syncing')}
        </p>
      )}

      <div className="mt-4">
        {/* Headline position */}
        {current && reading ? (
          <section className="border-t border-paper/10 px-6 py-5">
            <h3 className="dial-label text-paper-dim">
              {t('report.headline')} · {basis}
            </h3>
            <button
              type="button"
              onClick={() => {
                const p = headlineDossier()
                if (p) openDossier(p)
              }}
              className="mt-2 block text-left transition-opacity duration-140 hover:opacity-80"
              style={{ opacity: 1 - reading.fog * 0.6 }}
            >
              <Odometer
                text={money.fmtAt(reading.value, current.stocksEff ?? period)}
                className="font-display text-[clamp(2.6rem,5vw,3.6rem)] leading-none text-paper"
              />
            </button>
            <p className="readout mt-2 text-[10px] tracking-[0.1em] text-paper-dim">
              {gradeMark(reading.grade)}{' '}
              {t('report.gradeLine', {
                grade: reading.grade,
                count: current.stocks.length,
              })}
              {bounds
                ? ` · ${t('report.rangeLine', {
                    low: money.fmtAt(bounds[0], current.stocksEff ?? period),
                    high: money.fmtAt(bounds[1], current.stocksEff ?? period),
                  })}`
                : ''}
            </p>
          </section>
        ) : (
          !syncing && (
            <NoObservation
              title={t('report.headline')}
              note={
                includeEstimates
                  ? t('report.noRecordsAt', { period })
                  : t('report.estimatesHidden')
              }
            />
          )
        )}

        {/* Asset composition */}
        {current && treemapItems.length > 0 ? (
          <section className="border-t border-paper/10 px-6 py-5">
            <h3 className="dial-label text-paper-dim">
              {t('report.composition')}
            </h3>
            <div className="mt-3">
              <AssetTreemap
                items={treemapItems}
                fmt={(v, d) => money.fmtAt(v, current.stocksEff ?? period, d)}
                onPick={(asset) => {
                  const r = current.stocks.find((s) => s.asset === asset)
                  if (!r) return
                  openDossier({
                    title: `${ASSET_LABELS[asset]} — ${master?.name ?? r.country}`,
                    subtitle: `BASIS ${basis.toUpperCase()} · ${r.period}`,
                    value_usd: r.value_usd,
                    grade: r.confidence_grade,
                    method: r.estimate_method,
                    lower_bound: r.lower_bound,
                    upper_bound: r.upper_bound,
                    effective_date: r.effective_date,
                    source_ids: [r.source_id],
                    context: [
                      ['Measure', 'stock'],
                      ...money.fxRows(r.value_usd, r.period),
                    ],
                  })
                }}
              />
            </div>
          </section>
        ) : (
          !syncing && (
            <NoObservation
              title={t('report.composition')}
              note={t('report.noStockRecords')}
            />
          )
        )}

        {/* Net flows by quarter */}
        {current && current.flows.length > 0 ? (
          <section className="border-t border-paper/10 px-6 py-5">
            <h3 className="dial-label text-paper-dim">
              {t('report.flows', { count: current.flows.length })}
            </h3>
            <div className="mt-3 flex items-end gap-1.5">
              {current.flows.map((f) => (
                <button
                  key={f.period}
                  type="button"
                  onClick={() =>
                    openDossier({
                      title: `${master?.name ?? selectedCountry} — BOP financial-account flows`,
                      subtitle: f.period,
                      value_usd: f.inflow - f.outflow,
                      grade: f.grade,
                      effective_date: undefined,
                      source_ids: ['imf_bop'],
                      context: [
                        [t('report.ctxInflowSide'), formatUsdNet(f.inflow)],
                        [t('report.ctxOutflowSide'), formatUsdNet(f.outflow)],
                        [t('report.ctxRecords'), String(f.n)],
                        [t('report.ctxSign'), 'BPM6 — net acquisition basis'],
                        ...money.fxRows(f.inflow - f.outflow, f.period),
                      ],
                    })
                  }
                  title={t('report.flowBarTitle', {
                    period: f.period,
                    inflow: money.fmtNetAt(f.inflow, f.period),
                    outflow: money.fmtNetAt(f.outflow, f.period),
                  })}
                  className="group flex h-24 flex-1 flex-col items-center justify-center gap-px"
                >
                  <span className="relative h-10 w-full">
                    <span
                      className="absolute bottom-0 left-1/2 w-[38%] -translate-x-[110%] bg-flow-in/85 transition-colors group-hover:bg-flow-in"
                      style={{
                        height: `${(Math.abs(f.inflow) / maxFlow) * 100}%`,
                        opacity: f.inflow < 0 ? 0.35 : 1,
                      }}
                    />
                    <span
                      className="absolute bottom-0 left-1/2 w-[38%] translate-x-[10%] bg-flow-out/85 transition-colors group-hover:bg-flow-out"
                      style={{
                        height: `${(Math.abs(f.outflow) / maxFlow) * 100}%`,
                        opacity: f.outflow < 0 ? 0.35 : 1,
                      }}
                    />
                  </span>
                  <span className="readout text-[8px] text-paper-dim/70">
                    {f.period.slice(2).replace('-', '')}
                  </span>
                </button>
              ))}
            </div>
            <p className="readout mt-2 text-[9px] uppercase tracking-[0.1em] text-paper-dim/60">
              <span className="text-flow-in">■</span>{' '}
              <span className="text-flow-out">■</span> {t('report.legend')}
            </p>
          </section>
        ) : (
          !syncing && (
            <NoObservation
              title={t('report.flows', { count: 12 })}
              note={t('report.noBopRecords')}
            />
          )
        )}

        {/* Top counterparties */}
        {current && current.partners.length > 0 ? (
          <section className="border-t border-paper/10 px-6 py-5">
            <h3 className="dial-label text-paper-dim">
              {t('report.counterparties')}{' '}
              {current.partnersEff ? `· ${current.partnersEff}` : ''}
            </h3>
            <ul className="mt-3 space-y-1.5">
              {current.partners.map((r) => {
                const inbound = r.issuer_country === selectedCountry
                const partner = inbound ? r.owner_country : r.issuer_country
                return (
                  <li key={`${r.owner_country}-${r.issuer_country}-${r.asset}`}>
                    <button
                      type="button"
                      onClick={() =>
                        openDossier({
                          title: `${r.owner_country} → ${r.issuer_country} · ${ASSET_LABELS[r.asset]}`,
                          subtitle: `CPIS bilateral position · ${r.period}`,
                          value_usd: r.value_usd,
                          grade: r.confidence_grade,
                          method: r.estimate_method,
                          lower_bound: r.lower_bound,
                          upper_bound: r.upper_bound,
                          effective_date: r.effective_date,
                          source_ids: [r.source_id],
                          context: [
                            [
                              t('report.ctxDirection'),
                              inbound
                                ? t('report.directionIn')
                                : t('report.directionOut'),
                            ],
                            ...money.fxRows(r.value_usd, r.period),
                          ],
                        })
                      }
                      className="flex w-full items-baseline gap-2 text-left transition-colors duration-140 hover:bg-ink-1/60"
                    >
                      <span
                        className={
                          'readout w-10 text-[11px] ' +
                          (inbound ? 'text-flow-in' : 'text-flow-out')
                        }
                      >
                        {inbound ? '←' : '→'} {partner.slice(0, 3)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-paper">
                        {countries.get(partner)?.name ?? partner}
                        <span className="text-paper-dim">
                          {' '}
                          · {ASSET_LABELS[r.asset]}
                        </span>
                      </span>
                      <span
                        className="readout text-[11px] text-paper"
                        style={{
                          opacity: 1 - fogAlpha(r.confidence_grade) * 1.2,
                        }}
                      >
                        {gradeMark(r.confidence_grade)}{' '}
                        {money.fmtAt(Math.abs(r.value_usd), r.period, 1)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : (
          !syncing && (
            <NoObservation
              title={t('report.counterparties')}
              note={t('report.notCpisReporter')}
            />
          )
        )}
      </div>

      {/* visibility legend — grades render as fog before badges (§2, §6) */}
      <section className="mt-auto border-t border-paper/10 px-6 py-4">
        <h3 className="dial-label text-paper-dim">{t('report.visibility')}</h3>
        <div className="mt-2 flex items-center gap-1">
          {GRADES.map((g, i) => (
            <span
              key={g}
              className="readout relative flex h-6 w-9 items-center justify-center text-[10px] text-paper"
              style={{
                backgroundColor: `color-mix(in srgb, var(--pressure-2) ${60 - i * 12}%, var(--atlas-ink-1))`,
              }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-ink-0"
                style={{ opacity: `var(--fog-${g})` }}
              />
              <span className="relative">{g}</span>
            </span>
          ))}
          <span className="ml-2 font-sans text-[11px] text-paper-dim/70">
            {t('report.observedToFog')}
          </span>
        </div>
      </section>
    </aside>
  )
}
