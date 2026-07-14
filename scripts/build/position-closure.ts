/** Bounded RAS/IPF position closure. Direct PIP seeds are never overwritten. */
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  BilateralRecord,
  PositionClosureCell,
  PositionClosureFile,
} from '../../src/types/data.ts'
import type { ImfStockObs } from '../fetch/imf.ts'
import { OUT_DIR, quarterEndDate, readRawJson, writeJson } from '../fetch/lib.ts'

export const DISCREPANCY_OWNER = 'discrepancy_owner'
export const DISCREPANCY_ISSUER = 'discrepancy_issuer'
const MAX_ITERATIONS = 100
const TOLERANCE = 1e-9
const PUBLISHED_CELL_LIMIT = 1_000

export interface PositionSeed {
  row: string
  column: string
  value: number
}

export interface RasCell {
  row: string
  column: string
  value: number
  lower: number
  upper: number
}

export interface RasResult {
  cells: RasCell[]
  rowMargins: Record<string, number>
  columnMargins: Record<string, number>
  iterations: number
  residual: number
  converged: true
  directSeedShare: number
}

export const hasBottomUpSeed = (seed: readonly PositionSeed[]): boolean =>
  seed.some((cell) => Number.isFinite(cell.value) && cell.value > 0)

export const frechetPositionBounds = (row: number, column: number, total: number) => ({
  lower: Math.max(0, row + column - total),
  upper: Math.min(row, column),
})

/** Keep published values inside exact mathematical bounds after iterative FP arithmetic. */
export const boundPositionValue = (value: number, lower: number, upper: number) =>
  Math.min(upper, Math.max(lower, value))

const cleanMargins = (margins: Record<string, number>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(margins)
      .filter(([, value]) => Number.isFinite(value) && value > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  )

const sumValues = (values: Record<string, number>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0)

export function rasClose(
  seed: readonly PositionSeed[],
  rawRows: Record<string, number>,
  rawColumns: Record<string, number>,
): RasResult {
  const rowMargins = cleanMargins(rawRows)
  const columnMargins = cleanMargins(rawColumns)
  let rowTotal = sumValues(rowMargins)
  const columnTotal = sumValues(columnMargins)
  if (rowTotal <= 0 || columnTotal <= 0)
    throw new Error('RAS requires positive row and column margins')
  if (rowTotal > columnTotal) {
    columnMargins[DISCREPANCY_ISSUER] = rowTotal - columnTotal
  } else if (columnTotal > rowTotal) {
    rowMargins[DISCREPANCY_OWNER] = columnTotal - rowTotal
    rowTotal = columnTotal
  }
  const total = rowTotal
  const rows = Object.keys(rowMargins)
  const columns = Object.keys(columnMargins)
  const seedMap = new Map<string, number>()
  for (const cell of seed) {
    if (cell.value <= 0 || !Number.isFinite(cell.value)) continue
    const key = `${cell.row}|${cell.column}`
    seedMap.set(key, (seedMap.get(key) ?? 0) + cell.value)
  }
  const directSeed = [...seedMap.values()].reduce((sum, value) => sum + value, 0)
  const matrix = rows.map((row) =>
    columns.map((column) => {
      const observed = seedMap.get(`${row}|${column}`)
      return observed ?? ((rowMargins[row] * columnMargins[column]) / total) * 1e-12
    }),
  )

  let residual = Number.POSITIVE_INFINITY
  let iterations = 0
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    iterations = iteration
    for (let i = 0; i < rows.length; i++) {
      const actual = matrix[i].reduce((sum, value) => sum + value, 0)
      const factor = rowMargins[rows[i]] / actual
      for (let j = 0; j < columns.length; j++) matrix[i][j] *= factor
    }
    for (let j = 0; j < columns.length; j++) {
      let actual = 0
      for (let i = 0; i < rows.length; i++) actual += matrix[i][j]
      const factor = columnMargins[columns[j]] / actual
      for (let i = 0; i < rows.length; i++) matrix[i][j] *= factor
    }
    residual = 0
    for (let i = 0; i < rows.length; i++) {
      const actual = matrix[i].reduce((sum, value) => sum + value, 0)
      residual = Math.max(residual, Math.abs(actual - rowMargins[rows[i]]) / rowMargins[rows[i]])
    }
    for (let j = 0; j < columns.length; j++) {
      let actual = 0
      for (let i = 0; i < rows.length; i++) actual += matrix[i][j]
      residual = Math.max(
        residual,
        Math.abs(actual - columnMargins[columns[j]]) / columnMargins[columns[j]],
      )
    }
    if (residual <= TOLERANCE) break
  }
  if (residual > TOLERANCE)
    throw new Error(`RAS did not converge after ${MAX_ITERATIONS} iterations: ${residual}`)

  const cells: RasCell[] = []
  for (let i = 0; i < rows.length; i++)
    for (let j = 0; j < columns.length; j++) {
      const bounds = frechetPositionBounds(
        rowMargins[rows[i]],
        columnMargins[columns[j]],
        total,
      )
      cells.push({
        row: rows[i],
        column: columns[j],
        value: boundPositionValue(matrix[i][j], bounds.lower, bounds.upper),
        ...bounds,
      })
    }
  return {
    cells,
    rowMargins,
    columnMargins,
    iterations,
    residual,
    converged: true,
    directSeedShare: Math.min(directSeed / total, 1),
  }
}

const MARGIN_ASSET = {
  P_F5_MV: 'listed_equity',
  P_F3_MV: 'debt_securities',
} as const

function readBilateral(period: string): BilateralRecord[] {
  const path = join(OUT_DIR, 'flows_bilateral', `${period}.json`)
  return (JSON.parse(readFileSync(path, 'utf8')) as { records: BilateralRecord[] }).records
}

export function buildPositionClosure(): { periods: number; cells: number } {
  const iip = readRawJson<ImfStockObs[]>('imf/iip_normalized.json')
  if (!iip) throw new Error('[position-closure] normalized IIP missing — run pnpm data:fetch')
  const byMargin = new Map<string, { rows: Record<string, number>; columns: Record<string, number> }>()
  for (const observation of iip) {
    const asset = MARGIN_ASSET[observation.indicator as keyof typeof MARGIN_ASSET]
    if (!asset) continue
    const key = `${observation.quarter}|${asset}`
    const margins = byMargin.get(key) ?? { rows: {}, columns: {} }
    const side = observation.entry === 'A_P' ? margins.rows : margins.columns
    side[observation.iso3] = observation.value
    byMargin.set(key, margins)
  }

  rmSync(join(OUT_DIR, 'position_closure'), { recursive: true, force: true })
  const periods = new Set<string>()
  let publishedCells = 0
  for (const [key, margins] of [...byMargin].sort(([a], [b]) => a.localeCompare(b))) {
    const [period, asset] = key.split('|') as [string, 'listed_equity' | 'debt_securities']
    if (!period.endsWith('-Q4') || period < '2013-Q4') continue
    const direct = readBilateral(period).filter(
      (row) => row.source_id === 'imf_pip' && row.measure === 'stock' && row.asset === asset,
    )
    if (!hasBottomUpSeed(
      direct.map((row) => ({ row: row.owner_country, column: row.issuer_country, value: row.value_usd })),
    ))
      continue
    const result = rasClose(
      direct.map((row) => ({
        row: row.owner_country,
        column: row.issuer_country,
        value: row.value_usd,
      })),
      margins.rows,
      margins.columns,
    )
    const coverage = result.directSeedShare
    const allCells: PositionClosureCell[] = result.cells.map((cell) => ({
      owner_country: cell.row,
      issuer_country: cell.column,
      asset,
      period: period as PositionClosureCell['period'],
      value_usd: cell.value,
      lower_bound: cell.lower,
      upper_bound: cell.upper,
      confidence_grade: 'E',
      estimate_method: 'biproportional_ras_position_closure',
      coverage_share: coverage,
      effective_date: quarterEndDate(period),
      source_ids: ['imf_pip', 'imf_iip'],
    }))
    const cells = allCells
      .sort((a, b) => b.value_usd - a.value_usd)
      .slice(0, PUBLISHED_CELL_LIMIT)
    publishedCells += cells.length
    periods.add(period)
    const path = join(OUT_DIR, 'position_closure', `${period}.json`)
    let file: PositionClosureFile
    try {
      file = JSON.parse(readFileSync(path, 'utf8')) as PositionClosureFile
    } catch {
      file = {
        period: period as PositionClosureFile['period'],
        method: 'biproportional_ras_position_closure',
        assets: {},
      }
    }
    file.assets[asset] = {
      cells,
      row_margins: result.rowMargins,
      column_margins: result.columnMargins,
      iterations: result.iterations,
      residual: result.residual,
      converged: true,
      direct_seed_share: coverage,
      total_cells: allCells.length,
      omitted_cells: allCells.length - cells.length,
      omitted_value_usd: allCells
        .slice(PUBLISHED_CELL_LIMIT)
        .reduce((sum, cell) => sum + cell.value_usd, 0),
    }
    writeJson(`position_closure/${period}.json`, file)
  }
  writeJson('position_closure/index.json', { periods: [...periods].sort() })
  return { periods: periods.size, cells: publishedCells }
}

if (process.argv[1]?.endsWith('position-closure.ts')) {
  const result = buildPositionClosure()
  console.log(`[position-closure] ${result.periods} periods · ${result.cells} published cells`)
}
