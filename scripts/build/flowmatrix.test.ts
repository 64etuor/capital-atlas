/**
 * Phase O (§8 축소-정직 구현) — 자산 간 흐름 재배분 행렬 엔진 계약 (TDD).
 *
 * 관측 제약: 국가별 BOP entry=assets 순흐름(A등급)이 행/열 마진.
 * 추정: IPF(균등 prior = 최대엔트로피 독립해), bounded 반복.
 * 폐합: EXTERNAL 가상 노드가 매수·매도 차액을 흡수(§12).
 * 정직성: 셀 전체 grade E + Fréchet 한계(원리적 범위 — 가정 없음),
 *          마진과 셀 합의 불일치는 정직 실패(부분 결과 금지).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  EXTERNAL,
  buildCountryMatrix,
  frechetBounds,
  netsFromRecords,
} from './flowmatrix.ts'
import { OUT_DIR, REPO_ROOT } from '../fetch/lib.ts'
import { digestFiles } from './digest.ts'

const near = (a: number, b: number, tol = 1e-6) =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

describe('netsFromRecords — 관측 마진 추출', () => {
  it('entry=assets flow 레코드만 자산별 순흐름으로 집계한다', () => {
    const nets = netsFromRecords([
      { asset: 'deposits', entry: 'assets', measure: 'flow', value_usd: -5 },
      { asset: 'deposits', entry: 'liabilities', measure: 'flow', value_usd: 99 },
      { asset: 'listed_equity', entry: 'assets', measure: 'flow', value_usd: 7 },
      { asset: 'loans', entry: 'assets', measure: 'valuation', value_usd: 42 },
    ])
    expect(nets).toEqual({ deposits: -5, listed_equity: 7 })
  })
})

describe('buildCountryMatrix — IPF 독립해와 폐합', () => {
  it('2매도×2매수 케이스: 독립해 F[i][j] = row_i·col_j / T', () => {
    // 매도: A 30, B 10 (T=40) · 매수: C 20, D 20 — EXTERNAL 없음(수지 일치)
    const m = buildCountryMatrix({ a: -30, b: -10, c: 20, d: 20 })
    expect(m).not.toBeNull()
    if (!m) return
    expect(m.external).toBeNull()
    const cell = (f: string, to: string) =>
      m.cells.find((x) => x.from === f && x.to === to)?.value ?? 0
    expect(near(cell('a', 'c'), 15)).toBe(true) // 30*20/40
    expect(near(cell('a', 'd'), 15)).toBe(true)
    expect(near(cell('b', 'c'), 5)).toBe(true)
    expect(near(cell('b', 'd'), 5)).toBe(true)
    expect(m.converged).toBe(true)
    expect(m.iterations).toBeLessThanOrEqual(100)
  })

  it('행/열 합 = 관측 마진 (±ε) — KOR 2026-Q1 실측 마진 형태', () => {
    // KOR entry=assets (USD): FDI +19.7396B dep −11.9083B loans +4.3591B
    // debt −1.4213B eq +27.53B — 엔진 도메인은 달러 절대값(EPS=$1 잡음 컷)
    const B = 1e9
    const nets = {
      unlisted_equity_fdi: 19.7396 * B,
      deposits: -11.9083 * B,
      loans: 4.3591 * B,
      debt_securities: -1.4213 * B,
      listed_equity: 27.53 * B,
    }
    const m = buildCountryMatrix(nets)
    expect(m).not.toBeNull()
    if (!m) return
    // EXTERNAL = 매수합 − 매도합 = 51.6287 − 13.3296 = +38.2991B → 공급(row)
    expect(m.external).toBe('source')
    const rowSum = (f: string) =>
      m.cells.filter((c) => c.from === f).reduce((s, c) => s + c.value, 0)
    const colSum = (t: string) =>
      m.cells.filter((c) => c.to === t).reduce((s, c) => s + c.value, 0)
    expect(near(rowSum('deposits'), 11.9083 * B)).toBe(true)
    expect(near(rowSum('debt_securities'), 1.4213 * B)).toBe(true)
    expect(near(rowSum(EXTERNAL), 38.2991 * B, 1e-4)).toBe(true)
    expect(near(colSum('listed_equity'), 27.53 * B)).toBe(true)
    expect(near(colSum('unlisted_equity_fdi'), 19.7396 * B)).toBe(true)
    expect(near(colSum('loans'), 4.3591 * B)).toBe(true)
  })

  it('순매도만 있으면 EXTERNAL이 흡수(sink)가 된다', () => {
    const m = buildCountryMatrix({ deposits: -8, loans: -2 })
    expect(m?.external).toBe('sink')
    const toExt = m?.cells
      .filter((c) => c.to === EXTERNAL)
      .reduce((s, c) => s + c.value, 0)
    expect(near(toExt ?? 0, 10)).toBe(true)
  })

  it('흐름이 전무하거나 0뿐이면 null (국가 생략 — 날조 금지)', () => {
    expect(buildCountryMatrix({})).toBeNull()
    expect(buildCountryMatrix({ deposits: 0 })).toBeNull()
  })

  it('모든 셀에 Fréchet 한계가 붙고 값이 그 안에 있다', () => {
    const m = buildCountryMatrix({ a: -30, b: -10, c: 20, d: 20 })
    expect(m).not.toBeNull()
    for (const c of m?.cells ?? []) {
      expect(c.lower).toBeLessThanOrEqual(c.value + 1e-9)
      expect(c.upper).toBeGreaterThanOrEqual(c.value - 1e-9)
    }
  })
})

describe('frechetBounds — 원리적 셀 범위', () => {
  it('min = max(0, r+c−T), max = min(r, c)', () => {
    expect(frechetBounds(30, 20, 40)).toEqual({ lower: 10, upper: 20 })
    expect(frechetBounds(10, 20, 40)).toEqual({ lower: 0, upper: 10 })
  })
})

describe('생성 산출물 — 결정론·마진 정합 (커밋된 데이터 기준)', () => {
  it('flowmatrix 샤드가 존재하고 KOR 최신 분기 마진이 BOP 관측과 일치한다', () => {
    const file = JSON.parse(
      readFileSync(join(OUT_DIR, 'flowmatrix', '2026-Q1.json'), 'utf8'),
    ) as {
      countries: Record<
        string,
        {
          cells: Array<{ from: string; to: string; value: number }>
          observed: Record<string, number>
        }
      >
    }
    const kor = file.countries.KOR
    expect(kor).toBeDefined()
    const flows = JSON.parse(
      readFileSync(join(OUT_DIR, 'flows_country', '2026-Q1.json'), 'utf8'),
    ) as {
      records: Array<{
        country: string
        asset: string
        entry: string
        measure: string
        value_usd: number
      }>
    }
    const bop = Object.fromEntries(
      flows.records
        .filter(
          (r) =>
            r.country === 'KOR' && r.entry === 'assets' && r.measure === 'flow',
        )
        .map((r) => [r.asset, r.value_usd]),
    )
    for (const [asset, net] of Object.entries(kor.observed)) {
      expect(near(net, bop[asset] ?? 0, 1e-9), asset).toBe(true)
    }
    // 마진 재구성: 매수 자산의 열합 = net
    for (const [asset, net] of Object.entries(kor.observed)) {
      if (net > 0) {
        const col = kor.cells
          .filter((c) => c.to === asset)
          .reduce((s, c) => s + c.value, 0)
        expect(near(col, net, 1e-6), `col ${asset}`).toBe(true)
      }
    }
  })

  it('빌더 2회 실행이 바이트 동일하다 (N1 결정론 규율)', () => {
    const root = join(OUT_DIR, 'flowmatrix')
    const digest = () =>
      digestFiles(
        root,
        readdirSync(root).filter((path) => path.endsWith('.json')),
      )
    const before = digest()
    execFileSync('pnpm', ['-s', 'data:flowmatrix'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(digest()).toBe(before)
  })
})
