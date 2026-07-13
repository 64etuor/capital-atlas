/**
 * 자산 탭 레일 — mono 탭 + 밑줄 니들 이동(§4 이징).
 * 데이터 없는 자산은 숨기지 않고 회색+사유(UX_RESEARCH P1-7, OECD 관행):
 * "왜 없는지"가 보여야 한다.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetClass } from '../../types/data'
import { ASSET_ABBR } from '../synoptic/shared'

export type AssetTab = AssetClass | 'all'

interface Props {
  /** 레일에 표시할 전체 자산 순서 */
  assets: AssetClass[]
  /** 현재 관측소에 데이터가 있는 자산 */
  available: ReadonlySet<AssetClass>
  /** §14 자산 구성 비중 — hover에 % 노출 (현재 분기 concentration) */
  shares?: Partial<Record<AssetClass, number>>
  tab: AssetTab
  onTab: (tab: AssetTab) => void
}

export function AssetRail({ assets, available, shares, tab, onTab }: Props) {
  const { t } = useTranslation()
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
      {tabs.map((tb) => {
        const off = tb !== 'all' && !available.has(tb)
        return (
          <button
            key={tb}
            type="button"
            data-tab={tb}
            aria-pressed={tab === tb}
            aria-disabled={off}
            title={
              off
                ? t('station.railNoData', { asset: ASSET_ABBR[tb as AssetClass] })
                : tb !== 'all' && shares?.[tb] !== undefined
                  ? t('station.railShare', {
                      asset: ASSET_ABBR[tb],
                      pct: `${((shares[tb] ?? 0) * 100).toFixed(1)}%`,
                    })
                  : undefined
            }
            onClick={off ? undefined : () => onTab(tb)}
            className={
              'dial-label pb-1.5 transition-colors duration-140 ' +
              (tab === tb
                ? 'text-flow-in'
                : off
                  ? 'cursor-not-allowed text-paper-dim/25'
                  : 'text-paper-dim hover:text-paper')
            }
          >
            {tb === 'all' ? 'ALL' : ASSET_ABBR[tb]}
          </button>
        )
      })}
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
