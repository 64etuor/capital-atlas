import { describe, expect, it } from 'vitest'
import type { StationPartner } from '../../types/data'
import { partnerDossierPayload } from './partnerDossier'

describe('partnerDossierPayload — side-specific lineage', () => {
  const direct: StationPartner = {
    country: 'USA',
    value: 100,
    grade: 'A',
    source_id: 'imf_pip',
    effective_date: '2024-12-31',
  }
  const reconstructed: StationPartner = {
    country: 'USA',
    value: 80,
    grade: 'C',
    source_id: 'imf_pip',
    source_ids: ['imf_pip', 'imf_iip'],
    effective_date: '2024-12-31',
    method: 'counterparty_assets_transposed_with_proportional_top_down_corridor',
    lower: 70,
    upper: 90,
    range_label: 'proportional bottom-up ↔ top-down corridor',
    coverage_share: 0.8,
  }

  it('does not let the opposite side overwrite the clicked direct value grade', () => {
    expect(
      partnerDossierPayload(direct, {
        owner: 'KOR',
        issuer: 'USA',
        assetLabel: 'EQUITY',
        period: '2024-Q4',
      }),
    ).toMatchObject({ value_usd: 100, grade: 'A', source_ids: ['imf_pip'] })
  })

  it('carries both IIP/PIP lineage, coverage, method, and range for the derived side', () => {
    const payload = partnerDossierPayload(reconstructed, {
      owner: 'USA',
      issuer: 'KOR',
      assetLabel: 'EQUITY',
      period: '2024-Q4',
    })
    expect(payload).toMatchObject({
      value_usd: 80,
      grade: 'C',
      source_ids: ['imf_pip', 'imf_iip'],
      method: reconstructed.method,
      lower_bound: 70,
      upper_bound: 90,
      range_label: reconstructed.range_label,
    })
    expect(payload.context).toContainEqual(['Coverage', '80.0% of top-down margin'])
  })
})
