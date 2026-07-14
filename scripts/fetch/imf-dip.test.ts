import { describe, expect, it } from 'vitest'
import { parseDip } from './imf-dip.ts'

const xml = (...series: string[]) =>
  `<StructureSpecificData><DataSet>${series.join('')}</DataSet></StructureSpecificData>`

const series = (attrs: string, period = '2024', value = 1) =>
  `<Series ${attrs}><Obs TIME_PERIOD="${period}" OBS_VALUE="${value}"/></Series>`

const base =
  'COUNTRY="KOR" DV_TYPE="O" INDICATOR="OTWD_D_NETAL_FALL_ALL" COUNTERPART_COUNTRY="USA" FREQUENCY="A" SCALE="6"'

describe('parseDip — direct outward bilateral FDI positions', () => {
  it('keeps only direct reported outward totals by ISO3 counterpart', () => {
    expect(parseDip(xml(series(base, '2024', 229_698_553_457.278)))).toEqual([
      {
        owner: 'KOR',
        issuer: 'USA',
        period: '2024-Q4',
        value: 229_698_553_457.278,
      },
    ])
  })

  it('rejects SCC, inward, aggregates, self-pairs, and component indicators', () => {
    expect(
      parseDip(
        xml(
          series(base.replace('DV_TYPE="O"', 'DV_TYPE="SCC"')),
          series(
            base.replace(
              'INDICATOR="OTWD_D_NETAL_FALL_ALL"',
              'INDICATOR="INWD_D_NETLA_FALL_ALL"',
            ),
          ),
          series(base.replace('COUNTERPART_COUNTRY="USA"', 'COUNTERPART_COUNTRY="G001"')),
          series(base.replace('COUNTERPART_COUNTRY="USA"', 'COUNTERPART_COUNTRY="KOR"')),
          series(
            base.replace(
              'INDICATOR="OTWD_D_NETAL_FALL_ALL"',
              'INDICATOR="OTWD_D_NETAL_F51_ALL"',
            ),
          ),
          series(base.replace('FREQUENCY="A"', 'FREQUENCY="Q"'), '2024-Q4'),
        ),
      ),
    ).toEqual([])
  })
})
