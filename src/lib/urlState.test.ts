/** URL 딥링크 직렬화 계약 (P2-9) — 검증 실패 값 드랍, 기본값 생략, 왕복. */
import { beforeAll, describe, expect, it } from 'vitest'
import { initPeriods } from './periods'
import { parseUrlState, serializeUrlState } from './urlState'

beforeAll(() => {
  initPeriods('2026-Q1')
})

const DEFAULTS = {
  view: 'globe',
  country: null,
  asset: 'all',
  period: '2026-Q1',
  basis: 'owner',
  measure: 'stock',
  vis: 'est',
  curr: 'usd',
  lang: 'en',
} as const

describe('parseUrlState', () => {
  it('accepts a full valid deep link', () => {
    expect(
      parseUrlState(
        '?view=station&country=KOR&asset=listed_equity&period=2024-Q4&basis=issuer&measure=flow&vis=obs&curr=lcu&lang=ko',
      ),
    ).toEqual({
      view: 'station',
      country: 'KOR',
      asset: 'listed_equity',
      period: '2024-Q4',
      basis: 'issuer',
      measure: 'flow',
      vis: 'obs',
      curr: 'lcu',
      lang: 'ko',
    })
  })
  it('silently drops invalid values instead of breaking the app', () => {
    expect(
      parseUrlState(
        '?view=hack&country=kor&asset=nfts&period=2026-Q9&basis=me&measure=x&vis=all&curr=krw&lang=jp',
      ),
    ).toEqual({})
  })
})

describe('serializeUrlState', () => {
  it('omits every default — clean base URL', () => {
    expect(serializeUrlState({ ...DEFAULTS })).toBe('')
  })
  it('round-trips non-default state', () => {
    const q = serializeUrlState({
      ...DEFAULTS,
      view: 'station',
      country: 'KOR',
      asset: 'deposits',
      vis: 'obs',
      curr: 'lcu',
      lang: 'ko',
    })
    expect(parseUrlState(q)).toEqual({
      view: 'station',
      country: 'KOR',
      asset: 'deposits',
      vis: 'obs',
      curr: 'lcu',
      lang: 'ko',
    })
  })
})
