/**
 * v3 exposure observatory. Direct A-grade facts stay crisp; reconstructed,
 * constant-FX and RAS values are explicitly labeled and disappear in OBS mode.
 * Ruled rows only — this is an instrument sheet, not a card farm.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getExposure,
  getDebtMarket,
  getPositionClosure,
  getPositionClosureIndex,
  nearestAvailable,
} from '../../lib/dataClient'
import { formatUsd } from '../../lib/format'
import type {
  CurrencyExposureRecord,
  DebtMarketRecord,
  FxdAvailable,
  PeriodKey,
  PositionClosureCell,
  PositionClosureFile,
  ReconstructedLiability,
  SectorPositionRecord,
} from '../../types/data'
import type { DossierPayload } from '../../types/dossier'
import {
  closurePublicationForCountry,
  exposureAt,
  type ClosurePublication,
} from './exposure'
import { selectDebtMarket } from './debtMarket'
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

const DEBT_SECTOR_LABELS: Record<DebtMarketRecord['sector'], string> = {
  S1: 'TOTAL ECONOMY',
  S11: 'NON-FIN CORP',
  S12: 'FINANCIAL CORP',
  S121: 'CENTRAL BANK',
  S122: 'DEPOSIT TAKERS',
  S123: 'MONEY FUNDS',
  S125A: 'SECURITISATION SPV',
  S12P: 'OTHER FINANCE',
  S12Q: 'INSURANCE + PENSION',
  S12T: 'MFIs EX CENTRAL BANK',
  S13: 'GOVERNMENT',
  S1311: 'CENTRAL GOVERNMENT',
  S1M: 'HOUSEHOLDS + NPISH',
  S1ZS: 'DOMESTIC SECTORS',
}

const selectedPositionAsset = (asset: AssetTab) =>
  asset === 'listed_equity' || asset === 'debt_securities' ? asset : undefined

function FactButton({
  label,
  value,
  grade,
  derived = false,
  compact = false,
  onClick,
}: {
  label: string
  value: number
  grade: 'A' | 'C' | 'D' | 'E'
  derived?: boolean
  compact?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'readout grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 border-t px-1 text-left transition-[color,opacity,transform] duration-140 hover:text-paper active:translate-y-px ' +
        (compact ? 'py-0.5 text-[8px] ' : 'py-1 text-[9px] ') +
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

const debtMarketDossier = (
  row: DebtMarketRecord,
  name: string,
): DossierPayload => ({
  title: `${name} · ${DEBT_SECTOR_LABELS[row.sector]} debt ${row.measure}`,
  subtitle: `DIRECT BIS DEBT SECURITIES STATISTICS · ${row.period}`,
  value_usd: row.value_usd,
  grade: 'A',
  effective_date: row.effective_date,
  source_ids: [row.source_id],
  context: [
    ['Accounting entry', row.accounting_entry],
    ['Counterparty scope', row.counterparty_scope],
    ['Sector code', `${row.sector} (reported hierarchy; not inferred or summed)`],
    ['Measure', row.measure === 'stock' ? 'closing stock' : 'net transactions'],
    ['Valuation', 'market value'],
    ['Unit', 'current USD (BIS-published conversion)'],
    ['Boundary', 'national debt market; not merged into cross-border asset stocks'],
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
  source_ids: [row.source_id, ...row.source_ids],
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
  source_ids: row.source_ids,
  context: [
    ['Asset', row.asset],
    ['Coverage', `${(row.coverage_share * 100).toFixed(1)}% of top-down margin`],
    ['Status', 'derived from counterpart assets; not a direct liability report'],
  ],
})

const closureDossier = (
  row: PositionClosureCell,
  name: string,
  publication: ClosurePublication,
): DossierPayload => ({
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
    [
      'Published matrix',
      `${publication.published_cells} of ${publication.total_cells} leading cells`,
    ],
    [
      'Omitted tail',
      `${publication.omitted_cells} cells · ${formatUsd(publication.omitted_value_usd, 1)}`,
    ],
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
  const [debtLoaded, setDebtLoaded] = useState<{
    key: string
    file: Awaited<ReturnType<typeof getDebtMarket>> | null
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

  useEffect(() => {
    if (iso === 'WLD') return
    let alive = true
    getDebtMarket(iso)
      .then((file) => {
        if (alive) setDebtLoaded({ key: iso, file })
      })
      .catch(() => {
        if (alive) setDebtLoaded({ key: iso, file: null })
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
  const positionAsset = selectedPositionAsset(asset)
  const selection = current
    ? exposureAt(current, period, observedOnly, positionAsset)
    : null
  const currencyRows = (selection?.currency ?? [])
    .filter((row) => row.sector === 'S1')
    .sort((a, b) => (a.currency === 'TOTAL' ? -1 : b.currency === 'TOTAL' ? 1 : b.value_usd - a.value_usd))
    .slice(0, 3)
  const sectorRows = (selection?.sectors ?? [])
    .sort((a, b) => b.value_usd - a.value_usd)
    .slice(0, 3)
  const fxdRows = selection?.fxd.slice(0, 2) ?? []
  const reconstructedRows = (selection?.reconstructed ?? [])
    .slice(0, 1)
  const closureCurrent = closureLoaded?.key === closureKey ? closureLoaded.file : null
  const closurePublication = closureCurrent
    ? closurePublicationForCountry(closureCurrent, iso, observedOnly, positionAsset)
    : null
  const closureRows = closureCurrent && closurePublication
    ? closurePublication.cells.slice(0, 1).map((row) => ({
        row,
        publication: closurePublicationForCountry(
          closureCurrent,
          iso,
          false,
          row.asset,
        ),
      }))
    : []
  const hasOmittedClosureTail =
    closureRows.length === 0 && (closurePublication?.omitted_cells ?? 0) > 0
  const debtCurrent = debtLoaded?.key === iso ? debtLoaded.file : undefined
  const debtSelection = debtCurrent ? selectDebtMarket(debtCurrent, period) : null
  const debtRows =
    debtSelection?.status === 'available'
      ? [
          ['ISSUED · TOTAL', debtSelection.issued],
          ['NET ISSUE', debtSelection.net_issuance],
          [
            debtSelection.top_issuer_sector
              ? `ISSUER · ${debtSelection.top_issuer_sector.sector}`
              : 'ISSUER · TOP',
            debtSelection.top_issuer_sector,
          ],
          ['FOREIGN HELD', debtSelection.nonresident_held],
          ['ABROAD · TOTAL', debtSelection.foreign_assets],
          [
            debtSelection.top_foreign_holder_sector
              ? `HOLDER · ${debtSelection.top_foreign_holder_sector.sector}`
              : 'HOLDER · TOP',
            debtSelection.top_foreign_holder_sector,
          ],
        ].filter((row): row is [string, DebtMarketRecord] => row[1] !== undefined)
      : []
  const debtState =
    iso === 'WLD'
      ? t('station.exposure.world')
      : debtCurrent === undefined
      ? t('station.exposure.debtLoading')
      : debtCurrent === null
        ? t('station.exposure.noDebtCountry')
        : debtSelection?.status === 'unavailable'
          ? t(
              debtSelection.reason === 'no_comparable_headline_on_or_before_target'
                ? 'station.exposure.noDebtHeadline'
                : 'station.exposure.noDebtPeriod',
            )
          : null

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
          EXPOSURE · TARGET {period} · USD
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
        <div className="mt-1 grid min-h-0 flex-1 grid-cols-[1fr_1fr_1.08fr_1.18fr] divide-x divide-paper/8 overflow-hidden">
          <Column title={t('station.exposure.currency')}>
            {currencyRows.length === 0 ? (
              <p className="readout text-[8px] leading-snug text-paper-dim/60">
                {t('station.exposure.noCurrency')}
              </p>
            ) : (
              currencyRows.map((row) => (
                <FactButton
                  key={`${row.entry}|${row.currency}`}
                  label={`${row.entry === 'assets' ? 'A' : 'L'} · ${CURRENCY_LABELS[row.currency]} · ${row.period}`}
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
                  label={`${row.sector} · ${SECTOR_LABELS[row.sector]} · ${row.period}`}
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
                      label={`FXD ${row.entry.toUpperCase()} · ${row.period}`}
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
                      FXD {row.entry.toUpperCase()} · {row.period} · {t('station.exposure.unavailable')} — {row.reason}
                    </p>
                  ),
                )}
                {reconstructedRows.map((row) => (
                  <FactButton
                    key={`recon|${row.asset}`}
                    label={`RECON · ${row.asset === 'listed_equity' ? 'EQTY' : 'DEBT'} · ${row.period}`}
                    value={row.value_usd}
                    grade="C"
                    derived
                    onClick={() => openDossier(reconstructedDossier(row, name))}
                  />
                ))}
                {closureRows.map(({ row, publication }) => (
                  <FactButton
                    key={`ras|${row.asset}|${row.owner_country}|${row.issuer_country}`}
                    label={`RAS · ${row.owner_country}→${row.issuer_country} · ${row.period}`}
                    value={row.value_usd}
                    grade="E"
                    derived
                    onClick={() => openDossier(closureDossier(row, name, publication))}
                  />
                ))}
                {hasOmittedClosureTail && (
                  <p className="readout border-t border-dashed border-paper/12 py-1 text-[8px] leading-snug text-paper-dim/65">
                    RAS · NO PUBLISHED CELL FOR COUNTRY — MATRIX TAIL OMITTED
                  </p>
                )}
                {fxdRows.length + reconstructedRows.length + closureRows.length === 0 &&
                  !hasOmittedClosureTail && (
                  <p className="readout text-[8px] leading-snug text-paper-dim/60">
                    {t('station.exposure.noDerived')}
                  </p>
                  )}
              </>
            )}
          </Column>
          <Column title={t('station.exposure.debtMarket')}>
            {debtState ? (
              <p className="readout text-[8px] leading-snug text-paper-dim/60">
                {debtState}
              </p>
            ) : (
              debtRows.map(([label, row]) => (
                <FactButton
                  key={`${row.accounting_entry}|${row.counterparty_scope}|${row.sector}|${row.measure}`}
                  label={`${label} · ${row.period}`}
                  value={row.value_usd}
                  grade="A"
                  compact
                  onClick={() => openDossier(debtMarketDossier(row, name))}
                />
              ))
            )}
          </Column>
        </div>
      )}
    </section>
  )
}
