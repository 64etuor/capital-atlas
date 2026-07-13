/**
 * 결정론적 샤드 계약 (Phase N) — 타임스탬프는 index.json·meta 일부에만 산다.
 * 샤드/파생 파일에 generated_at이 있으면 상류 데이터가 안 바뀌어도 일일 크론이
 * 184MB 전 파일을 재커밋한다(레포 비대화 + 개정 이력 무의미화). 이 테스트는
 * 발행된 산출물에서 그 회귀를 바이트 수준으로 차단한다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUT_DIR } from '../fetch/lib.ts'

const read = (rel: string) => readFileSync(join(OUT_DIR, rel), 'utf8')

/** 결정론 대상(대표 표본) — generated_at 금지 */
const DETERMINISTIC = [
  'stocks_owner/2026-Q1.json',
  'stocks_issuer/2024-Q4.json',
  'stocks_location/2025-Q4.json',
  'flows_country/2026-Q1.json',
  'flows_bilateral/2024-Q4.json',
  'flows_bilateral/2025-Q4.json', // BIS 분기 확장 샤드
  'meta/flow_intensity.json',
  'meta/synoptic.json',
  'meta/fx_rates.json',
  'station/KOR.json',
  'station/WLD.json',
  'station/index.json',
]

/** 타임스탬프 보유 허용(빈티지·수집 시각의 정본) */
const TIMESTAMPED = ['index.json']

describe('결정론적 샤드 — generated_at은 index.json에만', () => {
  it.each(DETERMINISTIC)('%s 에 generated_at 없음', (rel) => {
    expect(read(rel)).not.toContain('"generated_at"')
  })

  it.each(TIMESTAMPED)('%s 는 generated_at 보유(데이터 빈티지 정본)', (rel) => {
    expect(read(rel)).toContain('"generated_at"')
  })

  it('sources.json은 retrieved_at만 보유(수집 시각)', () => {
    const s = read('meta/sources.json')
    expect(s).toContain('"retrieved_at"')
    expect(s).not.toContain('"generated_at"')
  })
})
