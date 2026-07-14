/**
 * v3 exposure observatory. Direct A-grade facts stay crisp; reconstructed,
 * constant-FX and RAS values are explicitly labeled and disappear in OBS mode.
 * Ruled rows only — this is an instrument sheet, not a card farm.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getExposure,
  getPositionClosure,
  getPositionClosureIndex,
  nearestAvailable,
} from '../../lib/dataClient'
import { formatUsd } from '../../lib/format'
import type {
  CurrencyExposureRecord,
  FxdAvailable,
  PeriodKey,
  PositionClosureCell,
  PositionClosureFile,
  ReconstructedLiability,
  SectorPositionRecord,
} from '../../types/data'
import type { DossierPayload } from '../../types/dossier'
import { closureCellsForCountry, exposureAt } from './exposure'
import type { AssetTab } from './AssetRail'

interface Props {
  iso: string
  name: string
  period: PeriodKey
  asset: AssetTab
  observedOnly: boolean
  openDossier: (payload: DossierPayload) => void
}

const CURRENCY_LABELS: Record<CurrencyExposureRecord['currency'], string> = {
  TOTAL: 'ALL CURRENCIES',
  USD: 'USD',
  EUR: 'EUR',
  JPY: 'JPY',
  XDC: 'DOMESTIC',
  OTHC: 'OTHER',
  UALLC: 'UNALLOCATED',
}

const SECTOR_LABELS: Record<SectorPositionRecord['sector'], string> = {
  S1: 'TOTAL ECONOMY',
  S11: 'NON-FIN CORP',
  S121: 'CENTRAL BANK',
  S122: 'DEPOSIT TAKERS',
  S123: 'MONEY FUNDS',
  S12P: 'PENSION FUNDS',
  S12QU: 'INSURANCE',
  S12R: 'OTHER FINANCE',
  S13: 'GOVERNMENT',
  S14: 'HOUSEHOLDS',
  S15: 'NPISH',
  S1V: 'NFC + HH + NPISH',
}

const selectedPositionAsset = (asset: AssetTab) =>
  asset === 'listed_equity' || asset === 'debt_securities' ? asset : undefined

function FactButton({
  label,
  value,
  grade,
  derived = false,
  onClick,
}: {
  label: string
  value: number
  grade: 'A' | 'C' | 'D' | 'E'
  derived?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'readout grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-t px-1 py-1 text-left text-[9px] transition-[color,opacity,transform] duration-140 hover:text-paper active:translate-y-px ' +
        (derived
          ? 'border-dashed border-paper/12 text-paper/70'
          : 'border-paper/8 text-paper')
      }
      title={`${label} · ${formatUsd(value, 1)} · ${grade}`}
    >
      <span className="truncate text-paper-dim">{label}</span>
      <span className="tabular-nums">
        {formatUsd(value, 1)} · {grade}
      </span>
    </button>
  )
}

const directCurrencyDossier = (
  row: CurrencyExposureRecord,
  name: string,
): DossierPayload => ({
  title: `${name} · ${CURRENCY_LABELS[row.currency]} currency exposure`,
  subtitle: `DIRECT IIP CURRENCY COMPOSITION · ${row.period}`,
  value_usd: row.value_usd,
  grade: 'A',
  effective_date: row.effective_date,
  source_ids: [row.source_id],
  context: [
    ['Entry', row.entry],
    ['Sector code', `${row.sector} (reported, not inferred)`],
    ['Currency bucket', row.currency],
  ],
})

const directSectorDossier = (
  row: SectorPositionRecord,
  name: string,
): DossierPayload => ({
  title: `${name} · ${SECTOR_LABELS[row.sector]} position`,
  subtitle: `DIRECT PIP SECTOR OBSERVATION · ${row.period}`,
  value_usd: row.value_usd,
  grade: 'A',
  effective_date: row.effective_date,
  source_ids: [row.source_id],
  context: [
    ['Sector code', `${row.sector} (exact IMF category)`],
    ['Asset', row.asset],
    ['Aggregation', 'none — hierarchical rows are not summed'],
  ],
})

const fxdDossier = (row: FxdAvailable, name: string): DossierPayload => ({
  title: `${name} · constant-FX ${row.entry}`,
  subtitle: `FXD · BASE ${row.base_period} · ${row.period}`,
  value_usd: row.value_usd,
  grade: row.confidence_grade,
  method: row.estimate_method,
  lower_bound: row.lower_bound,
  upper_bound: row.upper_bound,
  range_label: 'currency residual sensitivity',
  effective_date: row.effective_date,
  source_ids: ['model_constant_fx', 'imf_iipcc', 'imf_ifs_fx'],
  context: [
    ['Coverage', `${(row.coverage_share * 100).toFixed(1)}% identified currencies`],
    ['Residual', `${(row.residual_share * 100).toFixed(1)}%`],
    ['Point convention', row.confidence_grade === 'D' ? 'residual held unchanged' : 'exact identified buckets'],
  ],
})

const reconstructedDossier = (
  row: ReconstructedLiability,
  name: string,
): DossierPayload => ({
  title: `${name} · reconstructed portfolio liability`,
  subtitle: `COUNTERPARTY VIEW · ${row.period}`,
  value_usd: row.value_usd,
  grade: 'C',
  method: row.estimate_method,
  lower_bound: row.lower_bound,
  upper_bound: row.upper_bound,
  range_label: 'bottom-up ↔ top-down corridor',
  effective_date: row.effective_date,
  source_ids: [row.source_id],
  context: [
    ['Asset', row.asset],
    ['Coverage', `${(row.coverage_share * 100).toFixed(1)}% of top-down margin`],
    ['Status', 'derived from counterpart assets; not a direct liability report'],
  ],
})

const closureDossier = (row: PositionClosureCell, name: string): DossierPayload => ({
  title: `${name} · ${row.owner_country} → ${row.issuer_country} position closure`,
  subtitle: `RAS MODEL · ${row.asset} · ${row.period}`,
  value_usd: row.value_usd,
  grade: 'E',
  method: row.estimate_method,
  lower_bound: row.lower_bound,
  upper_bound: row.upper_bound,
  range_label: 'Fréchet bounds',
  effective_date: row.effective_date,
  source_ids: ['model_position_closure', ...row.source_ids],
  context: [
    ['Direct seed coverage', `${(row.coverage_share * 100).toFixed(1)}%`],
    ['Margins', 'IMF IIP assets/liabilities'],
    ['Seed', 'IMF PIP direct bilateral positions'],
  ],
})

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden px-2 first:pl-0 last:pr-0">
      <p className="dial-label mb-1 truncate text-[8px] text-paper-dim/70">{title}</p>
      {children}
    </div>
  )
}

export function ExposurePanel({
  iso,
  name,
  period,
  asset,
  observedOnly,
  openDossier,
}: Props) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState<{
    key: string
    file: Awaited<ReturnType<typeof getExposure>> | null
  } | null>(null)
  const [closureLoaded, setClosureLoaded] = useState<{
    key: string
    file: PositionClosureFile | null
  } | null>(null)

  useEffect(() => {
    if (iso === 'WLD') return
    let alive = true
    getExposure(iso)
      .then((file) => {
        if (alive) setLoaded({ key: iso, file })
      })
      .catch(() => {
        if (alive) setLoaded({ key: iso, file: null })
      })
    return () => {
      alive = false
    }
  }, [iso])

  const closureKey = `${iso}|${period}`
  useEffect(() => {
    if (iso === 'WLD' || observedOnly) return
    let alive = true
    getPositionClosureIndex()
      .then((index) => {
        const effective = nearestAvailable(index.periods, period)
        return effective ? getPositionClosure(effective) : null
      })
      .then((file) => {
        if (alive) setClosureLoaded({ key: closureKey, file })
      })
      .catch(() => {
        if (alive) setClosureLoaded({ key: closureKey, file: null })
      })
    return () => {
      alive = false
    }
  }, [iso, period, observedOnly, closureKey])

  const current = loaded?.key === iso ? loaded.file : undefined
  const selection = current ? exposureAt(current, period, observedOnly) : null
  const positionAsset = selectedPositionAsset(asset)
  const currencyRows = (selection?.currency ?? [])
    .filter((row) => row.sector === 'S1')
    .sort((a, b) => (a.currency === 'TOTAL' ? -1 : b.currency === 'TOTAL' ? 1 : b.value_usd - a.value_usd))
    .slice(0, 3)
  const sectorRows = (selection?.sectors ?? [])
    .filter((row) => positionAsset === undefined || row.asset === positionAsset)
    .sort((a, b) => b.value_usd - a.value_usd)
    .slice(0, 3)
  const fxdRows = selection?.fxd.slice(0, 2) ?? []
  const reconstructedRows = (selection?.reconstructed ?? [])
    .filter((row) => positionAsset === undefined || row.asset === positionAsset)
    .slice(0, 1)
  const closureCurrent = closureLoaded?.key === closureKey ? closureLoaded.file : null
  const closureRows = closureCurrent
    ? closureCellsForCountry(closureCurrent, iso, observedOnly, positionAsset).slice(0, 1)
    : []

  const directState =
    iso === 'WLD'
      ? t('station.exposure.world')
      : current === undefined
        ? t('station.exposure.loading')
        : current === null
          ? t('station.exposure.absent')
          : null

  return (
    <section
      className="flex min-h-0 flex-col border-y border-paper/10 py-1"
      aria-label={t('station.exposure.aria')}
    >
      <header className="flex shrink-0 items-baseline justify-between gap-2">
        <p className="dial-label text-paper-dim/80">
          EXPOSURE · {period} · USD
        </p>
        <p className="readout text-[8px] tracking-[0.08em] text-paper-dim/50">
          {observedOnly ? t('station.exposure.obs') : t('station.exposure.est')}
        </p>
      </header>
      {directState ? (
        <p className="readout flex flex-1 items-center text-[9px] tracking-[0.1em] text-paper-dim">
          {directState}
        </p>
      ) : (
        <div className="mt-1 grid min-h-0 flex-1 grid-cols-[1fr_1fr_1.15fr] divide-x divide-paper/8 overflow-hidden">
          <Column title={t('station.exposure.currency')}>
            {currencyRows.length === 0 ? (
              <p className="readout text-[8px] leading-snug text-paper-dim/60">
                {t('station.exposure.noCurrency')}
              </p>
            ) : (
              currencyRows.map((row) => (
                <FactButton
                  key={`${row.entry}|${row.currency}`}
                  label={`${row.entry === 'assets' ? 'A' : 'L'} · ${CURRENCY_LABELS[row.currency]}`}
                  value={row.value_usd}
                  grade="A"
                  onClick={() => openDossier(directCurrencyDossier(row, name))}
                />
              ))
            )}
          </Column>
          <Column title={t('station.exposure.sector')}>
            {sectorRows.length === 0 ? (
              <p className="readout text-[8px] leading-snug text-paper-dim/60">
                {t('station.exposure.noSector')}
              </p>
            ) : (
              sectorRows.map((row) => (
                <FactButton
                  key={`${row.asset}|${row.sector}`}
                  label={`${row.sector} · ${SECTOR_LABELS[row.sector]}`}
                  value={row.value_usd}
                  grade="A"
                  onClick={() => openDossier(directSectorDossier(row, name))}
                />
              ))
            )}
          </Column>
          <Column title={t('station.exposure.derived')}>
            {observedOnly ? (
              <p className="readout text-[8px] leading-snug text-paper-dim/60">
                {t('station.exposure.derivedHidden')}
              </p>
            ) : (
              <>
                {fxdRows.map((row) =>
                  row.status === 'available' ? (
                    <FactButton
                      key={`fxd|${row.entry}`}
                      label={`FXD ${row.entry.toUpperCase()}`}
                      value={row.value_usd}
                      grade={row.confidence_grade}
                      derived
                      onClick={() => openDossier(fxdDossier(row, name))}
                    />
                  ) : (
                    <p
                      key={`fxd|${row.entry}`}
                      className="readout border-t border-dashed border-paper/12 py-1 text-[8px] leading-snug text-paper-dim/65"
                    >
                      FXD {row.entry.toUpperCase()} · {t('station.exposure.unavailable')} — {row.reason}
                    </p>
                  ),
                )}
                {reconstructedRows.map((row) => (
                  <FactButton
                    key={`recon|${row.asset}`}
                    label={`RECON · ${row.asset === 'listed_equity' ? 'EQTY' : 'DEBT'}`}
                    value={row.value_usd}
                    grade="C"
                    derived
                    onClick={() => openDossier(reconstructedDossier(row, name))}
                  />
                ))}
                {closureRows.map((row) => (
                  <FactButton
                    key={`ras|${row.asset}|${row.owner_country}|${row.issuer_country}`}
                    label={`RAS · ${row.owner_country}→${row.issuer_country}`}
                    value={row.value_usd}
                    grade="E"
                    derived
                    onClick={() => openDossier(closureDossier(row, name))}
                  />
                ))}
                {fxdRows.length + reconstructedRows.length + closureRows.length === 0 && (
                  <p className="readout text-[8px] leading-snug text-paper-dim/60">
                    {t('station.exposure.noDerived')}
                  </p>
                )}
              </>
            )}
          </Column>
        </div>
      )}
    </section>
  )
}
