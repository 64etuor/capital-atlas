import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { TreemapChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import type { AssetClass } from '../types/data'
import { ASSET_LABELS, type TreemapItem } from '../lib/assetLabels'
import { logScale } from '../features/map/aggregate'
import { lerpRgb, pressureColor, rgbVar, rgbaCss } from '../lib/tokens'
import { formatUsd } from '../lib/format'

echarts.use([TreemapChart, CanvasRenderer])

/**
 * 자산 구성 트리맵 — BAROMETER 토큰으로 스킨 (기본 ECharts 룩 금지).
 * Estimated blocks literally fade into the ink (§6).
 */
export function AssetTreemap({
  items,
  onPick,
}: {
  items: TreemapItem[]
  onPick: (asset: AssetClass) => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const pickRef = useRef(onPick)
  useEffect(() => {
    pickRef.current = onPick
  })

  useEffect(() => {
    const el = holder.current
    if (!el || items.length === 0) return
    const chart = echarts.init(el, null, { renderer: 'canvas' })
    const ink0 = rgbVar('--color-ink-0')
    const ink1 = rgbVar('--color-ink-1')
    const paper = rgbVar('--color-paper')
    const scale = logScale(items.map((i) => i.value))

    chart.setOption({
      backgroundColor: 'transparent',
      animationDuration: 420,
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false as const,
          breadcrumb: { show: false },
          width: '100%',
          height: '100%',
          left: 0,
          top: 0,
          itemStyle: {
            borderColor: rgbaCss(ink0, 1),
            borderWidth: 1,
            gapWidth: 1,
          },
          label: {
            fontFamily: '"Spline Sans Mono Variable", monospace',
            fontSize: 10,
            lineHeight: 14,
            color: rgbaCss(paper, 0.92),
            formatter: (p: { name: string; value: number }) =>
              `${p.name.toUpperCase()}\n${formatUsd(p.value, 1)}`,
          },
          data: items.map((i) => {
            const base = pressureColor(0.25 + scale(i.value) * 0.6)
            const fogged = lerpRgb(base, ink1, Math.min(i.fog * 1.7, 0.75))
            return {
              name: ASSET_LABELS[i.asset],
              value: i.value,
              id: i.asset,
              itemStyle: {
                color: rgbaCss(fogged, 1 - i.fog * 0.5),
              },
            }
          }),
        },
      ],
    })
    chart.on('click', (params) => {
      const asset = (params.data as { id?: AssetClass } | undefined)?.id
      if (asset) pickRef.current(asset)
    })
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.dispose()
    }
  }, [items])

  return <div ref={holder} className="h-44 w-full" />
}
