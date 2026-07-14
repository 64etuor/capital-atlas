import { describe, expect, it } from 'vitest'
import type { SynopticCorridor } from '../../types/data'
import {
  corridorCoverageLabel,
  corridorDossierPayload,
} from './corridorDossier'

const corridor = (
  source_id: SynopticCorridor['source_id'],
  position_basis: SynopticCorridor['position_basis'],
): SynopticCorridor => ({
  owner: 'KOR',
  issuer: 'USA',
  asset: source_id === 'imf_dip' ? 'unlisted_equity_fdi' : 'listed_equity',
  value: 100,
  grade: 'A',
  source_id,
  effective_date: '2024-12-31',
  position_basis,
})

describe('corridorDossierPayload — source and basis honesty', () => {
  it('labels PIP, DIP, and BIS positions by their actual source family', () => {
    expect(
      corridorDossierPayload(
        corridor('imf_pip', 'asset_liability'),
        '2024-Q4',
        false,
        0,
      ),
    ).toMatchObject({ subtitle: 'IMF PIP/CPIS bilateral position · 2024-Q4' })
    expect(
      corridorDossierPayload(
        corridor('imf_dip', 'directional_principle'),
        '2024-Q4',
        false,
        0,
      ),
    ).toMatchObject({ subtitle: 'IMF DIP bilateral position · 2024-Q4' })
    expect(
      corridorDossierPayload(
        corridor('bis_lbs', 'lbs_position_side'),
        '2024-Q4',
        false,
        0,
      ),
    ).toMatchObject({ subtitle: 'BIS LBS bilateral position · 2024-Q4' })
  })

  it('carries the position basis into dossier context', () => {
    expect(
      corridorDossierPayload(
        corridor('imf_dip', 'directional_principle'),
        '2024-Q4',
        false,
        1,
      ).context,
    ).toContainEqual(['Position basis', 'directional_principle'])
  })

  it('describes only source families and bases present in the selected shard', () => {
    expect(corridorCoverageLabel(['bis_lbs'], ['lbs_position_side'])).toBe(
      'BIS · LBS POSITION SIDE',
    )
    expect(
      corridorCoverageLabel(
        ['imf_pip', 'bis_lbs'],
        ['asset_liability', 'lbs_position_side'],
      ),
    ).toBe('PIP + BIS · MIXED BASES')
    expect(
      corridorCoverageLabel(['imf_pip'], ['asset_liability']),
    ).not.toContain('DIP')
  })
})
