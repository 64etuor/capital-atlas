import { describe, expect, it } from 'vitest'
import { normalizeDssRows, parseDssCsv } from './bis-dss.ts'

const header = [
  'FREQ',
  'ADJUSTMENT',
  'REF_AREA',
  'COUNTERPART_AREA',
  'REF_SECTOR',
  'COUNTERPART_SECTOR',
  'CONSOLIDATION',
  'ACCOUNTING_ENTRY',
  'STO',
  'INSTR_ASSET',
  'MATURITY',
  'EXPENDITURE',
  'UNIT_MEASURE',
  'CURRENCY_DENOM',
  'VALUATION',
  'PRICES',
  'TRANSFORMATION',
  'CUST_BREAKDOWN',
  'TITLE',
  'UNIT_MULT',
  'TIME_PERIOD',
  'OBS_VALUE',
].join(',')

const row = (overrides: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = {
    FREQ: 'Q',
    ADJUSTMENT: 'N',
    REF_AREA: 'KR',
    COUNTERPART_AREA: 'XW',
    REF_SECTOR: 'S1',
    COUNTERPART_SECTOR: 'S1',
    CONSOLIDATION: 'N',
    ACCOUNTING_ENTRY: 'L',
    STO: 'LE',
    INSTR_ASSET: 'F3',
    MATURITY: 'T',
    EXPENDITURE: '_Z',
    UNIT_MEASURE: 'USD',
    CURRENCY_DENOM: '_T',
    VALUATION: 'M',
    PRICES: 'V',
    TRANSFORMATION: 'N',
    CUST_BREAKDOWN: '_T',
    TITLE: 'Korea, debt securities',
    UNIT_MULT: '9',
    TIME_PERIOD: '2025-Q4',
    OBS_VALUE: '2.5',
    ...overrides,
  }
  return header
    .split(',')
    .map((key) => {
      const value = base[key] ?? ''
      return value.includes(',') ? `"${value}"` : value
    })
    .join(',')
}

describe('BIS DSS SDMX-CSV normalization', () => {
  it('parses quoted fields and applies UNIT_MULT without false precision', () => {
    const rows = parseDssCsv(`${header}\n${row()}\n`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      refArea: 'KR',
      title: 'Korea, debt securities',
      valueUsd: 2_500_000_000,
    })
  })

  it('preserves accounting side, direct sector, counterparty scope, and stock/transaction', () => {
    const parsed = parseDssCsv(
      [
        header,
        row(),
        row({
          ACCOUNTING_ENTRY: 'A',
          COUNTERPART_AREA: '5Z',
          REF_SECTOR: 'S12P',
          STO: 'F',
          OBS_VALUE: '-0.75',
        }),
      ].join('\n'),
    )
    const records = normalizeDssRows(parsed, new Map([['KR', 'KOR']]))
    expect(records).toEqual([
      expect.objectContaining({
        country: 'KOR',
        accounting_entry: 'liabilities',
        counterparty_scope: 'world',
        sector: 'S1',
        measure: 'stock',
        value_usd: 2_500_000_000,
        valuation: 'market',
        unit_basis: 'current_usd',
        source_id: 'bis_dss',
        confidence_grade: 'A',
        effective_date: '2025-12-31',
      }),
      expect.objectContaining({
        accounting_entry: 'assets',
        counterparty_scope: 'nonresident',
        sector: 'S12P',
        measure: 'flow',
        value_usd: -750_000_000,
      }),
    ])
  })

  it('drops aggregate reporters and non-comparable valuation/unit variants', () => {
    const parsed = parseDssCsv(
      [
        header,
        row({ REF_AREA: 'U2' }),
        row({ UNIT_MEASURE: 'KRW' }),
        row({ VALUATION: 'N' }),
        row({ CURRENCY_DENOM: 'XDC' }),
        row({ MATURITY: 'L' }),
        row({ COUNTERPART_AREA: 'US' }),
      ].join('\n'),
    )
    expect(normalizeDssRows(parsed, new Map([['KR', 'KOR']]))).toEqual([])
  })

  it('throws on a drifted SDMX header instead of publishing an empty product', () => {
    expect(() => parseDssCsv('FREQ,OBS_VALUE\nQ,1')).toThrow(/header/i)
  })
})
