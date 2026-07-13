/**
 * I-2 커맨드 팔레트 — 파서/제안 엔진 TDD. mono 계기 코드 체계가 곧 명령어
 * (Bloomberg 함수 코드의 접근성 버전, UX_RESEARCH P2-11).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  runActions,
  suggest,
  type PaletteAction,
  type PaletteContext,
  type PaletteHandlers,
} from './palette'

const CTX: PaletteContext = {
  countries: [
    { iso3: 'KOR', name: 'South Korea' },
    { iso3: 'USA', name: 'United States' },
    { iso3: 'NOR', name: 'Norway' },
  ],
  recentQueries: [],
}

const actionsOf = (query: string): PaletteAction[] =>
  suggest(query, CTX)[0]?.actions ?? []

describe('suggest — 계기 코드 문법', () => {
  it('KOR EQTY → STATION 한국 상장주식 (국가+자산이면 station 뷰 함의)', () => {
    const actions = actionsOf('KOR EQTY')
    expect(actions).toContainEqual({ kind: 'country', iso3: 'KOR' })
    expect(actions).toContainEqual({ kind: 'asset', asset: 'listed_equity' })
    expect(actions).toContainEqual({ kind: 'view', view: 'station' })
  })

  it('뷰 코드 단독: SYNOPTIC → 뷰 전환', () => {
    expect(actionsOf('SYNOPTIC')).toEqual([
      { kind: 'view', view: 'synoptic' },
    ])
  })

  it('시정 코드: OBS / EST+ (대소문자 무관)', () => {
    expect(actionsOf('obs')).toEqual([{ kind: 'vis', vis: 'obs' }])
    expect(actionsOf('est+')).toEqual([{ kind: 'vis', vis: 'est' }])
  })

  it('기간: 2018-Q1 · 2018q1 · 2018(→Q4) 전부 정규화', () => {
    expect(actionsOf('2018-Q1')).toEqual([
      { kind: 'period', period: '2018-Q1' },
    ])
    expect(actionsOf('2018q1')).toEqual([
      { kind: 'period', period: '2018-Q1' },
    ])
    expect(actionsOf('2018')).toEqual([{ kind: 'period', period: '2018-Q4' }])
  })

  it('basis 코드: ISS → issuer', () => {
    expect(actionsOf('ISS')).toEqual([{ kind: 'basis', basis: 'issuer' }])
  })

  it('국가 영문명 부분 일치 + 한글 별칭', () => {
    expect(actionsOf('korea')).toContainEqual({ kind: 'country', iso3: 'KOR' })
    expect(actionsOf('한국')).toContainEqual({ kind: 'country', iso3: 'KOR' })
    expect(actionsOf('미국 EQTY')).toContainEqual({
      kind: 'country',
      iso3: 'USA',
    })
  })

  it('WORLD/세계 → 국가 해제(WLD)', () => {
    expect(actionsOf('WORLD')).toContainEqual({ kind: 'country', iso3: 'WLD' })
    expect(actionsOf('세계')).toContainEqual({ kind: 'country', iso3: 'WLD' })
  })

  it('TUTORIAL 명령', () => {
    expect(actionsOf('TUTORIAL')).toEqual([{ kind: 'tutorial' }])
  })

  it('미지의 토큰은 무시하고 매칭된 의도는 살린다', () => {
    expect(actionsOf('KOR XQZW')).toContainEqual({
      kind: 'country',
      iso3: 'KOR',
    })
  })

  it('빈 질의 → 뷰 명령 포함 기본 제안, limit 준수', () => {
    const s = suggest('', CTX, 5)
    expect(s.length).toBeLessThanOrEqual(5)
    expect(s.some((c) => c.actions.some((a) => a.kind === 'view'))).toBe(true)
  })

  it('제안 id는 유일하다 (React key 회귀 가드)', () => {
    const ids = suggest('', CTX).map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('최근 질의가 빈 질의 제안 상단에 온다', () => {
    const s = suggest('', { ...CTX, recentQueries: ['KOR EQTY'] })
    expect(s[0]?.actions).toContainEqual({ kind: 'country', iso3: 'KOR' })
  })
})

describe('runActions — 스토어 디스패치', () => {
  const handlers = (): PaletteHandlers => ({
    setAppView: vi.fn(),
    selectCountry: vi.fn(),
    setStationAsset: vi.fn(),
    setPeriod: vi.fn(),
    setBasis: vi.fn(),
    setMeasure: vi.fn(),
    setVis: vi.fn(),
    setLang: vi.fn(),
    openTutorial: vi.fn(),
  })

  it('WLD는 selectCountry(null)로 매핑된다', () => {
    const h = handlers()
    runActions([{ kind: 'country', iso3: 'WLD' }], h)
    expect(h.selectCountry).toHaveBeenCalledWith(null)
  })

  it('복합 액션이 전부 디스패치된다', () => {
    const h = handlers()
    runActions(
      [
        { kind: 'country', iso3: 'KOR' },
        { kind: 'asset', asset: 'listed_equity' },
        { kind: 'view', view: 'station' },
        { kind: 'period', period: '2018-Q1' },
      ],
      h,
    )
    expect(h.selectCountry).toHaveBeenCalledWith('KOR')
    expect(h.setStationAsset).toHaveBeenCalledWith('listed_equity')
    expect(h.setAppView).toHaveBeenCalledWith('station')
    expect(h.setPeriod).toHaveBeenCalledWith('2018-Q1')
  })
})
