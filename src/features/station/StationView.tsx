/**
 * STATION — 관측 분석 콘솔(3번째 표면). 국가 다이얼로 필터, 자산 탭으로
 * 상세 진입. 유동 판단의 핵심 = 흐름 분해(실거래 vs 평가효과 분리, §15.2).
 * 카드 금지(§1.4) — 계기 스트립·분석 시트·괘선 조판만.
 *
 * SYNOPTIC과 같은 방식으로 항상 마운트, GLOBE 위를 덮는다(§4 로드 1회).
 * 국가 선택은 지구본의 selectedCountry와 양방향 동기화된다.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewStore } from '../../store/viewStore'
import {
  getCountries,
  getStation,
  getStationIndex,
  nearestAvailable,
} from '../../lib/dataClient'
import { periodFromIndex } from '../../lib/periods'
import { formatUsd, formatUsdNet } from '../../lib/format'
import { useMoney } from '../../lib/money'
import { ASSET_LABELS } from '../../lib/assetLabels'
import type {
  CountryMaster,
  PeriodKey,
  StationFile,
  StationIndexFile,
  StationPoint,
} from '../../types/data'
import type { DossierPayload } from '../../types/dossier'
import { CountryDial } from './CountryDial'
import { AssetRail, type AssetTab } from './AssetRail'
import {
  FlowChart,
  type ChartExportCtx,
  type FlowReadout,
} from './FlowChart'
import {
  CompositionStream,
  type CompositionMode,
} from './CompositionStream'
import { SmallMultiples } from './SmallMultiples'
import { StockBandChart } from './StockBandChart'
import { PartnerMatrix } from './PartnerMatrix'
import { LedgerTable } from './LedgerTable'
import { GaugeStrip, type Gauge } from './GaugeStrip'
import {
  assetsPresent,
  concentrationAt,
  convertStationFile,
  flowArrays,
  flowIntensity,
  hhiClass,
  nearestPoint,
  stockAt,
  yoyStock,
} from './derive'
import { OBSERVED_GRADES, STATION_ASSET_ORDER, quarterEnd } from './shared'

const INK_BG =
  'linear-gradient(180deg, var(--atlas-ink-0) 0%, var(--atlas-ink-1) 55%, var(--atlas-ink-2) 130%)'

export function StationView() {
  const { t } = useTranslation()
  const appView = useViewStore((s) => s.appView)
  const periodIndex = useViewStore((s) => s.periodIndex)
  const setPeriodIndex = useViewStore((s) => s.setPeriodIndex)
  const includeEstimates = useViewStore((s) => s.includeEstimates)
  const selectedCountry = useViewStore((s) => s.selectedCountry)
  const selectCountry = useViewStore((s) => s.selectCountry)
  const openDossier = useViewStore((s) => s.openDossier)

  const visible = appView === 'station'
  const observedOnly = !includeEstimates
  const iso = selectedCountry ?? 'WLD'
  const period = periodFromIndex(periodIndex)

  const [index, setIndex] = useState<StationIndexFile | null>(null)
  const [names, setNames] = useState<Map<string, CountryMaster>>(
    () => new Map(),
  )
  const [file, setFile] = useState<StationFile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // 자산 탭 = 스토어 stationAsset — URL 딥링크·커맨드 팔레트와 단일 경로
  const tab = useViewStore((s) => s.stationAsset)
  const setTab = useViewStore((s) => s.setStationAsset)

  useEffect(() => {
    if (!visible || index) return
    let alive = true
    Promise.all([getStationIndex(), getCountries()])
      .then(([i, c]) => {
        if (alive) {
          setIndex(i)
          setNames(c)
        }
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(String(err))
      })
    return () => {
      alive = false
    }
  }, [visible, index])

  const known = iso === 'WLD' || (index?.countries.includes(iso) ?? false)

  useEffect(() => {
    if (!visible || !known) return
    let alive = true
    getStation(iso)
      .then((f) => {
        if (alive) {
          setFile(f)
          setLoadError(null)
        }
      })
      .catch((err: unknown) => {
        if (alive) setLoadError(String(err))
      })
    return () => {
      alive = false
    }
  }, [visible, iso, known])

  const current = file?.iso3 === iso ? file : null
  const name =
    iso === 'WLD' ? 'World' : (names.get(iso)?.name ?? iso)
  const dialCountries = (index?.countries ?? []).map((c) => ({
    iso3: c,
    name: names.get(c)?.name ?? c,
  }))

  // 국가 전환으로 사라진 자산 탭은 ALL로 강등 (setState 없이 렌더 시 해석)
  const present = current ? assetsPresent(current) : []
  const effTab: AssetTab =
    tab !== 'all' && !present.includes(tab) ? 'all' : tab

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={
        'absolute inset-0 z-[7] transition-opacity duration-280 ease-(--ease-baro) ' +
        (visible ? 'opacity-100' : 'pointer-events-none opacity-0')
      }
      style={{ background: INK_BG }}
    >
      {!known ? (
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <p className="readout text-[12px] tracking-[0.18em] text-paper-dim">
            NO STATION OBSERVATIONS FOR {iso}
          </p>
          <CountryDial
            countries={dialCountries}
            currentIso={iso}
            currentName={name}
            onSelect={selectCountry}
          />
        </div>
      ) : !current ? (
        <div className="readout flex h-full items-center justify-center text-[12px] tracking-[0.18em] text-paper-dim">
          {loadError
            ? `STATION FEED UNAVAILABLE — ${loadError}`
            : t('common.preparing')}
        </div>
      ) : (
        <StationBody
          file={current}
          iso={iso}
          name={name}
          dialCountries={dialCountries}
          onSelect={selectCountry}
          tab={effTab}
          onTab={setTab}
          observedOnly={observedOnly}
          periodIndex={periodIndex}
          period={period}
          onPickPeriod={setPeriodIndex}
          openDossier={openDossier}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- body ----

interface BodyProps {
  file: StationFile
  iso: string
  name: string
  dialCountries: Array<{ iso3: string; name: string }>
  onSelect: (iso3: string | null) => void
  tab: AssetTab
  onTab: (t: AssetTab) => void
  observedOnly: boolean
  periodIndex: number
  period: PeriodKey
  onPickPeriod: (i: number) => void
  openDossier: (p: DossierPayload) => void
}

function StationBody({
  file,
  iso,
  name,
  dialCountries,
  onSelect,
  tab,
  onTab,
  observedOnly,
  periodIndex,
  period,
  onPickPeriod,
  openDossier,
}: BodyProps) {
  const { t } = useTranslation()
  // I-5: ALL 탭 구성 영역 보기 전환 (STREAM/MULTIPLES)
  const [compMode, setCompMode] = useState<CompositionMode>('stream')
  // Phase L: CURR=LCU — 표시 층만 변환, 도시에 원값·집계는 항상 USD
  const money = useMoney(
    iso === 'WLD' ? null : iso,
    iso === 'WLD' ? 'global' : 'country',
  )
  const present = assetsPresent(file)
  const assetLabel = tab === 'all' ? 'ALL ASSETS' : ASSET_LABELS[tab]
  const exportBase = {
    country: iso,
    countryName: name,
    asset: tab === 'all' ? 'all' : tab,
    period,
  }
  const flowExportCtx: ChartExportCtx = {
    ...exportBase,
    sourceIds: ['imf_bop', 'imf_iip'],
  }
  const compExportCtx: ChartExportCtx = { ...exportBase, sourceIds: ['imf_iip'] }
  const flows = flowArrays(file, tab, observedOnly)
  // LCU 활성 시 차트 전용 변환 사본 — 축·툴팁·바가 전부 같은 통화가 되게
  const chartFile =
    money.mode === 'lcu' ? convertStationFile(file, money.convertAt) : file
  const chartFlows =
    money.mode === 'lcu' ? flowArrays(chartFile, tab, observedOnly) : flows
  const stock = stockAt(file, tab, periodIndex, observedOnly)
  const intensity = flowIntensity(file, tab, periodIndex, observedOnly)
  const yoy = yoyStock(file, tab, periodIndex, observedOnly)
  const conc = concentrationAt(file, tab, periodIndex)
  // §6: OBS 모드에선 관측(A/B) 아닌 파생 지표 리드아웃도 소멸
  const gateObs = <T,>(grade: string | undefined, v: T): T | null =>
    observedOnly && grade !== undefined && !OBSERVED_GRADES.has(grade as never)
      ? null
      : v
  const worldShare =
    iso === 'WLD'
      ? null
      : gateObs(
          conc.quarterly?.grade,
          tab === 'all'
            ? (conc.quarterly?.share_of_world ?? null)
            : (conc.quarterly?.share_of_world_assets[tab] ?? null),
        )
  const cp = gateObs(conc.cp?.grade, conc.cp)

  const flowInNow = flows.flowIn[periodIndex]
  const flowOutNow = flows.flowOut[periodIndex]
  const netNow =
    flowInNow === null && flowOutNow === null
      ? null
      : (flowInNow ?? 0) - (flowOutNow ?? 0)
  const valNow = flows.valuation[periodIndex]

  const flowGradeNow = (() => {
    let g: string | undefined
    const order = { A: 0, B: 1, C: 2, D: 3, E: 4 } as const
    for (const a of tab === 'all' ? present : [tab]) {
      const p = (file.series[a] ?? []).find((x) => x.period === period)
      if (p?.flow_grade && (!g || order[p.flow_grade] > order[g as 'A']))
        g = p.flow_grade
    }
    return (g ?? 'A') as DossierPayload['grade']
  })()

  const flowDossier = (
    kind: 'IN' | 'OUT' | 'NET' | 'VAL',
    value: number,
  ): DossierPayload => ({
    title: `${name} · ${assetLabel} — ${
      kind === 'VAL' ? 'valuation change' : `${kind.toLowerCase()} flow`
    }`,
    subtitle: `BOP quarterly · ${period}`,
    value_usd: value,
    grade: kind === 'VAL' ? 'C' : flowGradeNow,
    method:
      kind === 'VAL'
        ? 'delta_position_minus_transactions'
        : kind === 'NET'
          ? 'inflow_side_minus_outflow_side'
          : undefined,
    effective_date: quarterEnd(period),
    source_ids: kind === 'VAL' ? ['imf_iip', 'imf_bop'] : ['imf_bop'],
    context: [
      ['IN (nonresident side)', formatUsdNet(flowInNow ?? 0)],
      ['OUT (resident side)', formatUsdNet(flowOutNow ?? 0)],
      ['Sign', 'BPM6 — net acquisition basis'],
    ],
  })

  const stockDossier = (): DossierPayload => {
    const single =
      tab !== 'all' ? nearestPoint(file.series[tab] ?? [], periodIndex) : null
    return {
      title: `${name} · ${assetLabel} — cross-border stock`,
      subtitle: `OWNER BASIS · ${period}`,
      value_usd: stock.total,
      grade: single
        ? single.grade
        : stock.obsTotal / (stock.total || 1) >= 0.8
          ? 'B'
          : 'C',
      method: single?.method ?? (iso === 'WLD' || tab === 'all'
        ? 'sum_of_constituent_records'
        : undefined),
      lower_bound: single?.stock_lower,
      upper_bound: single?.stock_upper,
      effective_date: quarterEnd(single?.period ?? period),
      source_ids: single?.source_id ? [single.source_id] : ['imf_iip'],
      context: [
        ['Observed share', `${((stock.obsTotal / (stock.total || 1)) * 100).toFixed(0)}%`],
        ['Constituents', `${stock.points.length} asset series`],
      ],
    }
  }

  const gauges: Gauge[] = [
    {
      label: 'STOCK',
      value: stock.total > 0 ? money.fmtAt(stock.total, period, 2) : '—',
      tone: 'paper',
      dossier: {
        ...stockDossier(),
        context: [...stockDossier().context, ...money.fxRows(stock.total, period)],
      },
    },
    {
      label: 'NET 4Q',
      value: money.fmtNetAt(intensity.net4, period),
      tone: intensity.net4 >= 0 ? 'in' : 'out',
      dossier: {
        ...flowDossier('NET', intensity.net4),
        title: `${name} · ${assetLabel} — trailing 4Q net flow`,
        method: 'sum_net_flow_trailing_4_quarters',
        context: [
          ...flowDossier('NET', intensity.net4).context,
          ...money.fxRows(intensity.net4, period),
        ],
      },
    },
    {
      label: 'INTENSITY',
      value:
        intensity.intensity === null
          ? '—'
          : `${(intensity.intensity * 100).toFixed(2)}%`,
      tone: 'paper',
      dossier: {
        title: `${name} · ${assetLabel} — flow intensity`,
        subtitle: `trailing 4Q · ${period}`,
        value_usd: intensity.net4,
        grade: 'C',
        method: 'net_flow_4q / avg(open,close stock)',
        effective_date: quarterEnd(period),
        source_ids: ['imf_bop', 'imf_iip'],
        context: [
          ['Charter §14', 'intensity = period net inflow / mean(open, close) balance'],
        ],
      },
    },
    {
      label: 'YOY',
      value: yoy === null ? '—' : `${yoy >= 0 ? '+' : ''}${(yoy * 100).toFixed(1)}%`,
      tone: yoy !== null && yoy < 0 ? 'out' : 'in',
      dossier: {
        title: `${name} · ${assetLabel} — stock YoY`,
        subtitle: `${period} vs 4 quarters earlier`,
        value_usd: stock.total,
        grade: 'C',
        method: 'stock_t / stock_t-4 − 1 (nearest available)',
        effective_date: quarterEnd(period),
        source_ids: ['imf_iip'],
        context: [['Includes valuation effects', 'yes — not a pure flow measure']],
      },
    },
    {
      label: 'VISIBILITY',
      value:
        stock.total > 0
          ? `${((stock.obsTotal / stock.total) * 100).toFixed(0)}%`
          : '—',
      tone: 'dim',
      dossier: {
        title: `${name} · ${assetLabel} — visibility`,
        subtitle: `value-weighted observed (A/B) share · ${period}`,
        value_usd: stock.obsTotal,
        grade: 'A',
        effective_date: quarterEnd(period),
        source_ids: ['imf_iip'],
        context: [['Observed', formatUsd(stock.obsTotal, 1)], ['Total', formatUsd(stock.total, 1)]],
      },
    },
    // §14 집중도 계기 — WLD는 세계 대비/상대국 개념이 정의되지 않아 생략
    ...(iso !== 'WLD'
      ? ([
          {
            label: 'WORLD SHARE',
            value:
              worldShare !== null ? `${(worldShare * 100).toFixed(2)}%` : '—',
            tone: 'paper',
            dossier: conc.quarterly
              ? {
                  title: `${name} · ${assetLabel} — share of world`,
                  subtitle: `stocks_owner · ${conc.quarterly.period}`,
                  value_usd: stock.total,
                  grade: conc.quarterly.grade,
                  method: conc.quarterly.method,
                  effective_date: quarterEnd(conc.quarterly.period),
                  source_ids: conc.quarterly.source_ids,
                  context: [
                    [
                      'Share of world',
                      worldShare !== null
                        ? `${(worldShare * 100).toFixed(2)}%`
                        : '— (observed-only mode)',
                    ],
                    ['Charter §14', 'world share = adjusted balance_c / Σ_c adjusted balance'],
                  ],
                }
              : {
                  title: `${name} — share of world`,
                  subtitle: 'no concentration data for this scope',
                  value_usd: 0,
                  grade: 'A',
                  source_ids: ['imf_iip'],
                  context: [['Reason', 'no owner-basis stock records']],
                },
          },
          {
            label: 'TOP-5 CP',
            value: cp ? `${(cp.top5_share * 100).toFixed(0)}%` : '—',
            tone: 'paper',
            dossier: cp
              ? {
                  title: `${name} · ${assetLabel} — top-5 counterparty share`,
                  subtitle: `Bilateral positions · ${cp.period}`,
                  value_usd: cp.gross_usd,
                  grade: cp.grade,
                  method: cp.method,
                  effective_date: quarterEnd(cp.period),
                  source_ids: cp.source_ids,
                  context: [
                    ...cp.top5.map(
                      (t5): [string, string] => [
                        t5.country,
                        `${(t5.share * 100).toFixed(1)}%`,
                      ],
                    ),
                    ['Counterparties', String(cp.n_partners)],
                  ],
                }
              : {
                  title: `${name} · ${assetLabel} — top-5 counterparty share`,
                  subtitle: 'no bilateral positions for this scope',
                  value_usd: 0,
                  grade: 'A',
                  source_ids: ['imf_pip', 'bis_lbs'],
                  context: [
                    ['Reason', 'no CPIS/LBS bilateral reporting for this scope'],
                  ],
                },
          },
          {
            label: 'CP HHI',
            value: cp ? `${cp.hhi.toFixed(2)} · ${hhiClass(cp.hhi)}` : '—',
            tone: cp && cp.hhi >= 0.25 ? 'in' : 'dim',
            dossier: cp
              ? {
                  title: `${name} · ${assetLabel} — counterparty HHI`,
                  subtitle: `Bilateral positions · ${cp.period}`,
                  value_usd: cp.gross_usd,
                  grade: cp.grade,
                  method: cp.method,
                  effective_date: quarterEnd(cp.period),
                  source_ids: cp.source_ids,
                  context: [
                    ['HHI', cp.hhi.toFixed(4)],
                    ['Class', `${hhiClass(cp.hhi)} (0.15 / 0.25 bands)`],
                    ['Top counterparty', cp.top5[0]?.country ?? '—'],
                    ['Counterparties', String(cp.n_partners)],
                  ],
                }
              : {
                  title: `${name} · ${assetLabel} — counterparty HHI`,
                  subtitle: 'no bilateral positions for this scope',
                  value_usd: 0,
                  grade: 'A',
                  source_ids: ['imf_pip', 'bis_lbs'],
                  context: [
                    ['Reason', 'no CPIS/LBS bilateral reporting for this scope'],
                  ],
                },
          },
        ] satisfies Gauge[])
      : []),
    {
      label: 'RANGE',
      value: file.summary.first ? `${file.summary.first}→${file.summary.latest ?? ''}` : '—',
      tone: 'dim',
      dossier: {
        title: `${name} — observation range`,
        subtitle: 'station pre-aggregation',
        value_usd: file.summary.n_points,
        grade: 'A',
        source_ids: ['imf_iip', 'imf_bop'],
        context: [
          ['Points', String(file.summary.n_points)],
          ['Generated', file.generated_at.slice(0, 10)],
        ],
      },
    },
  ]

  const flowDossierFx = (
    kind: 'IN' | 'OUT' | 'NET' | 'VAL',
    value: number,
  ): DossierPayload => {
    const p = flowDossier(kind, value)
    return { ...p, context: [...p.context, ...money.fxRows(value, period)] }
  }
  const readouts: FlowReadout[] = [
    {
      label: 'IN',
      value: flowInNow === null ? '—' : money.fmtNetAt(flowInNow, period),
      tone: 'in',
      onClick: () => openDossier(flowDossierFx('IN', flowInNow ?? 0)),
    },
    {
      label: 'OUT',
      value: flowOutNow === null ? '—' : money.fmtNetAt(flowOutNow, period),
      tone: 'out',
      onClick: () => openDossier(flowDossierFx('OUT', flowOutNow ?? 0)),
    },
    {
      label: 'NET',
      value: netNow === null ? '—' : money.fmtNetAt(netNow, period),
      tone: 'paper',
      onClick: () => openDossier(flowDossierFx('NET', netNow ?? 0)),
    },
    ...(observedOnly
      ? []
      : [
          {
            label: 'VAL',
            value: valNow === null ? '—' : money.fmtNetAt(valNow, period),
            tone: 'dim' as const,
            onClick: () => openDossier(flowDossierFx('VAL', valNow ?? 0)),
          },
        ]),
  ]

  const partnerPeriods = Object.keys(file.partners).sort() as PeriodKey[]
  const partnerEff = nearestAvailable(partnerPeriods, period)
  const partnerEntry = partnerEff ? file.partners[partnerEff] : undefined
  const partnerSides =
    tab === 'all' ? partnerEntry?.all : partnerEntry?.assets[tab]
  const partnerEmpty =
    iso === 'WLD'
      ? t('station.matrixSelect')
      : t('station.matrixNone')

  const tabPoints: StationPoint[] = tab === 'all' ? [] : (file.series[tab] ?? [])
  const nearestNow = tab === 'all' ? null : nearestPoint(tabPoints, periodIndex)
  // §6: OBS 모드에선 추정 등급 리드아웃도 소멸 — 차트와 같은 규칙
  const currentPoint =
    nearestNow && (!observedOnly || OBSERVED_GRADES.has(nearestNow.grade))
      ? nearestNow
      : null

  return (
    // pt-40: 좌상 명판(뷰 토글 행 ~155px)이 국가 다이얼 클릭을 가로채지 않게
    <div className="flex h-full flex-col gap-3 pb-24 pl-6 pr-28 pt-40">
      <header className="flex shrink-0 items-end justify-between gap-6">
        <div className="min-w-0">
          <CountryDial
            countries={dialCountries}
            currentIso={iso}
            currentName={name}
            onSelect={onSelect}
          />
          <h2 className="mt-1 font-display text-[clamp(28px,3.4vw,42px)] leading-none text-paper">
            {name}
            {tab !== 'all' && (
              <span className="text-paper-dim"> · {ASSET_LABELS[tab]}</span>
            )}
          </h2>
          <p className="readout mt-1.5 text-[10px] tracking-[0.12em] text-paper-dim">
            CROSS-BORDER{' '}
            {money.fmtAt(
              file.summary.stock_total,
              (file.summary.latest ?? period) as PeriodKey,
              2,
            )}{' '}
            · LATEST {file.summary.latest ?? '—'} · OWNER BASIS ·{' '}
            {(file.summary.obs_share * 100).toFixed(0)}% OBSERVED
          </p>
        </div>
        <AssetRail
          assets={[...STATION_ASSET_ORDER]}
          available={new Set(present)}
          shares={conc.quarterly?.asset_shares}
          tab={tab}
          onTab={onTab}
        />
      </header>

      <GaugeStrip gauges={gauges} />

      {tab === 'all' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-8">
          <div className="grid min-h-0 grid-rows-[minmax(0,11fr)_minmax(0,9fr)] gap-3">
            <FlowChart
              title={`FLOW DECOMPOSITION · IN/OUT/NET · VALUATION SEPARATE · ${period}`}
              flowIn={chartFlows.flowIn}
              flowOut={chartFlows.flowOut}
              valuation={chartFlows.valuation}
              observedOnly={observedOnly}
              periodIndex={periodIndex}
              onPickPeriod={onPickPeriod}
              readouts={readouts}
              exportCtx={flowExportCtx}
              fmtNet={money.displayNet}
              fmtValue={money.display}
            />
            {compMode === 'stream' ? (
              <CompositionStream
                series={chartFile.series}
                observedOnly={observedOnly}
                periodIndex={periodIndex}
                onPickPeriod={onPickPeriod}
                exportCtx={compExportCtx}
                mode={compMode}
                onMode={setCompMode}
                fmtValue={money.display}
              />
            ) : (
              <SmallMultiples
                file={chartFile}
                observedOnly={observedOnly}
                periodIndex={periodIndex}
                onTab={onTab}
                mode={compMode}
                onMode={setCompMode}
                fmtNet={money.displayNet}
              />
            )}
          </div>
          <PartnerMatrix
            sides={partnerSides}
            effPeriod={partnerEff}
            iso3={iso}
            assetLabel="ALL ASSETS"
            observedOnly={observedOnly}
            emptyHint={partnerEmpty}
            fmt={(v, d) => money.fmtAt(v, partnerEff ?? period, d)}
            fxRows={(v) => money.fxRows(v, partnerEff ?? period)}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-8">
          <div className="grid min-h-0 grid-rows-[minmax(0,11fr)_minmax(0,9fr)] gap-3">
            <StockBandChart
              points={chartFile.series[tab] ?? []}
              observedOnly={observedOnly}
              periodIndex={periodIndex}
              onPickPeriod={onPickPeriod}
              fmtValue={money.display}
              currentLabel={
                currentPoint
                  ? `${money.fmtAt(currentPoint.stock, currentPoint.period, 2)} · ${currentPoint.grade}`
                  : null
              }
              onOpenCurrent={
                currentPoint
                  ? () =>
                      openDossier({
                        ...stockDossier(),
                        context: [
                          ...stockDossier().context,
                          ...money.fxRows(
                            currentPoint.stock,
                            currentPoint.period,
                          ),
                        ],
                      })
                  : null
              }
            />
            <FlowChart
              title={`FLOW DECOMPOSITION · ${ASSET_LABELS[tab].toUpperCase()} · ${period}`}
              flowIn={chartFlows.flowIn}
              flowOut={chartFlows.flowOut}
              valuation={chartFlows.valuation}
              observedOnly={observedOnly}
              periodIndex={periodIndex}
              onPickPeriod={onPickPeriod}
              readouts={readouts}
              exportCtx={flowExportCtx}
              fmtNet={money.displayNet}
              fmtValue={money.display}
            />
          </div>
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <PartnerMatrix
              sides={partnerSides}
              effPeriod={partnerEff}
              iso3={iso}
              assetLabel={ASSET_LABELS[tab]}
              observedOnly={observedOnly}
              emptyHint={partnerEmpty}
              fmt={(v, d) => money.fmtAt(v, partnerEff ?? period, d)}
              fxRows={(v) => money.fxRows(v, partnerEff ?? period)}
            />
            <LedgerTable
              points={
                observedOnly
                  ? tabPoints.filter((p) => OBSERVED_GRADES.has(p.grade))
                  : tabPoints
              }
              iso3={iso}
              assetLabel={ASSET_LABELS[tab]}
              fmtAt={money.fmtAt}
              fmtNetAt={money.fmtNetAt}
              fxRowsAt={money.fxRows}
            />
          </div>
        </div>
      )}
    </div>
  )
}
