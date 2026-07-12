/**
 * Runtime access to the BAROMETER design tokens (DESIGN.md §2, defined in
 * index.css). deck.gl and echarts need raw numbers; CSS custom properties
 * stay the single source of truth.
 */
import type { ConfidenceGrade } from '../types/data'

export type RGB = [number, number, number]

const varCache = new Map<string, string>()

function cssVar(name: string): string {
  let v = varCache.get(name)
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    varCache.set(name, v)
  }
  return v
}

export function rgbVar(name: string): RGB {
  const raw = cssVar(name).replace('#', '')
  const hex =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const n = Number.parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 신뢰등급 → 안개 알파 (--fog-A … --fog-E). */
export function fogAlpha(grade: ConfidenceGrade): number {
  return Number(cssVar(`--fog-${grade}`)) || 0
}

export function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/** 기압 순차 스케일: --pressure-1 → --pressure-4 (심해 → 여명). */
export function pressureColor(t: number): RGB {
  const stops: RGB[] = [
    rgbVar('--pressure-1'),
    rgbVar('--pressure-2'),
    rgbVar('--pressure-3'),
    rgbVar('--pressure-4'),
  ]
  const x = Math.min(Math.max(t, 0), 1) * 3
  const i = Math.min(Math.floor(x), 2)
  return lerpRgb(stops[i], stops[i + 1], x - i)
}

export function rgbaCss([r, g, b]: RGB, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
