/**
 * URL 딥링크 (UX_RESEARCH P2-9) — view/country/asset/period/basis/measure/
 * vis/lang을 쿼리스트링에 직렬화. 새로고침·공유 시 상태 복원, appView가
 * HMR/리로드에 리셋되던 약점 동시 해소. 기본값은 URL에서 생략한다.
 */
import type { AssetClass, Basis, MeasureType } from '../types/data'
import { indexFromPeriod, latestPeriod, periodFromIndex } from './periods'
import type { useViewStore } from '../store/viewStore'
import i18n, { applyLocale } from '../i18n'

export interface UrlState {
  view?: 'globe' | 'synoptic' | 'station'
  country?: string
  asset?: 'all' | AssetClass
  period?: string
  basis?: Basis
  measure?: MeasureType
  vis?: 'est' | 'obs'
  lang?: 'en' | 'ko'
}

const VIEWS = new Set(['globe', 'synoptic', 'station'])
const BASES = new Set(['owner', 'issuer', 'location'])
const MEASURES = new Set(['stock', 'flow', 'valuation', 'turnover'])
const ASSETS = new Set([
  'all',
  'deposits',
  'loans',
  'debt_securities',
  'listed_equity',
  'unlisted_equity_fdi',
  'funds',
  'reserves_gold',
  'residential_property',
  'commodities',
  'crypto',
])

/** 검증 실패 값은 조용히 버린다 — 잘못된 딥링크가 앱을 깨지 않게. */
export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search)
  const out: UrlState = {}
  const view = p.get('view')
  if (view && VIEWS.has(view)) out.view = view as UrlState['view']
  const country = p.get('country')
  if (country && /^[A-Z]{3}$/.test(country)) out.country = country
  const asset = p.get('asset')
  if (asset && ASSETS.has(asset)) out.asset = asset as UrlState['asset']
  const period = p.get('period')
  if (period && /^\d{4}-Q[1-4]$/.test(period)) out.period = period
  const basis = p.get('basis')
  if (basis && BASES.has(basis)) out.basis = basis as Basis
  const measure = p.get('measure')
  if (measure && MEASURES.has(measure)) out.measure = measure as MeasureType
  const vis = p.get('vis')
  if (vis === 'est' || vis === 'obs') out.vis = vis
  const lang = p.get('lang')
  if (lang === 'en' || lang === 'ko') out.lang = lang
  return out
}

/** 기본값(globe/all/최신분기/owner/stock/est/en)은 생략 — URL을 짧게. */
export function serializeUrlState(s: Required<Omit<UrlState, 'country'>> & {
  country: string | null
}): string {
  const p = new URLSearchParams()
  if (s.view !== 'globe') p.set('view', s.view)
  if (s.country) p.set('country', s.country)
  if (s.asset !== 'all') p.set('asset', s.asset)
  if (s.period !== latestPeriod()) p.set('period', s.period)
  if (s.basis !== 'owner') p.set('basis', s.basis)
  if (s.measure !== 'stock') p.set('measure', s.measure)
  if (s.vis !== 'est') p.set('vis', s.vis)
  if (s.lang !== 'en') p.set('lang', s.lang)
  const q = p.toString()
  return q ? `?${q}` : ''
}

type ViewStore = typeof useViewStore

/** 부팅 시 1회 — 기간 정본(initPeriods) 확정 후 호출해야 클램프가 정확. */
export function applyUrlState(store: ViewStore): void {
  const u = parseUrlState(window.location.search)
  store.setState((prev) => ({
    appView: u.view ?? prev.appView,
    selectedCountry: u.country ?? prev.selectedCountry,
    stationAsset: u.asset ?? prev.stationAsset,
    basis: u.basis ?? prev.basis,
    measure: u.measure ?? prev.measure,
    includeEstimates: u.vis ? u.vis === 'est' : prev.includeEstimates,
    periodIndex: u.period
      ? Math.min(
          Math.max(indexFromPeriod(u.period as never), 0),
          indexFromPeriod(latestPeriod()),
        )
      : prev.periodIndex,
  }))
  if (u.lang) applyLocale(u.lang)
}

/** 상태 → URL 반영 (debounce, replaceState — 히스토리 오염 없음). */
export function startUrlSync(store: ViewStore): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const push = () => {
    const s = store.getState()
    const next =
      serializeUrlState({
        view: s.appView,
        country: s.selectedCountry,
        asset: s.stationAsset,
        period: periodFromIndex(s.periodIndex),
        basis: s.basis,
        measure: s.measure,
        vis: s.includeEstimates ? 'est' : 'obs',
        lang: i18n.language === 'ko' ? 'ko' : 'en',
      }) || window.location.pathname
    if (window.location.search !== (next.startsWith('?') ? next : '')) {
      window.history.replaceState(null, '', next)
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(push, 300)
  }
  store.subscribe(schedule)
  i18n.on('languageChanged', schedule)
}
