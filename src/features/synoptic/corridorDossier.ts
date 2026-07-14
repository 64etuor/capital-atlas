import { ASSET_LABELS } from '../../lib/assetLabels'
import type { SynopticCorridor } from '../../types/data'
import type { DossierPayload } from '../../types/dossier'

const SOURCE_LABELS: Record<string, string> = {
  imf_pip: 'IMF PIP/CPIS',
  imf_dip: 'IMF DIP',
  bis_lbs: 'BIS LBS',
}

const SOURCE_SHORT_LABELS: Record<string, string> = {
  imf_pip: 'PIP',
  imf_dip: 'DIP',
  bis_lbs: 'BIS',
}
const SOURCE_ORDER = ['imf_pip', 'imf_dip', 'bis_lbs']

export const corridorCoverageLabel = (
  sourceIds: readonly string[],
  positionBases: readonly string[],
): string => {
  const sources = [...new Set(sourceIds)].sort(
    (a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b),
  )
  const sourceLabel = sources
    .map((source) => SOURCE_SHORT_LABELS[source] ?? source.toUpperCase())
    .join(' + ')
  const bases = [...new Set(positionBases)]
  const basisLabel =
    bases.length > 1
      ? 'MIXED BASES'
      : (bases[0] ?? 'NO POSITION BASIS').replaceAll('_', ' ').toUpperCase()
  return `${sourceLabel || 'NO SOURCE'} · ${basisLabel}`
}

export const bilateralPositionSubtitle = (
  sourceId: string,
  period: string,
): string =>
  `${SOURCE_LABELS[sourceId] ?? sourceId} bilateral position · ${period}`

export const corridorDossierPayload = (
  corridor: SynopticCorridor,
  period: string,
  isFlow: boolean,
  rank: number,
): DossierPayload => ({
  title: `${corridor.owner} → ${corridor.issuer} · ${ASSET_LABELS[corridor.asset]}`,
  subtitle: isFlow
    ? `Derived bilateral position change · ${period}`
    : bilateralPositionSubtitle(corridor.source_id, period),
  value_usd: corridor.value,
  grade: corridor.grade,
  method: corridor.method,
  lower_bound: corridor.lower,
  upper_bound: corridor.upper,
  effective_date: corridor.effective_date,
  source_ids: [corridor.source_id],
  context: [
    ['Rank', `#${rank + 1} by |value| this period`],
    ['Position basis', corridor.position_basis],
  ],
})
