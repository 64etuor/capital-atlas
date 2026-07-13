/**
 * BIS 은행 회랑 → flows_bilateral 샤드 병합 (멱등).
 *
 * CLI: pnpm data:bis — 커밋된 스냅샷을 건드리지 않고 BIS만 갱신/병합한다
 * (전체 재수집 불요). run.ts(전체 파이프라인)도 assemble 직후 같은 경로를 탄다.
 *
 * 멱등 규칙: 기존 샤드에서 source_id='bis_lbs' 레코드를 전부 걷어내고 새
 * 수집분을 덧붙인다 — 재실행이 중복을 만들지 않는다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  BilateralFile,
  BilateralRecord,
  PeriodIndexFile,
  PeriodKey,
} from '../../src/types/data.ts'
import { OUT_DIR, compareQuarters, writeJson } from '../fetch/lib.ts'
import { runBis } from '../fetch/bis.ts'

export function mergeBankCorridors(
  existing: readonly BilateralRecord[],
  bank: readonly BilateralRecord[],
): BilateralRecord[] {
  return [...existing.filter((r) => r.source_id !== 'bis_lbs'), ...bank]
}

interface Coverage {
  reporters: string[]
  droppedReporters: string[]
}

/** 샤드·인덱스·리포트에 은행 회랑을 반영한다. */
export function applyBankMerge(
  bank: readonly BilateralRecord[],
  coverage: Coverage,
): void {
  const indexPath = join(OUT_DIR, 'index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as PeriodIndexFile

  const byPeriod = new Map<PeriodKey, BilateralRecord[]>()
  for (const r of bank) {
    let arr = byPeriod.get(r.period)
    if (!arr) byPeriod.set(r.period, (arr = []))
    arr.push(r)
  }

  const now = new Date().toISOString()
  const periods = [
    ...new Set([...index.periods.flows_bilateral, ...byPeriod.keys()]),
  ].sort(compareQuarters)

  const written: PeriodKey[] = []
  let corridorCount = 0
  for (const period of periods) {
    const shardPath = join(OUT_DIR, 'flows_bilateral', `${period}.json`)
    const existing = existsSync(shardPath)
      ? (JSON.parse(readFileSync(shardPath, 'utf8')) as BilateralFile).records
      : []
    const merged = mergeBankCorridors(existing, byPeriod.get(period) ?? [])
    if (merged.length === 0) continue
    corridorCount += merged.length
    // 결정론(Phase N): 샤드에 타임스탬프 금지 — 병합이 멱등이면 바이트 동일
    writeJson(`flows_bilateral/${period}.json`, { records: merged })
    written.push(period)
  }

  index.periods.flows_bilateral = written.sort(compareQuarters)
  index.generated_at = now // 데이터 빈티지 갱신 (명판 '현재 추정 기준'의 근거)
  writeJson('index.json', index)

  // 폐합 정신(§12): 조정하지 않고 커버리지만 기록
  const reportPath = join(OUT_DIR, 'meta', 'pipeline_report.json')
  if (existsSync(reportPath)) {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>
    report.bis_lbs = {
      merged_at: now,
      reporters: coverage.reporters.length,
      reporter_list: coverage.reporters,
      dropped_reporters: coverage.droppedReporters,
      bank_corridor_records: bank.length,
      note: 'bilateral banking channel only — IIP country totals remain the stock canon (§5 dedup guard); totals vs bilateral-sum gaps are expected (reporter coverage), recorded not reconciled',
    }
    writeJson('meta/pipeline_report.json', report)
  }
  console.log(
    `[bank_merge] ${bank.length} corridors merged into ${written.length} shards (${corridorCount} records total)`,
  )
}

// CLI: pnpm data:bis
if (process.argv[1]?.endsWith('bank_merge.ts')) {
  const countries = JSON.parse(
    readFileSync(join(OUT_DIR, 'countries.json'), 'utf8'),
  ) as Array<{ iso2: string; iso3: string }>
  const iso3ByIso2 = new Map(countries.map((c) => [c.iso2, c.iso3]))
  const { records, reporters, droppedReporters } = await runBis(iso3ByIso2)
  if (records.length === 0) {
    console.error('[bank_merge] no BIS records — nothing merged (honest no-op)')
  } else {
    applyBankMerge(records, { reporters, droppedReporters })
  }
}
