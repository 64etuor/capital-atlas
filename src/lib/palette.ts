/**
 * I-2 커맨드 팔레트 파서 — mono 계기 코드 체계가 곧 명령어(UX_RESEARCH
 * P2-11: Bloomberg 함수 코드의 접근성 버전). 순수 로직: 토큰 → 의도.
 * 국가+자산 의도가 있으면 STATION 뷰를 함의한다.
 */
import type { AssetClass, Basis, MeasureType, PeriodKey } from '../types/data'
import { ASSET_LABELS } from './assetLabels'
import { ASSET_ABBR } from '../features/synoptic/shared'

export type PaletteAction =
  | { kind: 'view'; view: 'globe' | 'synoptic' | 'station' }
  | { kind: 'country'; iso3: string } // 'WLD' = 세계(선택 해제)
  | { kind: 'asset'; asset: 'all' | AssetClass }
  | { kind: 'period'; period: PeriodKey }
  | { kind: 'basis'; basis: Basis }
  | { kind: 'measure'; measure: MeasureType }
  | { kind: 'vis'; vis: 'est' | 'obs' }
  | { kind: 'lang'; lang: 'en' | 'ko' }
  | { kind: 'tutorial' }

export interface PaletteSuggestion {
  id: string
  /** mono 라벨 — 계기 코드 그대로, 로케일 불변 */
  label: string
  /** 구성 의도 종류 — 컴포넌트가 i18n 힌트로 변환 */
  kinds: Array<PaletteAction['kind']>
  actions: PaletteAction[]
}

export interface PaletteContext {
  countries: Array<{ iso3: string; name: string }>
  recentQueries: string[]
}

const VIEW_CODES: Record<string, 'globe' | 'synoptic' | 'station'> = {
  GLOBE: 'globe',
  SYNOPTIC: 'synoptic',
  STATION: 'station',
}
const BASIS_CODES: Record<string, Basis> = {
  OWN: 'owner',
  ISS: 'issuer',
  LOC: 'location',
}
const MEASURE_CODES: Record<string, MeasureType> = {
  STK: 'stock',
  FLW: 'flow',
  VAL: 'valuation',
  TRN: 'turnover',
}

/** 주요국 한글 별칭 — 계기 코드가 아니라 검색 편의 (전량 수기 검수 가능 규모). */
const KO_COUNTRY_ALIASES: Record<string, string> = {
  한국: 'KOR',
  대한민국: 'KOR',
  미국: 'USA',
  일본: 'JPN',
  중국: 'CHN',
  독일: 'DEU',
  영국: 'GBR',
  프랑스: 'FRA',
  캐나다: 'CAN',
  호주: 'AUS',
  인도: 'IND',
  브라질: 'BRA',
  러시아: 'RUS',
  이탈리아: 'ITA',
  스페인: 'ESP',
  네덜란드: 'NLD',
  스위스: 'CHE',
  싱가포르: 'SGP',
  홍콩: 'HKG',
  아일랜드: 'IRL',
  룩셈부르크: 'LUX',
  노르웨이: 'NOR',
  스웨덴: 'SWE',
  멕시코: 'MEX',
  인도네시아: 'IDN',
  터키: 'TUR',
  튀르키예: 'TUR',
  사우디: 'SAU',
  남아공: 'ZAF',
  세계: 'WLD',
}

const ABBR_TO_ASSET: Record<string, AssetClass> = Object.fromEntries(
  Object.entries(ASSET_ABBR).map(([asset, abbr]) => [abbr, asset]),
) as Record<string, AssetClass>

const PERIOD_RE = /^(\d{4})-?Q([1-4])$/i
const YEAR_RE = /^(20\d{2})$/

interface Parsed {
  actions: PaletteAction[]
  matched: number
  countryAlternates: string[]
}

function matchCountry(
  raw: string,
  countries: PaletteContext['countries'],
): { iso3: string; alternates: string[] } | null {
  const upper = raw.toUpperCase()
  if (upper === 'WLD' || upper === 'WORLD') return { iso3: 'WLD', alternates: [] }
  if (KO_COUNTRY_ALIASES[raw]) return { iso3: KO_COUNTRY_ALIASES[raw], alternates: [] }
  if (/^[A-Z]{3}$/.test(upper) && countries.some((c) => c.iso3 === upper))
    return { iso3: upper, alternates: [] }
  if (raw.length < 3) return null
  const q = raw.toLowerCase()
  const hits = countries.filter((c) => c.name.toLowerCase().includes(q))
  hits.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1
    const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1
    return ap - bp || a.name.localeCompare(b.name)
  })
  if (hits.length === 0) return null
  return { iso3: hits[0].iso3, alternates: hits.slice(1, 4).map((c) => c.iso3) }
}

function matchAsset(raw: string): AssetClass | null {
  const upper = raw.toUpperCase()
  if (ABBR_TO_ASSET[upper]) return ABBR_TO_ASSET[upper]
  if (raw.length < 4) return null
  const q = raw.toLowerCase()
  for (const [asset, label] of Object.entries(ASSET_LABELS)) {
    if (label.toLowerCase().includes(q)) return asset as AssetClass
  }
  return null
}

function parse(query: string, ctx: PaletteContext): Parsed {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  const actions: PaletteAction[] = []
  const alternates: string[] = []
  let matched = 0
  for (const tok of tokens) {
    const upper = tok.toUpperCase()
    if (VIEW_CODES[upper]) {
      actions.push({ kind: 'view', view: VIEW_CODES[upper] })
    } else if (BASIS_CODES[upper]) {
      actions.push({ kind: 'basis', basis: BASIS_CODES[upper] })
    } else if (MEASURE_CODES[upper]) {
      actions.push({ kind: 'measure', measure: MEASURE_CODES[upper] })
    } else if (upper === 'OBS') {
      actions.push({ kind: 'vis', vis: 'obs' })
    } else if (upper === 'EST' || upper === 'EST+') {
      actions.push({ kind: 'vis', vis: 'est' })
    } else if (upper === 'KO' || upper === 'EN') {
      actions.push({ kind: 'lang', lang: upper.toLowerCase() as 'en' | 'ko' })
    } else if (upper === 'TUTORIAL') {
      actions.push({ kind: 'tutorial' })
    } else if (upper === 'ALL') {
      actions.push({ kind: 'asset', asset: 'all' })
    } else if (PERIOD_RE.test(upper)) {
      const m = PERIOD_RE.exec(upper)
      if (m) {
        actions.push({
          kind: 'period',
          period: `${m[1]}-Q${m[2]}` as PeriodKey,
        })
      }
    } else if (YEAR_RE.test(upper)) {
      actions.push({ kind: 'period', period: `${upper}-Q4` as PeriodKey })
    } else {
      const asset = matchAsset(tok)
      if (asset) {
        actions.push({ kind: 'asset', asset })
      } else {
        const country = matchCountry(tok, ctx.countries)
        if (country) {
          actions.push({ kind: 'country', iso3: country.iso3 })
          alternates.push(...country.alternates)
        } else {
          continue // 미지의 토큰은 무시 — 매칭된 의도는 살린다
        }
      }
    }
    matched++
  }
  // 국가/자산 의도가 있고 뷰가 명시되지 않았으면 STATION을 함의
  if (
    actions.some((a) => a.kind === 'country' || a.kind === 'asset') &&
    !actions.some((a) => a.kind === 'view')
  ) {
    actions.push({ kind: 'view', view: 'station' })
  }
  return { actions, matched, countryAlternates: alternates }
}

function toSuggestion(id: string, actions: PaletteAction[]): PaletteSuggestion {
  const label = actions
    .map((a) => {
      switch (a.kind) {
        case 'view':
          return a.view.toUpperCase()
        case 'country':
          return a.iso3
        case 'asset':
          return a.asset === 'all' ? 'ALL' : ASSET_ABBR[a.asset]
        case 'period':
          return a.period
        case 'basis':
          return Object.entries(BASIS_CODES).find(([, v]) => v === a.basis)?.[0]
        case 'measure':
          return Object.entries(MEASURE_CODES).find(
            ([, v]) => v === a.measure,
          )?.[0]
        case 'vis':
          return a.vis === 'obs' ? 'OBS' : 'EST+'
        case 'lang':
          return a.lang.toUpperCase()
        case 'tutorial':
          return 'TUTORIAL'
      }
    })
    .filter(Boolean)
    .join(' · ')
  return { id, label, kinds: actions.map((a) => a.kind), actions }
}

const DEFAULT_SUGGESTIONS: PaletteAction[][] = [
  [{ kind: 'view', view: 'globe' }],
  [{ kind: 'view', view: 'synoptic' }],
  [{ kind: 'view', view: 'station' }],
  [{ kind: 'vis', vis: 'obs' }],
  [{ kind: 'vis', vis: 'est' }],
  [{ kind: 'tutorial' }],
]

export function suggest(
  query: string,
  ctx: PaletteContext,
  limit = 9,
): PaletteSuggestion[] {
  const out: PaletteSuggestion[] = []
  if (query.trim() === '') {
    for (const q of ctx.recentQueries) {
      const p = parse(q, ctx)
      if (p.actions.length > 0) out.push(toSuggestion(`recent:${q}`, p.actions))
    }
    for (const [i, actions] of DEFAULT_SUGGESTIONS.entries()) {
      out.push(toSuggestion(`default:${i}`, actions))
    }
    return out.slice(0, limit)
  }
  const p = parse(query, ctx)
  if (p.actions.length > 0) out.push(toSuggestion('primary', p.actions))
  // 국가 대안 — 이름 부분 일치가 여럿일 때 (국가 단독 점프)
  for (const iso3 of p.countryAlternates) {
    out.push(
      toSuggestion(`alt:${iso3}`, [
        { kind: 'country', iso3 },
        { kind: 'view', view: 'station' },
      ]),
    )
  }
  return out.slice(0, limit)
}

// -------------------------------------------------------------- dispatch ----

export interface PaletteHandlers {
  setAppView: (v: 'globe' | 'synoptic' | 'station') => void
  selectCountry: (iso3: string | null) => void
  setStationAsset: (a: 'all' | AssetClass) => void
  setPeriod: (p: PeriodKey) => void
  setBasis: (b: Basis) => void
  setMeasure: (m: MeasureType) => void
  setVis: (v: 'est' | 'obs') => void
  setLang: (l: 'en' | 'ko') => void
  openTutorial: () => void
}

export function runActions(
  actions: PaletteAction[],
  h: PaletteHandlers,
): void {
  for (const a of actions) {
    switch (a.kind) {
      case 'view':
        h.setAppView(a.view)
        break
      case 'country':
        h.selectCountry(a.iso3 === 'WLD' ? null : a.iso3)
        break
      case 'asset':
        h.setStationAsset(a.asset)
        break
      case 'period':
        h.setPeriod(a.period)
        break
      case 'basis':
        h.setBasis(a.basis)
        break
      case 'measure':
        h.setMeasure(a.measure)
        break
      case 'vis':
        h.setVis(a.vis)
        break
      case 'lang':
        h.setLang(a.lang)
        break
      case 'tutorial':
        h.openTutorial()
        break
    }
  }
}
