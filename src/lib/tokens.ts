/**
 * Runtime access to the BAROMETER design tokens (DESIGN.md §2, defined in
 * index.css — the single source of truth). deck.gl/echarts/SVG need raw
 * numbers; this module reads CSS custom properties (1-shot cache) and never
 * hardcodes colors. FALLBACK_TOKENS mirrors index.css for document-less
 * environments (vitest node) — a drift test keeps the mirror byte-exact.
 */
import type { ConfidenceGrade } from '../types/data'

export type RGB = [number, number, number]

/**
 * index.css 미러 (드리프트 테스트가 강제 — tokens.test.ts). 값은 CSS 원문
 * 그대로: 색은 소문자 hex, fog는 숫자 문자열.
 */
export const FALLBACK_TOKENS: Record<string, string> = {
  // @theme originals
  '--color-ink-0': '#05070c',
  '--color-ink-1': '#0a0f1a',
  '--color-ink-2': '#101828',
  '--color-paper': '#e8e4d8',
  '--color-paper-dim': '#8b8878',
  '--color-flow-in': '#ffb454',
  '--color-flow-out': '#4fd8e8',
  '--color-signal': '#ff4d3d',
  '--color-pressure-1': '#1b2a4a',
  '--color-pressure-2': '#29627e',
  '--color-pressure-3': '#3fa27b',
  '--color-pressure-4': '#c8d96f',
  // :root canonical aliases
  '--atlas-ink-0': '#05070c',
  '--atlas-ink-1': '#0a0f1a',
  '--atlas-ink-2': '#101828',
  '--atlas-paper': '#e8e4d8',
  '--atlas-paper-dim': '#8b8878',
  '--flow-in': '#ffb454',
  '--flow-out': '#4fd8e8',
  '--signal': '#ff4d3d',
  '--pressure-1': '#1b2a4a',
  '--pressure-2': '#29627e',
  '--pressure-3': '#3fa27b',
  '--pressure-4': '#c8d96f',
  // §6 fog ladder
  '--fog-A': '0',
  '--fog-B': '0.08',
  '--fog-C': '0.18',
  '--fog-D': '0.3',
  '--fog-E': '0.45',
}

const varCache = new Map<string, string>()

function cssVar(name: string): string {
  let v = varCache.get(name)
  if (v === undefined) {
    v =
      typeof document === 'undefined'
        ? (FALLBACK_TOKENS[name] ?? '')
        : getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim() || (FALLBACK_TOKENS[name] ?? '')
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
