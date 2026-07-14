/**
 * v3 — 정본 수치 원장 아티팩트 (초안 §11.2 축소 + §16-6 데이터 상품화).
 *
 * 관측(stocks 3 basis · flows_country · flows_bilateral · direct exposure)과
 * 명시적으로 등급화한 FXD/reconstruction/RAS를 단일 NDJSON 원장으로 평탄화한다.
 * synoptic/station/flowmatrix 같은 UI 집계는 재계산 가능한 2차 뷰라 제외한다.
 *
 * 규율: 결정론(N1 — 타임스탬프 금지, gzip 헤더 mtime=0), 정합 게이트
 * (라인 수·테이블별 수·등급 분포 = 원 샤드 합, self-check + vitest).
 */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import type {
  Basis,
  BilateralRecord,
  CountryExposureFile,
  CountryDebtMarketFile,
  CurrencyExposureRecord,
  DebtMarketIndexFile,
  DebtMarketRecord,
  FlowRecord,
  FxdAvailable,
  PeriodIndexFile,
  PositionClosureCell,
  PositionClosureFile,
  ReconstructedLiability,
  SectorPositionRecord,
  StockRecord,
} from '../../src/types/data.ts'
import { OUT_DIR, writeJson } from '../fetch/lib.ts'

/** 사실 라인 — 필드 순서가 곧 직렬화 순서(결정론) */
export interface FactLine {
  table:
    | 'stocks'
    | 'flows_country'
    | 'flows_bilateral'
    | 'debt_market'
    | 'currency_exposure'
    | 'sector_positions'
    | 'reconstructed_liabilities'
    | 'constant_fx'
    | 'position_closure'
  basis?: Basis
  country?: string
  owner_country?: string
  issuer_country?: string
  asset: string
  period: string
  measure: string
  entry?: 'assets' | 'liabilities'
  sector?: string
  currency?: string
  base_period?: string
  value_usd: number
  source_id: string
  effective_date: string
  confidence_grade: string
  estimate_method?: string
  lower_bound?: number
  upper_bound?: number
  coverage_share?: number
  residual_share?: number
  source_ids?: string[]
  position_basis?: string
  counterparty_scope?: string
  valuation?: string
  unit_basis?: string
}

const lineage = (r: {
  estimate_method?: string
  lower_bound?: number
  upper_bound?: number
}) => ({
  ...(r.estimate_method !== undefined && { estimate_method: r.estimate_method }),
  ...(r.lower_bound !== undefined && { lower_bound: r.lower_bound }),
  ...(r.upper_bound !== undefined && { upper_bound: r.upper_bound }),
})

export const stockFact = (basis: Basis, r: StockRecord): FactLine => ({
  table: 'stocks',
  basis,
  country: r.country,
  asset: r.asset,
  period: r.period,
  measure: r.measure,
  value_usd: r.value_usd,
  source_id: r.source_id,
  effective_date: r.effective_date,
  confidence_grade: r.confidence_grade,
  ...lineage(r),
})

export const flowFact = (r: FlowRecord): FactLine => ({
  table: 'flows_country',
  country: r.country,
  asset: r.asset,
  period: r.period,
  measure: r.measure,
  entry: r.entry,
  value_usd: r.value_usd,
  source_id: r.source_id,
  effective_date: r.effective_date,
  confidence_grade: r.confidence_grade,
  ...lineage(r),
})

export const bilateralFact = (r: BilateralRecord): FactLine => ({
  table: 'flows_bilateral',
  owner_country: r.owner_country,
  issuer_country: r.issuer_country,
  asset: r.asset,
  period: r.period,
  measure: r.measure,
  value_usd: r.value_usd,
  source_id: r.source_id,
  effective_date: r.effective_date,
  confidence_grade: r.confidence_grade,
  position_basis: r.position_basis,
  ...lineage(r),
})

export const debtMarketFact = (r: DebtMarketRecord): FactLine => ({
  table: 'debt_market',
  country: r.country,
  asset: 'debt_securities',
  period: r.period,
  measure: r.measure,
  entry: r.accounting_entry,
  sector: r.sector,
  counterparty_scope: r.counterparty_scope,
  valuation: r.valuation,
  unit_basis: r.unit_basis,
  value_usd: r.value_usd,
  source_id: r.source_id,
  effective_date: r.effective_date,
  confidence_grade: r.confidence_grade,
})

export const currencyExposureFact = (r: CurrencyExposureRecord): FactLine => ({
  table: 'currency_exposure',
  country: r.country,
  asset: 'external_debt',
  period: r.period,
  measure: 'stock',
  entry: r.entry,
  sector: r.sector,
  currency: r.currency,
  value_usd: r.value_usd,
  source_id: r.source_id,
  effective_date: r.effective_date,
  confidence_grade: r.confidence_grade,
})

export const sectorPositionFact = (r: SectorPositionRecord): FactLine => ({
  table: 'sector_positions',
  country: r.country,
  asset: r.asset,
  period: r.period,
  measure: 'stock',
  sector: r.sector,
  value_usd: r.value_usd,
  source_id: r.source_id,
  effective_date: r.effective_date,
  confidence_grade: r.confidence_grade,
})

export const reconstructedLiabilityFact = (r: ReconstructedLiability): FactLine => ({
  table: 'reconstructed_liabilities',
  country: r.country,
  asset: r.asset,
  period: r.period,
  measure: 'stock',
  entry: 'liabilities',
  value_usd: r.value_usd,
  source_id: r.source_id,
  source_ids: r.source_ids,
  effective_date: r.effective_date,
  confidence_grade: r.confidence_grade,
  coverage_share: r.coverage_share,
  ...lineage(r),
})

export const fxdFact = (country: string, r: FxdAvailable): FactLine => ({
  table: 'constant_fx',
  country,
  asset: 'external_debt',
  period: r.period,
  base_period: r.base_period,
  measure: 'stock',
  entry: r.entry,
  value_usd: r.value_usd,
  source_id: r.source_id,
  source_ids: r.source_ids,
  effective_date: r.effective_date,
  confidence_grade: r.confidence_grade,
  coverage_share: r.coverage_share,
  residual_share: r.residual_share,
  ...lineage(r),
})

export const positionClosureFact = (r: PositionClosureCell): FactLine => ({
  table: 'position_closure',
  owner_country: r.owner_country,
  issuer_country: r.issuer_country,
  asset: r.asset,
  period: r.period,
  measure: 'stock',
  value_usd: r.value_usd,
  source_id: 'model_position_closure',
  source_ids: r.source_ids,
  effective_date: r.effective_date,
  confidence_grade: r.confidence_grade,
  coverage_share: r.coverage_share,
  ...lineage(r),
})

export const buildFactsNdjson = (lines: readonly FactLine[]): string =>
  lines.map((l) => JSON.stringify(l)).join('\n') + '\n'

/** gzip 헤더의 MTIME을 0으로 고정한 결정론적 압축 (node 기본이 0이지만 계약으로 강제) */
export function gzipDeterministic(buf: Buffer): Buffer {
  const gz = gzipSync(buf, { level: 9 })
  gz.writeUInt32LE(0, 4) // MTIME 필드 명시적 0 — 플랫폼/버전 드리프트 방어
  return gz
}

// ------------------------------------------------------------------ CLI ----

function readShard<T>(dir: string, period: string): T[] {
  return (
    JSON.parse(
      readFileSync(join(OUT_DIR, dir, `${period}.json`), 'utf8'),
    ) as { records: T[] }
  ).records
}

if (process.argv[1]?.endsWith('facts.ts')) {
  const index = JSON.parse(
    readFileSync(join(OUT_DIR, 'index.json'), 'utf8'),
  ) as PeriodIndexFile

  const lines: FactLine[] = []
  for (const basis of ['owner', 'issuer', 'location'] as const) {
    for (const p of index.periods[`stocks_${basis}`])
      for (const r of readShard<StockRecord>(`stocks_${basis}`, p))
        lines.push(stockFact(basis, r))
  }
  for (const p of index.periods.flows_country)
    for (const r of readShard<FlowRecord>('flows_country', p))
      lines.push(flowFact(r))
  for (const p of index.periods.flows_bilateral)
    for (const r of readShard<BilateralRecord>('flows_bilateral', p))
      lines.push(bilateralFact(r))

  const debtMarketIndex = JSON.parse(
    readFileSync(join(OUT_DIR, 'debt_market', 'index.json'), 'utf8'),
  ) as DebtMarketIndexFile
  for (const country of debtMarketIndex.countries) {
    const file = JSON.parse(
      readFileSync(join(OUT_DIR, 'debt_market', `${country}.json`), 'utf8'),
    ) as CountryDebtMarketFile
    for (const row of file.records) lines.push(debtMarketFact(row))
  }

  const exposureIndex = JSON.parse(
    readFileSync(join(OUT_DIR, 'exposure', 'index.json'), 'utf8'),
  ) as { countries: string[] }
  for (const country of exposureIndex.countries) {
    const file = JSON.parse(
      readFileSync(join(OUT_DIR, 'exposure', `${country}.json`), 'utf8'),
    ) as CountryExposureFile
    for (const row of file.currency) lines.push(currencyExposureFact(row))
    for (const row of file.sectors) lines.push(sectorPositionFact(row))
    for (const row of file.reconstructed_liabilities)
      lines.push(reconstructedLiabilityFact(row))
    for (const row of file.fxd)
      if (row.status === 'available') lines.push(fxdFact(country, row))
  }

  const closureIndex = JSON.parse(
    readFileSync(join(OUT_DIR, 'position_closure', 'index.json'), 'utf8'),
  ) as { periods: string[] }
  for (const period of closureIndex.periods) {
    const file = JSON.parse(
      readFileSync(join(OUT_DIR, 'position_closure', `${period}.json`), 'utf8'),
    ) as PositionClosureFile
    for (const asset of ['debt_securities', 'listed_equity'] as const)
      for (const row of file.assets[asset]?.cells ?? []) lines.push(positionClosureFact(row))
  }

  const ndjson = buildFactsNdjson(lines)
  const gz = gzipDeterministic(Buffer.from(ndjson))
  const outPath = join(OUT_DIR, 'facts.ndjson.gz')
  // writeJson은 JSON 전용 — 바이너리는 직접 기록
  const { writeFileSync } = await import('node:fs')
  writeFileSync(outPath, gz)

  // self-check: 기록물 왕복 재검(라인 수·등급 분포)
  const roundtrip = gunzipSync(readFileSync(outPath)).toString()
  const rtLines = roundtrip.split('\n').filter(Boolean)
  if (rtLines.length !== lines.length) {
    console.error(
      `[facts] SELF-CHECK FAILED: wrote ${lines.length}, read back ${rtLines.length}`,
    )
    process.exit(1)
  }
  const byTable: Record<string, number> = {}
  const byGrade: Record<string, number> = {}
  for (const l of lines) {
    byTable[l.table] = (byTable[l.table] ?? 0) + 1
    byGrade[l.confidence_grade] = (byGrade[l.confidence_grade] ?? 0) + 1
  }
  // 요약은 결정론(타임스탬프 없음) — data:changed가 실질 변경으로만 분류하게
  writeJson('meta/facts_summary.json', {
    records: lines.length,
    by_table: byTable,
    by_grade: byGrade,
    gzip_bytes: gz.length,
    schema: 'docs/DATA_CONTRACT.md#factsndjsongz',
  })
  console.log(
    `[facts] ${lines.length} records → facts.ndjson.gz ${(gz.length / 1e6).toFixed(1)}MB ` +
      `(raw ${(ndjson.length / 1e6).toFixed(0)}MB) · ${statSync(outPath).size} bytes on disk`,
  )
}
