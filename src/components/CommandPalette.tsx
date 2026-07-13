/**
 * I-2 커맨드 팔레트 — Cmd/Ctrl+K. mono 계기 코드가 곧 명령어(파서는
 * lib/palette). 잉크 시트 + mono, 글래스 금지(§7). Esc 계층 최상단.
 * 입력 상태는 열릴 때마다 초기화 — 시트를 open 시에만 마운트해 자연 리셋
 * (effect-내 동기 setState 금지 규칙 준수).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useViewStore } from '../store/viewStore'
import { getCountries, getStationIndex } from '../lib/dataClient'
import { indexFromPeriod } from '../lib/periods'
import { applyLocale } from '../i18n'
import {
  runActions,
  suggest,
  type PaletteContext,
  type PaletteHandlers,
  type PaletteSuggestion,
} from '../lib/palette'

const RECENT_KEY = 'atlas.paletteRecent'
const MAX_RECENT = 6

const readRecents = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

export function CommandPalette() {
  const open = useViewStore((s) => s.paletteOpen)
  const [countries, setCountries] = useState<
    Array<{ iso3: string; name: string }>
  >([])

  // Cmd/Ctrl+K 토글 — 항상 마운트된 전역 리스너
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const s = useViewStore.getState()
        s.setPaletteOpen(!s.paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 국가 목록 lazy 로드(1회) — 비동기 완료 시 반영
  useEffect(() => {
    if (!open || countries.length > 0) return
    let alive = true
    Promise.all([getStationIndex(), getCountries()])
      .then(([idx, names]) => {
        if (!alive) return
        setCountries(
          idx.countries.map((c) => ({
            iso3: c,
            name: names.get(c)?.name ?? c,
          })),
        )
      })
      .catch(() => {
        /* 팔레트는 코드 명령만으로도 동작 — 국가 검색만 빈다 */
      })
    return () => {
      alive = false
    }
  }, [open, countries.length])

  if (!open) return null
  return <PaletteSheet countries={countries} />
}

function PaletteSheet({
  countries,
}: {
  countries: Array<{ iso3: string; name: string }>
}) {
  const { t } = useTranslation()
  const setOpen = useViewStore((s) => s.setPaletteOpen)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const ctx: PaletteContext = { countries, recentQueries: readRecents() }
  const suggestions = suggest(query, ctx)
  const activeIdx = Math.min(active, Math.max(suggestions.length - 1, 0))

  const run = (s: PaletteSuggestion | undefined) => {
    if (!s) return
    const store = useViewStore.getState()
    const handlers: PaletteHandlers = {
      setAppView: store.setAppView,
      selectCountry: store.selectCountry,
      setStationAsset: store.setStationAsset,
      setPeriod: (p) => store.setPeriodIndex(indexFromPeriod(p)),
      setBasis: store.setBasis,
      setMeasure: store.setMeasure,
      setVis: (v) => useViewStore.setState({ includeEstimates: v === 'est' }),
      setLang: applyLocale,
      openTutorial: () => store.setTutorialOpen(true),
    }
    runActions(s.actions, handlers)
    const q = query.trim()
    if (q) {
      const next = [q, ...readRecents().filter((r) => r !== q)].slice(
        0,
        MAX_RECENT,
      )
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    }
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = Math.max(suggestions.length, 1)
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % n)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + n) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(suggestions[activeIdx])
    }
  }

  return (
    <div
      role="dialog"
      aria-label={t('palette.aria')}
      className="absolute inset-0 z-50"
    >
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={() => setOpen(false)}
        className="absolute inset-0 h-full w-full cursor-default bg-ink-0/70"
      />
      <div className="relative mx-auto mt-[16vh] w-[min(620px,92vw)] border border-paper/15 bg-ink-1">
        <div className="flex items-baseline gap-3 border-b border-paper/10 px-4 py-2.5">
          <span className="dial-label text-flow-in">⌘K</span>
          <input
            // 팔레트의 존재 이유가 즉시 타이핑 — autoFocus 의도적
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            aria-label={t('palette.inputAria')}
            placeholder={t('palette.placeholder')}
            spellCheck={false}
            autoComplete="off"
            className="readout w-full bg-transparent text-[13px] tracking-[0.08em] text-paper placeholder:text-paper-dim/40 focus:outline-none"
          />
        </div>
        <ul
          role="listbox"
          aria-label={t('palette.aria')}
          className="max-h-[40vh] overflow-y-auto py-1"
        >
          {suggestions.length === 0 && (
            <li className="readout px-4 py-3 text-[11px] tracking-[0.14em] text-paper-dim">
              {t('palette.empty')}
            </li>
          )}
          {suggestions.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === activeIdx}>
              <button
                type="button"
                onClick={() => run(s)}
                onMouseEnter={() => setActive(i)}
                className={
                  'flex w-full items-baseline justify-between gap-4 px-4 py-1.5 text-left transition-colors duration-140 ' +
                  (i === activeIdx
                    ? 'border-l-2 border-flow-in bg-ink-2/60'
                    : 'border-l-2 border-transparent')
                }
              >
                <span className="readout text-[12px] text-paper">
                  {s.label}
                </span>
                <span className="dial-label text-[9px] text-paper-dim/60">
                  {[...new Set(s.kinds)]
                    .map((k) => t(`palette.kind.${k}`))
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="dial-label border-t border-paper/10 px-4 py-2 text-[9px] text-paper-dim/50">
          {t('palette.footer')}
        </p>
      </div>
    </div>
  )
}
