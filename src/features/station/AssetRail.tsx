/**
 * 자산 탭 레일 — mono 탭 + 밑줄 니들 이동(§4 이징). 데이터가 있는
 * 자산군만 노출한다.
 */
import { useEffect, useRef, useState } from 'react'
import type { AssetClass } from '../../types/data'
import { ASSET_ABBR } from '../synoptic/shared'

export type AssetTab = AssetClass | 'all'

interface Props {
  assets: AssetClass[]
  tab: AssetTab
  onTab: (tab: AssetTab) => void
}

export function AssetRail({ assets, tab, onTab }: Props) {
  const railRef = useRef<HTMLDivElement>(null)
  const [needle, setNeedle] = useState<{ left: number; width: number } | null>(
    null,
  )
  const tabs: AssetTab[] = ['all', ...assets]

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const active = rail.querySelector<HTMLButtonElement>(
      `[data-tab="${tab}"]`,
    )
    if (active) {
      setNeedle({ left: active.offsetLeft, width: active.offsetWidth })
    }
  }, [tab, assets.length])

  return (
    <div ref={railRef} className="relative flex items-baseline gap-4">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          data-tab={t}
          aria-pressed={tab === t}
          onClick={() => onTab(t)}
          className={
            'dial-label pb-1.5 transition-colors duration-140 ' +
            (tab === t ? 'text-flow-in' : 'text-paper-dim hover:text-paper')
          }
        >
          {t === 'all' ? 'ALL' : ASSET_ABBR[t]}
        </button>
      ))}
      {needle && (
        <span
          aria-hidden="true"
          style={{ left: needle.left, width: needle.width }}
          className="absolute bottom-0 h-px bg-flow-in transition-all duration-280 ease-(--ease-baro)"
        />
      )}
    </div>
  )
}
