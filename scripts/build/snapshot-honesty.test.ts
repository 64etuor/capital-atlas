import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../fetch/lib.ts'

const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

describe('mutable snapshot claims', () => {
  it('routes changing counts and sizes to generated SSOTs instead of prose literals', () => {
    const prose = [
      read('README.md'),
      read('docs/DATA_CONTRACT.md'),
      read('docs/DATA_PIPELINE.md'),
      read('docs/architecture.md'),
    ].join('\n')

    for (const staleLiteral of [
      '505,316',
      '261,579',
      '16.4%',
      '99.8%',
      '99.82%',
      '~150KB',
      '~36%',
      '~386 KB',
    ]) {
      expect(prose, staleLiteral).not.toContain(staleLiteral)
    }
    expect(prose).toContain('meta/facts_summary.json')
    expect(prose).toContain('meta/pipeline_report.json')
  })

  it('does not claim an uncomputed bilateral value-retention percentage', () => {
    const source = [
      read('scripts/build/assemble.ts'),
      read('scripts/build/concentration.ts'),
    ].join('\n')
    const report = JSON.parse(read('public/data/meta/pipeline_report.json')) as {
      bilateral_pruning: { note: string }
    }
    const stationMethods = readdirSync(join(REPO_ROOT, 'public/data/station'))
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => {
        const station = JSON.parse(read(`public/data/station/${name}`)) as {
          concentration?: { counterparty?: Array<{ method: string }> }
        }
        return station.concentration?.counterparty?.map((row) => row.method) ?? []
      })

    expect(source).not.toMatch(/16\.4%|99\.8|0\.2% of value/)
    expect(source).toContain('value retention is not computed')
    expect(report.bilateral_pruning.note).toBe(
      'value retention is not computed; use the recorded dropped record counts',
    )
    expect(stationMethods.length).toBeGreaterThan(0)
    expect(
      stationMethods.find((method) => /99\.8%|99\.82%|0\.2% of value/.test(method)),
    ).toBeUndefined()
    expect(
      stationMethods.some((method) => method.includes('value retention is not computed')),
    ).toBe(true)
  })
})
