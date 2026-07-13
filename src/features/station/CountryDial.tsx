/**
 * 국가 다이얼 — mono 검색 콤보(§5 계기 어법). 타이핑 필터 + 완전한 키보드
 * 조작(↑↓/Enter/Esc). WORLD = 세계 집계(WLD).
 */
import { useEffect, useRef, useState } from 'react'

export interface DialCountry {
  iso3: string
  name: string
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
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toUpperCase()
  const rows: DialCountry[] = [
    { iso3: 'WLD', name: 'World' },
    ...countries.filter(
      (c) =>
        q === '' ||
        c.iso3.includes(q) ||
        c.name.toUpperCase().includes(q),
    ),
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
        OBSERVATORY
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
            placeholder="FILTER — ISO3 OR NAME"
            aria-label="Filter countries"
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
            aria-label="Country"
            className="max-h-72 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {rows.length === 1 && q !== '' && (
              <li className="dial-label px-2.5 py-2 text-paper-dim/60">
                NO MATCHING STATION
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
