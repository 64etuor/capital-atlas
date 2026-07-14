import { describe, expect, it } from 'vitest'
import {
  DISCREPANCY_ISSUER,
  DISCREPANCY_OWNER,
  frechetPositionBounds,
  hasBottomUpSeed,
  rasClose,
} from './position-closure.ts'

const near = (a: number, b: number, tolerance = 1e-9) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b))

describe('rasClose — top-down/bottom-up position closure', () => {
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
