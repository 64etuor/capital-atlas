import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = new URL('..', import.meta.url).pathname

const contracts = [
  ['components/ObservationReport.tsx', 'compact', 1],
  ['components/LineageDossier.tsx', 'inline', 2],
  ['features/synoptic/SynopticView.tsx', 'full', 1],
  ['features/station/StationView.tsx', 'full', 1],
  ['features/station/ExposurePanel.tsx', 'compact', 1],
  ['features/station/ExposurePanel.tsx', 'inline', 2],
  ['features/station/ReallocationMatrix.tsx', 'compact', 1],
] as const

describe('loading affordance coverage', () => {
  it.each(contracts)(
    '%s renders %s observatory loader(s) at least %i time(s)',
    (relative, variant, minimum) => {
      const source = readFileSync(join(SRC, relative), 'utf8')
      const matches = source.match(
        new RegExp(`<ObservationLoader[^>]*variant="${variant}"`, 'g'),
      )

      expect(matches?.length ?? 0).toBeGreaterThanOrEqual(minimum)
    },
  )

  it('lineage rows do not fall back to ambiguous ellipsis loading', () => {
    const source = readFileSync(
      join(SRC, 'components/LineageDossier.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/kind === 'loading' && '…'/)
  })
})
