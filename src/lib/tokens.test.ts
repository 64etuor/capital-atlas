/**
 * 토큰 중앙화 계약 (G1):
 * 1) hex-0 게이트 — index.css(@theme)가 색의 유일 원천. src/**의 TS/TSX에
 *    색 hex 리터럴·rgba(숫자) 잔존 0. (경계: deck.gl RGB 배열 리터럴은
 *    grep으로 판별 불가 — 리뷰 관행으로 커버, 발견 즉시 rgbVar로 이관)
 * 2) 드리프트 게이트 — 노드/테스트 환경용 FALLBACK_TOKENS는 index.css와
 *    바이트 단위로 일치해야 한다(양방향).
 * 3) 노드 폴백 — document 없는 환경에서도 토큰 API가 동작한다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FALLBACK_TOKENS, fogAlpha, pressureColor, rgbVar } from './tokens'

const SRC = join(new URL('..', import.meta.url).pathname)
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8')

/**
 * 화이트리스트: lib/tokens.ts 하나 — index.css의 문서 없는 환경용 미러
 * (FALLBACK_TOKENS). 정합은 아래 드리프트 게이트가 바이트 단위로 강제하므로
 * 이 파일의 hex는 "두 번째 원천"이 아니라 "검증되는 사본"이다.
 */
const WHITELIST = [join(SRC, 'lib/tokens.ts')]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    if (WHITELIST.includes(p)) return []
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [p] : []
  })
}

describe('hex-0 gate — colors live only in index.css', () => {
  it('no hex or rgb()/rgba() numeric literals in src TS/TSX', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const [i, line] of text.split('\n').entries()) {
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) || /rgba?\(\s*\d/.test(line)) {
          offenders.push(`${file.slice(SRC.length)}:${i + 1}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('FALLBACK_TOKENS — drift gate against index.css', () => {
  // @theme 원본 색
  const themeColors = new Map<string, string>()
  for (const [, k, v] of CSS.matchAll(
    /(--color-[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g,
  )) {
    themeColors.set(k, v.toLowerCase())
  }
  // :root 별칭 → @theme 참조
  const aliases = new Map<string, string>()
  for (const [, k, ref] of CSS.matchAll(
    /(--[a-z0-9-]+):\s*var\((--color-[a-z0-9-]+)\)/gi,
  )) {
    aliases.set(k, ref)
  }
  // fog 알파 (숫자 원값)
  const fogs = new Map<string, string>()
  for (const [, k, v] of CSS.matchAll(/(--fog-[A-E]):\s*([0-9.]+)/g)) {
    fogs.set(k, v)
  }

  it('parsed index.css actually contains the §2 token families', () => {
    expect(themeColors.size).toBeGreaterThanOrEqual(11)
    expect(aliases.size).toBeGreaterThanOrEqual(11)
    expect(fogs.size).toBe(5)
  })

  it('every fallback entry matches the CSS chain (no drift, both ways)', () => {
    const expected = new Map<string, string>()
    for (const [k, v] of themeColors) expected.set(k, v)
    for (const [k, ref] of aliases) {
      const v = themeColors.get(ref)
      if (v) expected.set(k, v)
    }
    for (const [k, v] of fogs) expected.set(k, v)

    expect(Object.fromEntries(Object.entries(FALLBACK_TOKENS).sort())).toEqual(
      Object.fromEntries([...expected.entries()].sort()),
    )
  })
})

describe('node fallback — token API works without a document', () => {
  it('rgbVar resolves via FALLBACK_TOKENS', () => {
    expect(rgbVar('--color-flow-in')).toEqual([255, 180, 84]) // #ffb454
    expect(rgbVar('--flow-out')).toEqual([79, 216, 232]) // alias → #4fd8e8
  })
  it('fogAlpha resolves the §6 ladder', () => {
    expect(fogAlpha('A')).toBe(0)
    expect(fogAlpha('C')).toBe(0.18)
    expect(fogAlpha('E')).toBe(0.45)
  })
  it('pressureColor interpolates the deep-sea→dawn ramp', () => {
    expect(pressureColor(0)).toEqual([27, 42, 74]) // #1b2a4a
    expect(pressureColor(1)).toEqual([200, 217, 111]) // #c8d96f
  })
})
