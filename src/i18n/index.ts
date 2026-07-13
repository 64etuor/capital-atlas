/**
 * i18n (G2) — react-i18next + 정적 카탈로그 ko/en.
 * 경계(UX_RESEARCH §3): 계기 코드(OWN/STK/EST+/DEBT/EQTY/A–E/ISO3/2024-Q3,
 * 뷰 코드 GLOBE/SYNOPTIC/STATION)는 로케일 불변 — 프로즈·툴팁·빈 상태·
 * 도시에 행 라벨·aria-label만 번역한다.
 * 로케일 결정: URL ?lang= > localStorage > 기본 en. <html lang> 동기화.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import ko from './ko.json'

export type Locale = 'en' | 'ko'
export const LOCALES: readonly Locale[] = ['en', 'ko']
const STORAGE_KEY = 'atlas.lang'

const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'ko'

export function detectLocale(): Locale {
  const url = new URLSearchParams(window.location.search).get('lang')
  if (isLocale(url)) return url
  const stored = localStorage.getItem(STORAGE_KEY)
  if (isLocale(stored)) return stored
  return 'en'
}

export function applyLocale(locale: Locale): void {
  void i18n.changeLanguage(locale)
  localStorage.setItem(STORAGE_KEY, locale)
  document.documentElement.lang = locale
}

export function currentLocale(): Locale {
  return isLocale(i18n.language) ? i18n.language : 'en'
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ko: { translation: ko } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
