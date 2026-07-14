import { describe, expect, it } from 'vitest'
import {
  DISCREPANCY_ISSUER,
  DISCREPANCY_OWNER,
  boundPositionValue,
  buildClosureAuditInputs,
  encodeClosureAuditInputs,
  frechetPositionBounds,
  hasBottomUpSeed,
  rawPipSeedForClosure,
  rasClose,
} from './position-closure.ts'
import { gunzipSync } from 'node:zlib'

const near = (a: number, b: number, tolerance = 1e-9) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b))

describe('rasClose — top-down/bottom-up position closure', () => {
  it('publishes a deterministic audit mirror of the normalized official inputs', () => {
    const audit = buildClosureAuditInputs(
      [
        {
          iso3: 'USA',
          entry: 'L_P',
          indicator: 'P_F5_MV',
          quarter: '2024-Q4',
          value: 80,
        },
        {
          iso3: 'KOR',
          entry: 'A_P',
          indicator: 'P_F5_MV',
          quarter: '2024-Q4',
          value: 100,
        },
        {
          iso3: 'KOR',
          entry: 'A_P',
          indicator: 'D',
          quarter: '2024-Q4',
          value: 999,
        },
      ],
      [
        {
          owner: 'KOR',
          issuer: 'USA',
          indicator: 'P_F51_P_USD',
          year: 2024,
          value: 50_000_000,
        },
      ],
    )

    expect(audit).toEqual({
      schema_version: 1,
      source_ids: ['imf_iip', 'imf_pip'],
      iip: [
        {
          iso3: 'KOR',
          entry: 'A_P',
          indicator: 'P_F5_MV',
          quarter: '2024-Q4',
          value: 100,
        },
        {
          iso3: 'USA',
          entry: 'L_P',
          indicator: 'P_F5_MV',
          quarter: '2024-Q4',
          value: 80,
        },
      ],
      pip: [
        {
          owner: 'KOR',
          issuer: 'USA',
          indicator: 'P_F51_P_USD',
          year: 2024,
          value: 50_000_000,
        },
      ],
    })
    const first = encodeClosureAuditInputs(audit)
    const second = encodeClosureAuditInputs(audit)
    expect(first.equals(second)).toBe(true)
    expect(JSON.parse(gunzipSync(first).toString())).toEqual(audit)
  })

  it('builds the seed from unpruned raw normalized PIP observations', () => {
    const seed = rawPipSeedForClosure(
      [
        {
          owner: 'KOR',
          issuer: 'USA',
          indicator: 'P_F51_P_USD',
          year: 2024,
          value: 50_000_000,
        },
        {
          owner: 'KOR',
          issuer: 'JPN',
          indicator: 'P_F3_P_USD',
          year: 2024,
          value: 20_000_000,
        },
        {
          owner: 'KOR',
          issuer: 'USA',
          indicator: 'P_F51_P_USD',
          year: 2023,
          value: 10_000_000,
        },
        {
          owner: 'KOR',
          issuer: 'KOR',
          indicator: 'P_F51_P_USD',
          year: 2024,
          value: 30_000_000,
        },
        {
          owner: 'OUT',
          issuer: 'USA',
          indicator: 'P_F51_P_USD',
          year: 2024,
          value: 40_000_000,
        },
      ],
      '2024-Q4',
      'listed_equity',
      { KOR: 100_000_000 },
      { USA: 100_000_000 },
    )

    // $50M is intentionally below the public bilateral-shard floor. Keeping it
    // proves the closure seed comes from raw PIP, not that pruned public view.
    expect(seed).toEqual([
      { row: 'KOR', column: 'USA', value: 50_000_000 },
    ])
  })

  it('clips floating-point residue to the exact published Fréchet corridor', () => {
    expect(boundPositionValue(100.0000001, 0, 100)).toBe(100)
    expect(boundPositionValue(-0.0000001, 0, 100)).toBe(0)
  })

  it('refuses to publish a closure when no bottom-up observation exists', () => {
    expect(hasBottomUpSeed([])).toBe(false)
    expect(hasBottomUpSeed([{ row: 'KOR', column: 'USA', value: 0 }])).toBe(false)
    expect(hasBottomUpSeed([{ row: 'KOR', column: 'USA', value: 1 }])).toBe(true)
  })
  it('closes a nonnegative direct seed to independent row and column margins', () => {
    const result = rasClose(
      [
        { row: 'KOR', column: 'USA', value: 30 },
        { row: 'KOR', column: 'JPN', value: 10 },
        { row: 'DEU', column: 'USA', value: 5 },
        { row: 'DEU', column: 'JPN', value: 5 },
      ],
      { KOR: 60, DEU: 40 },
      { USA: 70, JPN: 30 },
    )

    expect(result.converged).toBe(true)
    expect(result.iterations).toBeLessThanOrEqual(100)
    expect(result.residual).toBeLessThanOrEqual(1e-9)
    for (const [row, margin] of Object.entries(result.rowMargins)) {
      const sum = result.cells
        .filter((cell) => cell.row === row)
        .reduce((total, cell) => total + cell.value, 0)
      expect(near(sum, margin), row).toBe(true)
    }
    for (const [column, margin] of Object.entries(result.columnMargins)) {
      const sum = result.cells
        .filter((cell) => cell.column === column)
        .reduce((total, cell) => total + cell.value, 0)
      expect(near(sum, margin), column).toBe(true)
    }
    expect(result.cells.every((cell) => cell.value >= 0)).toBe(true)
  })

  it('counts direct-seed coverage only inside the IIP row and column domains', () => {
    const result = rasClose(
      [
        { row: 'KOR', column: 'USA', value: 30 },
        { row: 'OUT', column: 'USA', value: 70 },
        { row: 'KOR', column: 'OUT', value: 20 },
      ],
      { KOR: 100 },
      { USA: 100 },
    )
    expect(result.directSeedShare).toBe(0.3)
  })

  it('adds an explicit discrepancy margin instead of silently rescaling unequal totals', () => {
    const moreAssets = rasClose([], { KOR: 100 }, { USA: 80 })
    expect(moreAssets.columnMargins[DISCREPANCY_ISSUER]).toBe(20)

    const moreLiabilities = rasClose([], { KOR: 80 }, { USA: 100 })
    expect(moreLiabilities.rowMargins[DISCREPANCY_OWNER]).toBe(20)
  })

  it('attaches assumption-free Fréchet bounds to every adjusted cell', () => {
    expect(frechetPositionBounds(60, 70, 100)).toEqual({ lower: 30, upper: 60 })
    const result = rasClose([], { KOR: 60, DEU: 40 }, { USA: 70, JPN: 30 })
    for (const cell of result.cells) {
      expect(cell.lower).toBeLessThanOrEqual(cell.value + 1e-9)
      expect(cell.upper).toBeGreaterThanOrEqual(cell.value - 1e-9)
    }
  })
})
