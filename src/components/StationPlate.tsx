import { periodFromIndex, PERIOD_COUNT } from '../lib/periods'

/** 좌상 관측소 명판 — 워드마크 + 이중 시각 스탬프 (DESIGN.md §5). */
export function StationPlate({ estimatedAsOf }: { estimatedAsOf: string }) {
  const lastOfficial = periodFromIndex(PERIOD_COUNT - 1)

  return (
    <div className="pointer-events-none absolute left-6 top-5 z-10 select-none">
      <h1 className="font-display text-[28px] leading-none tracking-wide text-paper">
        Capital <span className="italic">Atlas</span>
      </h1>
      <div className="readout mt-2 space-y-0.5 text-[11px] leading-tight text-paper-dim">
        <p>
          <span className="opacity-60">LAST OFFICIAL OBS</span> {lastOfficial}
        </p>
        <p>
          <span className="opacity-60">ESTIMATED AS OF</span> {estimatedAsOf}
        </p>
      </div>
    </div>
  )
}
