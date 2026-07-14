import { ASSET_LABELS } from '../../lib/assetLabels'
import type {
  BilateralPositionBasis,
  StationAllocationCoverage,
} from '../../types/data'
import type { AssetTab } from './AssetRail'
import type { DossierPayload } from '../../types/dossier'

export const OBSERVATION_COVERAGE_LABEL = 'OBS STOCK'
export const COUNTERPARTY_ALLOCATION_LABEL = 'CP ALLOC'
export const COUNTERPARTY_SOURCE_IDS = [
  'imf_pip',
  'imf_dip',
  'bis_lbs',
] as const
export const COUNTERPARTY_NO_DATA_REASON =
  'no PIP/DIP/BIS bilateral positions for this scope'

export const unavailableCounterpartyDossier = (
  title: string,
  reason = COUNTERPARTY_NO_DATA_REASON,
  sourceIds: readonly string[] = COUNTERPARTY_SOURCE_IDS,
  extraContext: Array<[string, string]> = [],
): DossierPayload => ({
  status: 'unavailable',
  title,
  subtitle: 'no publishable counterparty ratio for this scope',
  source_ids: [...sourceIds],
  context: [['Status', 'UNAVAILABLE'], ['Reason', reason], ...extraContext],
})

export const visibleAllocationCoverage = (
  coverage: StationAllocationCoverage,
  observedOnly: boolean,
): StationAllocationCoverage =>
  observedOnly &&
  coverage.status === 'available' &&
  !['A', 'B'].includes(coverage.confidence_grade)
    ? {
        status: 'unavailable',
        reason: 'estimated owner-stock denominator is hidden in OBS mode',
      }
    : coverage

export const counterpartyScopeLabel = (tab: AssetTab): string =>
  tab === 'all'
    ? 'BILATERAL-COVERED ASSETS'
    : ASSET_LABELS[tab].toUpperCase()

export const formatAllocationCoverage = (
  coverage: StationAllocationCoverage,
): string =>
  coverage.status === 'available'
    ? `${(coverage.share * 100).toFixed(0)}%`
    : 'UNAVAIL'

export const formatPositionBases = (
  bases: readonly BilateralPositionBasis[],
): string => bases.join(' + ')
