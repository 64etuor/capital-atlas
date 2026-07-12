import { useViewStore } from '../../store/viewStore'
import { periodFromIndex } from '../../lib/periods'

/**
 * Full-bleed data canvas — Phase C replaces the placeholder internals with
 * the deck.gl + MapLibre globe (pressure choropleth, particle flows, fog,
 * country picking).
 *
 * Boundary contract: this component owns everything inside the map viewport.
 * It reads view state from useViewStore and reports country picks via
 * `selectCountry`. Nothing outside `src/features/map/` renders into it.
 */
export function MapCanvas() {
  const basis = useViewStore((s) => s.basis)
  const measure = useViewStore((s) => s.measure)
  const currency = useViewStore((s) => s.currency)
  const includeEstimates = useViewStore((s) => s.includeEstimates)
  const periodIndex = useViewStore((s) => s.periodIndex)
  const selectCountry = useViewStore((s) => s.selectCountry)

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* horizon glow — the atmosphere breathes even before data arrives */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 115%, color-mix(in srgb, var(--pressure-2) 26%, transparent) 0%, transparent 65%)',
        }}
      />
      {/* faint graticule */}
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full opacity-[0.14]"
      >
        {[20, 35, 50, 65, 80].map((y) => (
          <path
            key={y}
            d={`M0,${y} Q50,${y - 6} 100,${y}`}
            fill="none"
            stroke="var(--pressure-1)"
            strokeWidth={0.15}
          />
        ))}
        {[15, 32.5, 50, 67.5, 85].map((x) => (
          <path
            key={x}
            d={`M${x},0 Q${x + (50 - x) * 0.12},50 ${x},100`}
            fill="none"
            stroke="var(--pressure-1)"
            strokeWidth={0.15}
          />
        ))}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <p className="dial-label text-paper-dim/80">Map layer — Phase C</p>
        <p className="readout text-[11px] tracking-[0.12em] text-paper-dim">
          {basis.toUpperCase()} · {measure.toUpperCase()} ·{' '}
          {currency === 'usd_current' ? 'USD' : 'FXD'} ·{' '}
          {includeEstimates ? 'EST+' : 'OBS'} · {periodFromIndex(periodIndex)}
        </p>
        {/* temporary wiring probe until deck.gl picking lands */}
        <button
          type="button"
          onClick={() => selectCountry('KOR')}
          className="dial-label border-b border-flow-in/40 pb-0.5 text-paper-dim transition-colors duration-140 hover:text-flow-in"
        >
          Simulate pick · KOR
        </button>
      </div>
    </div>
  )
}
