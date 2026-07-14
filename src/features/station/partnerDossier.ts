import type { PeriodKey, StationPartner } from '../../types/data'
import type { DossierPayload } from '../../types/dossier'

export interface PartnerDossierContext {
  owner: string
  issuer: string
  assetLabel: string
  period: PeriodKey
  asset?: string
  fxRows?: (valueUsd: number) => Array<[string, string]>
}

export function partnerDossierPayload(
  partner: StationPartner,
  context: PartnerDossierContext,
): DossierPayload {
  const { owner, issuer, assetLabel, period, asset, fxRows } = context
  const sourceLabels: Record<string, string> = {
    imf_pip: 'IMF PIP/CPIS',
    imf_dip: 'IMF DIP',
    imf_iip: 'IMF IIP',
    bis_lbs: 'BIS LBS',
  }
  const sources = partner.source_ids ?? [partner.source_id]
  const sourceLabel = sources
    .map((source) => sourceLabels[source] ?? source)
    .join(' + ')
  return {
    title: `${owner} → ${issuer} · ${assetLabel} — bilateral position`,
    subtitle: `${sourceLabel} · ${period}`,
    value_usd: partner.value,
    grade: partner.grade,
    method: partner.method,
    lower_bound: partner.lower,
    upper_bound: partner.upper,
    range_label: partner.range_label,
    effective_date: partner.effective_date,
    source_ids: sources,
    ...(partner.source_id === 'bis_lbs' &&
    (asset === 'deposits' || asset === 'loans')
      ? {
          mirror_key: {
            owner,
            issuer,
            period,
            side: (asset === 'loans' ? 'claims' : 'liabilities') as
              | 'claims'
              | 'liabilities',
          },
        }
      : {}),
    context: [
      ['Direction', `${owner} holds ${issuer}`],
      ['Position basis', partner.position_bases.join(' + ')],
      ...(partner.coverage_share !== undefined
        ? ([
            [
              'Coverage',
              `${(partner.coverage_share * 100).toFixed(1)}% of top-down margin`,
            ],
          ] as Array<[string, string]>)
        : []),
      ...(fxRows?.(partner.value) ?? []),
    ],
  }
}
