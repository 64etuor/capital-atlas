/**
 * Phase P-2 — 미러 폐합 엔진 (초안 §12-3).
 *
 * BIS LBS는 같은 경제 실체를 두 보고국이 각자 관측한다:
 *   A 보고 claims(A→B 방향, asset=loans)  vs  B 보고 liabilities(A→B, asset=deposits)
 * 둘 다 "A 거주자의 대B 은행 포지션"의 관측이므로 gap이 폐합 품질 신호다.
 * §12 정신: **조정하지 않고 기록한다** — gap은 상대국 부문 커버리지 차이
 * (보고국 은행 vs 상대국 전 부문)와 실제 불일치가 섞인 값이라 수십%가 정상.
 *
 * CPIS(imf_pip)는 소유자 단방향 보고라 미러가 불가능하다 — 계약에 명시.
 * 프루닝(|값|≥$100M) 탓에 한쪽이 임계 미만인 쌍은 비교 불가 → 정직 생략.
 *
 * 산출: reconciliation/{period}.json (쌍 상세, LRU 샤드) +
 *       meta/reconciliation.json (분포 요약 — 사용자·sanity 게이트용).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BilateralRecord, PeriodIndexFile } from '../../src/types/data.ts'
import { OUT_DIR, writeJson } from '../fetch/lib.ts'

export interface MirrorPair {
  owner: string
  issuer: string
  /** owner국 보고 — 은행의 대외 채권(claims, asset=loans로 매핑된 레코드) */
  claims_usd: number
  /** issuer국 보고 — 비거주자 예치(liabilities, asset=deposits로 매핑된 레코드) */
  liabilities_usd: number
  gap_usd: number
  /** |gap| / max(두 관측) — 0=완전 폐합 */
  gap_share: number
}

/** 한 분기의 bilateral 레코드에서 양방향 관측 쌍을 구성한다. */
export function mirrorFromRecords(
  records: readonly BilateralRecord[],
): MirrorPair[] {
  const claims = new Map<string, number>()
  const liabs = new Map<string, number>()
  for (const r of records) {
    if (r.source_id !== 'bis_lbs' || r.measure !== 'stock') continue
    const key = `${r.owner_country}|${r.issuer_country}`
    if (r.asset === 'loans') claims.set(key, (claims.get(key) ?? 0) + r.value_usd)
    else if (r.asset === 'deposits')
      liabs.set(key, (liabs.get(key) ?? 0) + r.value_usd)
  }
  const out: MirrorPair[] = []
  for (const [key, c] of claims) {
    const l = liabs.get(key)
    if (l === undefined) continue // 한쪽 관측뿐 — 미러 없음(정직 생략)
    const [owner, issuer] = key.split('|')
    const denom = Math.max(Math.abs(c), Math.abs(l))
    out.push({
      owner,
      issuer,
      claims_usd: c,
      liabilities_usd: l,
      gap_usd: c - l,
      gap_share: denom === 0 ? 0 : Math.abs(c - l) / denom,
    })
  }
  // 결정론적 정렬 (owner, issuer)
  out.sort((a, b) =>
    a.owner === b.owner
      ? a.issuer.localeCompare(b.issuer)
      : a.owner.localeCompare(b.owner),
  )
  return out
}

const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export interface MirrorSummary {
  method: string
  caveat: string
  periods: Record<
    string,
    {
      pairs: number
      median_gap_share: number
      p25_gap_share: number
      p75_gap_share: number
    }
  >
  /** 최신 분기, 규모(max 관측) 상위 쌍의 gap — 어디가 크게 어긋나는가 */
  latest_top_gaps: Array<{
    period: string
    owner: string
    issuer: string
    claims_usd: number
    liabilities_usd: number
    gap_share: number
  }>
}

export function summarizeMirrors(
  byPeriod: ReadonlyMap<string, MirrorPair[]>,
): MirrorSummary {
  const periods: MirrorSummary['periods'] = {}
  for (const [p, pairs] of [...byPeriod.entries()].sort()) {
    const gaps = pairs.map((x) => x.gap_share).sort((a, b) => a - b)
    periods[p] = {
      pairs: pairs.length,
      median_gap_share: quantile(gaps, 0.5),
      p25_gap_share: quantile(gaps, 0.25),
      p75_gap_share: quantile(gaps, 0.75),
    }
  }
  const latest = [...byPeriod.keys()].sort().at(-1)
  const latest_top_gaps = latest
    ? [...(byPeriod.get(latest) ?? [])]
        .sort(
          (a, b) =>
            Math.max(Math.abs(b.claims_usd), Math.abs(b.liabilities_usd)) -
            Math.max(Math.abs(a.claims_usd), Math.abs(a.liabilities_usd)),
        )
        .slice(0, 10)
        .map((x) => ({
          period: latest,
          owner: x.owner,
          issuer: x.issuer,
          claims_usd: x.claims_usd,
          liabilities_usd: x.liabilities_usd,
          gap_share: x.gap_share,
        }))
    : []
  return {
    method:
      'bis_lbs bilateral mirror — owner-reported claims (loans) vs issuer-reported liabilities (deposits), same direction, two independent reporters',
    caveat:
      'gap mixes counterparty-sector coverage differences with true discrepancies; tens of percent is normal (BIS creditor/debtor comparisons). Pairs below the $100M pruning threshold on either side are omitted. CPIS is one-sided (owner-reported only) and cannot be mirrored.',
    periods,
    latest_top_gaps,
  }
}

// ------------------------------------------------------------------ CLI ----

if (process.argv[1]?.endsWith('reconcile.ts')) {
  const index = JSON.parse(
    readFileSync(join(OUT_DIR, 'index.json'), 'utf8'),
  ) as PeriodIndexFile

  const byPeriod = new Map<string, MirrorPair[]>()
  let written = 0
  for (const p of index.periods.flows_bilateral) {
    const records = (
      JSON.parse(
        readFileSync(join(OUT_DIR, 'flows_bilateral', `${p}.json`), 'utf8'),
      ) as { records: BilateralRecord[] }
    ).records
    const pairs = mirrorFromRecords(records)
    if (pairs.length === 0) continue // CPIS-only 분기(초기 연도) — 샤드 생략
    byPeriod.set(p, pairs)
    writeJson(`reconciliation/${p}.json`, { pairs })
    written++
  }
  writeJson('meta/reconciliation.json', summarizeMirrors(byPeriod))
  const latest = [...byPeriod.keys()].sort().at(-1)
  const s = latest ? summarizeMirrors(byPeriod).periods[latest] : null
  console.log(
    `[reconcile] ${written} period shards · latest ${latest}: ` +
      (s
        ? `${s.pairs} pairs, median gap ${(s.median_gap_share * 100).toFixed(1)}%`
        : 'no mirror pairs'),
  )
}
