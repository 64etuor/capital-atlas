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
  return {
    title: `${owner} → ${issuer} · ${assetLabel} — bilateral position`,
    subtitle: `CPIS/PIP · ${period}`,
    value_usd: partner.value,
    grade: partner.grade,
    method: partner.method,
    lower_bound: partner.lower,
    upper_bound: partner.upper,
    range_label: partner.range_label,
    effective_date: partner.effective_date,
    source_ids: partner.source_ids ?? [partner.source_id],
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
