import { useViewStore } from '../store/viewStore'
import { periodFromIndex } from '../lib/periods'
import type { ConfidenceGrade } from '../types/data'

/** demo-pick display names until Phase B ships countries.json */
const COUNTRY_NAMES: Record<string, string> = {
  KOR: 'Korea',
  USA: 'United States',
  JPN: 'Japan',
}

const GRADES: readonly ConfidenceGrade[] = ['A', 'B', 'C', 'D', 'E']

/**
 * "관측 준비 중" — no numbers without lineage (DESIGN.md §1.5), no skeleton
 * pulse (§7). Sections state their instrument status instead.
 */
function AwaitingSection({ title, note }: { title: string; note: string }) {
  return (
    <section className="border-t border-paper/10 px-6 py-5">
      <h3 className="dial-label text-paper-dim">{title}</h3>
      <div className="mt-3 border border-dashed border-paper/15 px-3 py-6 text-center">
        <p className="readout text-[11px] tracking-[0.12em] text-paper-dim/80">
          AWAITING OBSERVATION
        </p>
        <p className="mt-1 font-sans text-[11px] text-paper-dim/60">{note}</p>
      </div>
    </section>
  )
}

/** 우측 슬라이드 관측 리포트 — 에디토리얼 조판 (DESIGN.md §5). */
export function ObservationReport() {
  const selectedCountry = useViewStore((s) => s.selectedCountry)
  const selectCountry = useViewStore((s) => s.selectCountry)
  const periodIndex = useViewStore((s) => s.periodIndex)
  const open = selectedCountry !== null

  return (
    <aside
      aria-hidden={!open}
      className={
        'absolute inset-y-0 right-0 z-20 flex w-[420px] max-w-full flex-col overflow-y-auto border-l border-paper/10 bg-ink-2/95 transition-transform duration-280 ease-(--ease-baro) ' +
        (open ? 'translate-x-0' : 'pointer-events-none translate-x-full')
      }
    >
      <div className="flex items-start justify-between px-6 pt-6">
        <div>
          <p className="readout text-[11px] tracking-[0.12em] text-paper-dim">
            OBSERVATION REPORT · {periodFromIndex(periodIndex)}
          </p>
          <h2 className="font-display text-[clamp(3rem,6vw,5.5rem)] leading-[0.95] text-paper">
            {selectedCountry
              ? (COUNTRY_NAMES[selectedCountry] ?? selectedCountry)
              : '—'}
          </h2>
          <p className="readout mt-1 text-[11px] tracking-[0.12em] text-paper-dim/70">
            {selectedCountry ?? ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => selectCountry(null)}
          aria-label="Close observation report"
          className="readout mt-1 px-2 py-1 text-[13px] text-paper-dim transition-colors duration-140 hover:text-paper"
        >
          ✕
        </button>
      </div>

      <div className="mt-6">
        <AwaitingSection
          title="Headline position"
          note="Total investable assets — lands with Phase B datasets"
        />
        <AwaitingSection
          title="Asset composition"
          note="Treemap over adjusted stocks by asset class"
        />
        <AwaitingSection
          title="Net flows by quarter"
          note="Transaction flows vs valuation effects, separated"
        />
        <AwaitingSection
          title="Top counterparties"
          note="Bilateral positions, mirror-checked"
        />
      </div>

      {/* visibility legend — grades render as fog before badges (§2, §6) */}
      <section className="mt-auto border-t border-paper/10 px-6 py-4">
        <h3 className="dial-label text-paper-dim">Visibility</h3>
        <div className="mt-2 flex items-center gap-1">
          {GRADES.map((g, i) => (
            <span
              key={g}
              className="readout relative flex h-6 w-9 items-center justify-center text-[10px] text-paper"
              style={{
                backgroundColor: `color-mix(in srgb, var(--pressure-2) ${60 - i * 12}%, var(--atlas-ink-1))`,
              }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-ink-0"
                style={{ opacity: `var(--fog-${g})` }}
              />
              <span className="relative">{g}</span>
            </span>
          ))}
          <span className="ml-2 font-sans text-[11px] text-paper-dim/70">
            observed → residual fog
          </span>
        </div>
      </section>
    </aside>
  )
}
