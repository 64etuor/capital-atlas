import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('pipeline publication order', () => {
  it('does not write the country master until every required network stage passed', () => {
    const source = readFileSync(new URL('./run.ts', import.meta.url), 'utf8')
    const loadCountries = source.indexOf('buildCountries()')
    const lastRequiredStage = source.indexOf('await runFx(iso3s)')
    const publishCountries = source.indexOf('runCountries(countries)')

    expect(loadCountries).toBeGreaterThan(-1)
    expect(lastRequiredStage).toBeGreaterThan(loadCountries)
    expect(publishCountries).toBeGreaterThan(lastRequiredStage)
    expect(source.slice(loadCountries, lastRequiredStage)).not.toContain(
      'runCountries(',
    )
  })
})
