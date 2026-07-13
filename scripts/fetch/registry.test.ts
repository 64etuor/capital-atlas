/**
 * Source classification contract (TDD): every source is classified by
 * collection_mode (live_market / batch_official / derived_model /
 * static_reference) with a cadence consistent with that mode, the published
 * meta/sources.json stays in sync with the code registry, and — the core
 * honesty rule — live-market data never backs an official-statistics record.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MODE_CADENCES,
  SOURCE_REGISTRY,
  sourceById,
  type SourceDef,
} from './registry.ts'
import { OUT_DIR } from './lib.ts'

const readOut = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(OUT_DIR, rel), 'utf8')) as T

describe('SOURCE_REGISTRY — shape and classification', () => {
  it('has unique ids and complete required fields', () => {
    const ids = SOURCE_REGISTRY.map((s) => s.source_id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SOURCE_REGISTRY) {
      for (const field of [
        'source_id',
        'name',
        'publisher',
        'url',
        'license_note',
        'collection_mode',
        'update_frequency',
        'expected_release_lag',
      ] as const) {
        expect(s[field], `${s.source_id}.${field}`).toBeTruthy()
      }
    }
  })

  it('keeps cadence consistent with collection_mode', () => {
    for (const s of SOURCE_REGISTRY) {
      expect(
        MODE_CADENCES[s.collection_mode],
        `${s.source_id}: mode ${s.collection_mode}`,
      ).toContain(s.update_frequency)
    }
  })

  it('classifies the v1 sources correctly', () => {
    const mode = (id: string) => sourceById.get(id)?.collection_mode
    const cadence = (id: string) => sourceById.get(id)?.update_frequency
    // 공식 통계 배치 — 발표 지연이 본질, 실시간 개념 없음
    expect(mode('imf_iip')).toBe('batch_official')
    expect(cadence('imf_iip')).toBe('quarterly')
    // Phase L: 환율(ER, IFS 후속) — LCU 표시 다이얼의 근거 시계열
    expect(mode('imf_ifs_fx')).toBe('batch_official')
    expect(cadence('imf_ifs_fx')).toBe('quarterly')
    expect(mode('imf_bop')).toBe('batch_official')
    expect(mode('imf_pip')).toBe('batch_official')
    expect(cadence('imf_pip')).toBe('annual')
    expect(mode('wb_wdi')).toBe('batch_official')
    // 파이프라인 내부 파생 모델 — 수집이 아니라 계산
    expect(mode('model_regional_median')).toBe('derived_model')
    expect(mode('model_gdp_ratio')).toBe('derived_model')
    // 실시간(일중) 시장 데이터 — v1에서 유일
    expect(mode('coingecko_global')).toBe('live_market')
    // 정적 참조(지오메트리·국가 마스터) — 기존 레지스트리 갭 해소
    expect(mode('natural_earth')).toBe('static_reference')
    expect(mode('world_countries')).toBe('static_reference')
  })
})

describe('published meta/sources.json — sync with the code registry', () => {
  it('contains exactly the registry ids with matching classification', () => {
    const published =
      readOut<Array<SourceDef & { retrieved_at: string }>>('meta/sources.json')
    const pubById = new Map(published.map((s) => [s.source_id, s]))
    expect([...pubById.keys()].sort()).toEqual(
      SOURCE_REGISTRY.map((s) => s.source_id).sort(),
    )
    for (const def of SOURCE_REGISTRY) {
      const pub = pubById.get(def.source_id)
      expect(pub?.collection_mode, def.source_id).toBe(def.collection_mode)
      expect(pub?.update_frequency, def.source_id).toBe(def.update_frequency)
      expect(pub?.publisher, def.source_id).toBe(def.publisher)
      expect(pub?.retrieved_at, def.source_id).toBeTruthy()
    }
  })
})

describe('record-level honesty — live data never masquerades as statistics', () => {
  const SHARDS = [
    'stocks_owner/2026-Q1.json',
    'stocks_owner/2024-Q4.json',
    'stocks_issuer/2024-Q4.json', // annual WB market cap lands on Q4
    'stocks_location/2025-Q4.json',
    'flows_country/2026-Q1.json',
    'flows_bilateral/2024-Q4.json',
  ]

  it('every record source_id resolves in the registry', () => {
    for (const shard of SHARDS) {
      const { records } = readOut<{ records: Array<{ source_id: string }> }>(shard)
      for (const r of records) {
        expect(sourceById.has(r.source_id), `${shard}: ${r.source_id}`).toBe(true)
      }
    }
  })

  it('no stocks/flows record is backed by a live_market or static_reference source', () => {
    for (const shard of SHARDS) {
      const { records } = readOut<{ records: Array<{ source_id: string }> }>(shard)
      for (const r of records) {
        const m = sourceById.get(r.source_id)?.collection_mode
        expect(
          m === 'batch_official' || m === 'derived_model',
          `${shard}: ${r.source_id} → ${m}`,
        ).toBe(true)
      }
    }
  })
})
