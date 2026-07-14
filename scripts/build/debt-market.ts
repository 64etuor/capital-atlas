/**
 * BIS DSS direct observations → deterministic country shards.
 *
 * CLI: pnpm data:dss. Existing public files are replaced only after both
 * official accounting sides pass the fetch/parser/coverage gates.
 */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CountryDebtMarketFile,
  DebtMarketIndexFile,
  DebtMarketRecord,
} from '../../src/types/data.ts'
import {
  countryDebtMarketFileSchema,
  debtMarketIndexSchema,
} from './debt-market-contract.ts'
import { OUT_DIR, writeJson } from '../fetch/lib.ts'
import { runDss, type DssFetchResult } from '../fetch/bis-dss.ts'

const compareRows = (a: DebtMarketRecord, b: DebtMarketRecord) =>
  a.period.localeCompare(b.period) ||
  a.accounting_entry.localeCompare(b.accounting_entry) ||
  a.counterparty_scope.localeCompare(b.counterparty_scope) ||
  a.sector.localeCompare(b.sector) ||
  a.measure.localeCompare(b.measure)

export interface DebtMarketProduct {
  index: DebtMarketIndexFile
  files: Map<string, CountryDebtMarketFile>
}

export function groupDebtMarket(
  records: readonly DebtMarketRecord[],
): DebtMarketProduct {
  const grouped = new Map<string, DebtMarketRecord[]>()
  for (const row of records) {
    let country = grouped.get(row.country)
    if (!country) grouped.set(row.country, (country = []))
    country.push(row)
  }

  const countries = [...grouped.keys()].sort()
  const periods = [...new Set(records.map((row) => row.period))].sort()
  const index = debtMarketIndexSchema.parse({ countries, periods })
  const files = new Map<string, CountryDebtMarketFile>()
  for (const country of countries) {
    files.set(
      country,
      countryDebtMarketFileSchema.parse({
        country,
        records: [...(grouped.get(country) ?? [])].sort(compareRows),
      }),
    )
  }
  return { index, files }
}

export function writeDebtMarket(result: DssFetchResult): DebtMarketProduct {
  const product = groupDebtMarket(result.records)
  const dir = join(OUT_DIR, 'debt_market')
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (
        file.endsWith('.json') &&
        file !== 'index.json' &&
        !product.files.has(file.slice(0, -5))
      )
        rmSync(join(dir, file))
    }
  }
  writeJson('debt_market/index.json', product.index)
  for (const [country, file] of product.files)
    writeJson(`debt_market/${country}.json`, file)

  const reportPath = join(OUT_DIR, 'meta', 'pipeline_report.json')
  if (existsSync(reportPath)) {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, unknown>
    report.bis_dss = {
      fetched_at: new Date().toISOString(),
      raw_rows: result.rawRows,
      direct_records: result.records.length,
      dropped_rows: result.droppedRows,
      countries: result.countries.length,
      country_list: result.countries,
      periods: result.periods.length,
      note: 'national debt issuance/holdings only; not merged into cross-border stocks or bilateral corridors; hierarchy codes are not summed',
    }
    writeJson('meta/pipeline_report.json', report)
  }
  console.log(
    `[debt-market] ${result.records.length} records → ${product.files.size} country shards`,
  )
  return product
}

if (process.argv[1]?.endsWith('debt-market.ts')) {
  const countries = JSON.parse(
    readFileSync(join(OUT_DIR, 'countries.json'), 'utf8'),
  ) as Array<{ iso2: string; iso3: string }>
  const result = await runDss(new Map(countries.map((c) => [c.iso2, c.iso3])))
  writeDebtMarket(result)
}
