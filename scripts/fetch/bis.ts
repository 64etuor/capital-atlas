/**
 * BIS 위치기준 국제은행통계(LBS) — 국경 간 은행 채권·부채의 양자 분해.
 *
 * 실호출 프로브로 확정한 DSD (2026-07-13, docs/DATA_PIPELINE.md):
 *   dataflow BIS/WS_LBS_D_PUB/1.0 · SDMX-CSV · key 12차원
 *   Q.S.{C|L}.G.TO1.A.5J.A.{REP}.A.{CP}.N
 *   (S=amounts outstanding, G=loans and deposits, TO1=전통화,
 *    5J=전체 모행 소재국, N=cross-border) · UNIT_MULT=6 (백만 USD)
 *
 * 중복 가드(§5): IIP 국가 총계(stocks_owner deposits/loans, grade A)는 그대로.
 * BIS는 flows_bilateral의 은행 채널 회랑으로만 들어간다 — CPIS(증권)와
 * 자산군이 달라 중복 없음.
 *
 * 상품 매핑(정직 주석): LBS G는 loans+deposits 합산 상품이라 자산군 분리가
 * 관측되지 않는다. 포지션 방향으로 분류한다 — claims(은행의 대외 채권)=loans,
 * liabilities(상대국이 은행에 맡긴 예치)=deposits. 값은 공식 관측 그대로,
 * 분류만 매핑이므로 grade B + estimate_method로 공개한다(bounds 아님).
 */
import type { BilateralRecord } from '../../src/types/data.ts'
import {
  assertMinimumRows,
  assertNoNewFailures,
  failures,
  fetchCached,
  pooled,
  quarterEndDate,
} from './lib.ts'

const FLOW = 'BIS/WS_LBS_D_PUB/1.0'
const BASE = `https://stats.bis.org/api/v2/data/dataflow/${FLOW}`

/** bilateral 프루닝 임계 — assemble의 BILATERAL_MIN_USD와 동일 계약 */
export const BIS_MIN_USD = 100_000_000

export interface LbsRow {
  position: 'C' | 'L'
  rep2: string
  cp2: string
  period: string
  valueUsd: number
}

/** 따옴표 필드를 존중하는 최소 CSV 라인 분리 (TITLE류 콤마 방어) */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** SDMX-CSV → LbsRow[] (UNIT_MULT 스케일 적용, 결측/비정상 값 스킵) */
export function parseLbsCsv(csv: string): LbsRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length < 2) return []
  const header = splitCsvLine(lines[0])
  const col = (name: string) => header.indexOf(name)
  const iPos = col('L_POSITION')
  const iRep = col('L_REP_CTY')
  const iCp = col('L_CP_COUNTRY')
  const iMult = col('UNIT_MULT')
  const iPeriod = col('TIME_PERIOD')
  const iValue = col('OBS_VALUE')
  if ([iPos, iRep, iCp, iMult, iPeriod, iValue].includes(-1)) {
    throw new Error('[bis] unexpected SDMX-CSV header — DSD drift, re-probe')
  }
  const out: LbsRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const f = splitCsvLine(lines[i])
    const raw = f[iValue]
    if (raw === undefined || raw === '') continue
    const v = Number(raw)
    if (!Number.isFinite(v)) continue
    const pos = f[iPos]
    if (pos !== 'C' && pos !== 'L') continue
    out.push({
      position: pos,
      rep2: f[iRep],
      cp2: f[iCp],
      period: f[iPeriod],
      valueUsd: v * 10 ** Number(f[iMult] ?? '6'),
    })
  }
  return out
}

const isCountryCode = (s: string) => /^[A-Z]{2}$/.test(s)

/** LBS 행 → 은행 회랑 레코드 (방향 매핑·프루닝·정직 lineage) */
export function toBankRecords(
  rows: LbsRow[],
  iso3ByIso2: ReadonlyMap<string, string>,
): BilateralRecord[] {
  const out: BilateralRecord[] = []
  for (const r of rows) {
    if (!isCountryCode(r.rep2) || !isCountryCode(r.cp2)) continue // 집계코드(5A 등) 제외
    const rep = iso3ByIso2.get(r.rep2)
    const cp = iso3ByIso2.get(r.cp2)
    if (!rep || !cp || rep === cp) continue
    if (Math.abs(r.valueUsd) < BIS_MIN_USD) continue
    if (!/^\d{4}-Q[1-4]$/.test(r.period)) continue
    const banking = r.position === 'C'
    out.push({
      // claims: 보고국 은행의 대외 채권(=보고국이 보유) / liabilities: 상대국의 예치(=상대국이 보유)
      owner_country: banking ? rep : cp,
      issuer_country: banking ? cp : rep,
      asset: banking ? 'loans' : 'deposits',
      period: r.period as BilateralRecord['period'],
      measure: 'stock',
      value_usd: Math.round(r.valueUsd),
      source_id: 'bis_lbs',
      effective_date: quarterEndDate(r.period),
      confidence_grade: 'B',
      estimate_method:
        'lbs_loans_and_deposits_instrument_mapped_by_position_side',
      position_basis: 'lbs_position_side',
    })
  }
  return out
}

const keyUrl = (rep: string, pos: 'C' | 'L') =>
  `${BASE}/Q.S.${pos}.G.TO1.A.5J.A.${rep}.A..N?format=csv&startPeriod=2010-01-01`

/** HTTP 200 with an empty/drifted payload must not erase committed BIS corridors. */
export function requireUsableLbsCoverage(
  reporters: readonly string[],
  records: readonly BilateralRecord[],
): void {
  if (reporters.length === 0)
    throw new Error('[bis] no reporting economies discovered; refusing public overwrite')
  if (records.length === 0)
    throw new Error('[bis] no usable corridors parsed; refusing public overwrite')
}

/**
 * 보고국 발견 → 보고국×포지션별 전기간 수집(캐시·bounded retry) → 회랑 레코드.
 * 반환과 함께 커버리지 요약을 콘솔에 남긴다(폐합 §12 정신 — 조정하지 않고 기록).
 */
export async function runBis(
  iso3ByIso2: ReadonlyMap<string, string>,
): Promise<{ records: BilateralRecord[]; reporters: string[]; droppedReporters: string[] }> {
  const failureStart = failures.length
  const year = new Date().getFullYear() - 1
  const disc = await fetchCached(
    'bis/discover_reporters.csv',
    `${BASE}/Q.S.C.G.TO1.A.5J.A..A..N?format=csv&startPeriod=${year}-01-01`,
  )
  if (disc === null) {
    assertNoNewFailures('BIS LBS reporter discovery', failureStart)
    throw new Error('[bis] reporter discovery failed without a recorded fetch failure')
  }
  const all = new Set(parseLbsCsv(disc).map((r) => r.rep2))
  const reporters: string[] = []
  const droppedReporters: string[] = []
  for (const rep of [...all].sort()) {
    if (!isCountryCode(rep)) continue // 집계코드
    if (iso3ByIso2.has(rep)) reporters.push(rep)
    else droppedReporters.push(rep) // 마스터 밖(GG/IM/JE 등) — 정직 드랍+기록
  }

  const rows: LbsRow[] = []
  for (const pos of ['C', 'L'] as const) {
    const bodies = await pooled(reporters, 4, (rep) =>
      fetchCached(`bis/lbs_${rep}_${pos}.csv`, keyUrl(rep, pos)),
    )
    for (const body of bodies) if (body !== null) rows.push(...parseLbsCsv(body))
  }
  assertNoNewFailures('BIS LBS', failureStart)
  const records = toBankRecords(rows, iso3ByIso2)
  requireUsableLbsCoverage(reporters, records)
  assertMinimumRows('BIS LBS reporters', reporters.length, 10)
  assertMinimumRows('BIS LBS corridors', records.length, 100)
  console.log(
    `[bis] reporters ${reporters.length} (dropped: ${droppedReporters.join(',') || 'none'}) · ` +
      `rows ${rows.length} → corridors ${records.length}`,
  )
  return { records, reporters, droppedReporters }
}
