import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { TreemapChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { AssetClass } from '../types/data'
import { ASSET_LABELS, type TreemapItem } from '../lib/assetLabels'
import { logScale } from '../features/map/aggregate'
import { lerpRgb, pressureColor, rgbVar, rgbaCss } from '../lib/tokens'
import { formatUsd } from '../lib/format'

echarts.use([TreemapChart, TooltipComponent, CanvasRenderer])

/**
 * A cell narrower than its label just renders "DEB…"/"$67…". Below this share
 * of the treemap we drop the in-cell label and let the hover tooltip carry the
 * full reading instead (no truncated slop, DESIGN.md §7).
 */
const LABEL_MIN_SHARE = 0.08

/**
 * 자산 구성 트리맵 — BAROMETER 토큰으로 스킨 (기본 ECharts 룩 금지).
 * Estimated blocks literally fade into the ink (§6).
 */
export function AssetTreemap({
  items,
  onPick,
  fmt = formatUsd,
}: {
  items: TreemapItem[]
  onPick: (asset: AssetClass) => void
  /** Phase L: LCU 표시 포맷터 (기본 USD) */
  fmt?: (v: number, digits?: number) => string
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
    const total = items.reduce((s, i) => s + i.value, 0) || 1

    chart.setOption({
      backgroundColor: 'transparent',
      animationDuration: 420,
      tooltip: {
        show: true,
        trigger: 'item',
        backgroundColor: rgbaCss(ink0, 0.95),
        borderColor: rgbaCss(paper, 0.15),
        borderWidth: 1,
        padding: [4, 8],
        textStyle: {
          color: rgbaCss(paper, 0.92),
          fontFamily: '"Spline Sans Mono Variable", monospace',
          fontSize: 11,
        },
        extraCssText: 'border-radius:0;box-shadow:none;',
        // §14 자산 비중 % 병기 — hover 승격 원칙(UX_RESEARCH P1)
        formatter: (p: { name: string; value: number }) =>
          `${p.name.toUpperCase()} · ${fmt(p.value, 1)} · ${((p.value / total) * 100).toFixed(1)}%`,
      },
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
              `${p.name.toUpperCase()}\n${fmt(p.value, 1)}`,
          },
          data: items.map((i) => {
            const base = pressureColor(0.25 + scale(i.value) * 0.6)
            const fogged = lerpRgb(base, ink1, Math.min(i.fog * 1.7, 0.75))
            return {
              name: ASSET_LABELS[i.asset],
              value: i.value,
              id: i.asset,
              label: { show: i.value / total >= LABEL_MIN_SHARE },
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
  }, [items, fmt])

  return <div ref={holder} className="h-44 w-full" />
}
