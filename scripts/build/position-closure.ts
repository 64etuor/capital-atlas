/** Bounded RAS/IPF view. Direct PIP observations remain untouched in their source shards. */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { PositionClosureCell, PositionClosureFile } from '../../src/types/data.ts'
import type { ImfStockObs, PipObs } from '../fetch/imf.ts'
import { OUT_DIR, quarterEndDate, readRawJson, writeJson } from '../fetch/lib.ts'

export const DISCREPANCY_OWNER = 'discrepancy_owner'
export const DISCREPANCY_ISSUER = 'discrepancy_issuer'
const MAX_ITERATIONS = 100
const TOLERANCE = 1e-9
const PUBLISHED_CELL_LIMIT = 1_000
export const CLOSURE_AUDIT_REL_PATH = 'meta/position_closure_inputs.json.gz'

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

export interface ClosureAuditInputs {
  schema_version: 2
  source_ids: ['imf_iip', 'imf_pip']
  iip: ImfStockObs[]
  pip: PipObs[]
}

const canonicalSort = <T>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

export function buildClosureAuditInputs(
  iip: readonly ImfStockObs[],
  pip: readonly PipObs[],
): ClosureAuditInputs {
  return {
    schema_version: 2,
    source_ids: ['imf_iip', 'imf_pip'],
    iip: canonicalSort(
      iip.filter(
        (row) =>
          (row.indicator === 'P_F5_MV' || row.indicator === 'P_F3_MV') &&
          (row.quarter.endsWith('-Q2') || row.quarter.endsWith('-Q4')) &&
          row.quarter >= '2013-Q4',
      ),
    ),
    pip: canonicalSort(pip.filter((row) => row.period >= '2013-Q4')),
  }
}

export function encodeClosureAuditInputs(inputs: ClosureAuditInputs): Buffer {
  const gzip = gzipSync(Buffer.from(JSON.stringify(inputs)), { level: 9 })
  gzip.writeUInt32LE(0, 4)
  return gzip
}

export const hasBottomUpSeed = (seed: readonly PositionSeed[]): boolean =>
  seed.some((cell) => Number.isFinite(cell.value) && cell.value > 0)

const PIP_INDICATOR_BY_ASSET = {
  listed_equity: 'P_F51_P_USD',
  debt_securities: 'P_F3_P_USD',
} as const

/**
 * Build the RAS seed from the unpruned normalized IMF PIP observations.
 * Public bilateral shards deliberately omit the sub-$100M tail and therefore
 * are a presentation view, not an admissible model input.
 */
export function rawPipSeedForClosure(
  observations: readonly PipObs[],
  period: string,
  asset: keyof typeof PIP_INDICATOR_BY_ASSET,
  rowMargins: Readonly<Record<string, number>>,
  columnMargins: Readonly<Record<string, number>>,
): PositionSeed[] {
  const indicator = PIP_INDICATOR_BY_ASSET[asset]
  return observations
    .filter(
      (row) =>
        row.period === period &&
        row.indicator === indicator &&
        row.owner !== row.issuer &&
        rowMargins[row.owner] !== undefined &&
        columnMargins[row.issuer] !== undefined &&
        Number.isFinite(row.value) &&
        row.value > 0,
    )
    .map((row) => ({ row: row.owner, column: row.issuer, value: row.value }))
}

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
  const rowDomain = new Set(rows)
  const columnDomain = new Set(columns)
  const seedMap = new Map<string, number>()
  for (const cell of seed) {
    if (
      cell.value <= 0 ||
      !Number.isFinite(cell.value) ||
      !rowDomain.has(cell.row) ||
      !columnDomain.has(cell.column)
    )
      continue
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

export function buildPositionClosure(): { periods: number; cells: number } {
  const iip = readRawJson<ImfStockObs[]>('imf/iip_normalized.json')
  if (!iip) throw new Error('[position-closure] normalized IIP missing — run pnpm data:fetch')
  const pip = readRawJson<PipObs[]>('imf/pip_normalized.json')
  if (!pip) throw new Error('[position-closure] normalized PIP missing — run pnpm data:fetch')
  const auditPath = join(OUT_DIR, CLOSURE_AUDIT_REL_PATH)
  mkdirSync(dirname(auditPath), { recursive: true })
  writeFileSync(auditPath, encodeClosureAuditInputs(buildClosureAuditInputs(iip, pip)))
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
    if (
      (!period.endsWith('-Q2') && !period.endsWith('-Q4')) ||
      period < '2013-Q4'
    )
      continue
    const inDomainDirect = rawPipSeedForClosure(
      pip,
      period,
      asset,
      margins.rows,
      margins.columns,
    )
    if (!hasBottomUpSeed(inDomainDirect))
      continue
    const result = rasClose(
      inDomainDirect,
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
