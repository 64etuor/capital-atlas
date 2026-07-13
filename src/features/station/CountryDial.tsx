/**
 * 국가 다이얼 — mono 검색 콤보(§5 계기 어법). 타이핑 필터 + 완전한 키보드
 * 조작(↑↓/Enter/Esc). WORLD = 세계 집계(WLD).
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface DialCountry {
  iso3: string
  name: string
}

/** 최근 선택 관측소 — 상단 고정 (UX_RESEARCH P1-4). */
const RECENT_KEY = 'atlas.recentStations'
function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}
function pushRecent(iso3: string): void {
  if (iso3 === 'WLD') return
  localStorage.setItem(
    RECENT_KEY,
    JSON.stringify([iso3, ...readRecents().filter((r) => r !== iso3)].slice(0, 5)),
  )
}

interface Props {
  countries: DialCountry[]
  currentIso: string // 'WLD' = world
  currentName: string
  onSelect: (iso3: string | null) => void
}

export function CountryDial({
  countries,
  currentIso,
  currentName,
  onSelect,
}: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toUpperCase()
  const matches = countries.filter(
    (c) => q === '' || c.iso3.includes(q) || c.name.toUpperCase().includes(q),
  )
  // 빈 쿼리일 때 최근 선택을 상단으로 (P1-4)
  const recents =
    q === ''
      ? readRecents()
          .map((iso) => matches.find((c) => c.iso3 === iso))
          .filter((c): c is DialCountry => c !== undefined)
      : []
  const recentSet = new Set(recents.map((c) => c.iso3))
  const rows: DialCountry[] = [
    { iso3: 'WLD', name: t('dial.world') },
    ...recents,
    ...matches.filter((c) => !recentSet.has(c.iso3)),
  ]

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const choose = (iso3: string) => {
    pushRecent(iso3)
    onSelect(iso3 === 'WLD' ? null : iso3)
    setOpen(false)
    setQuery('')
    setCursor(0)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className="dial-label flex items-center gap-2 border-y border-paper/10 bg-ink-1/70 px-2.5 py-1.5 text-paper-dim transition-colors duration-140 hover:text-paper"
      >
        {t('dial.label')}
        <span className="text-flow-in">{currentIso === 'WLD' ? 'WORLD' : currentIso}</span>
        <span aria-hidden="true" className="text-paper-dim/60">
          ▾
        </span>
        <span className="sr-only">{currentName}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 border border-paper/15 bg-ink-0/95">
          <input
            ref={inputRef}
            value={query}
            placeholder={t('dial.filterPlaceholder')}
            aria-label={t('dial.filterAria')}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(c + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const row = rows[cursor]
                if (row) choose(row.iso3)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              }
            }}
            className="readout w-full border-b border-paper/10 bg-transparent px-2.5 py-2 text-[11px] tracking-[0.14em] text-paper placeholder:text-paper-dim/50 focus:outline-none"
          />
          <ul
            role="listbox"
            aria-label={t('dial.listAria')}
            className="max-h-72 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {rows.length === 1 && q !== '' && (
              <li className="dial-label px-2.5 py-2 text-paper-dim/60">
                {t('dial.noMatch')}
              </li>
            )}
            {rows.map((c, i) => (
              <li key={c.iso3} role="option" aria-selected={c.iso3 === currentIso}>
                <button
                  type="button"
                  onClick={() => choose(c.iso3)}
                  onPointerEnter={() => setCursor(i)}
                  className={
                    'flex w-full items-baseline gap-3 px-2.5 py-1.5 text-left transition-colors duration-140 ' +
                    (i === cursor ? 'bg-ink-2/80' : '')
                  }
                >
                  <span
                    className={
                      'readout w-10 shrink-0 text-[11px] ' +
                      (c.iso3 === currentIso ? 'text-flow-in' : 'text-paper')
                    }
                  >
                    {c.iso3 === 'WLD' ? '◎' : c.iso3}
                  </span>
                  <span className="dial-label min-w-0 flex-1 truncate text-paper-dim">
                    {c.name}
                    {q === '' && recentSet.has(c.iso3) ? (
                      <span className="ml-2 text-flow-in/50">
                        {t('dial.recent')}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
