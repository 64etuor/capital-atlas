/**
 * i18n 계약 (G2):
 * 1) 카탈로그 패리티 — en/ko 키 집합 동일(누락 번역 차단).
 * 2) 하드코딩 프로즈 게이트 — UI 컴포넌트(.tsx)의 aria-label/placeholder/
 *    title 리터럴과 JSX 다단어 프로즈는 t()를 경유해야 한다.
 *    경계(§3): 계기 코드(OWN/STK/EQTY/ISO3/등급/분기 키)는 대상 아님 —
 *    게이트 정규식이 소문자 포함 다단어만 잡는 이유.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from './en.json'
import ko from './ko.json'

function keysOf(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keysOf(v, prefix ? `${prefix}.${k}` : k),
  )
}

describe('catalog parity', () => {
  it('en and ko expose identical key sets', () => {
    expect(keysOf(ko).sort()).toEqual(keysOf(en).sort())
  })
})

const UI_DIRS = ['components', 'features'].map((d) =>
  join(new URL('..', import.meta.url).pathname, d),
)

/** 화이트리스트 — 사유 필수. */
const ALLOW: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: />Capital <\/?span|>Atlas</, why: '워드마크 — 브랜드 고유명, 번역 비대상' },
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [p] : []
  })
}

describe('hardcoded prose gate', () => {
  it('UI prose goes through t() — no literal aria/placeholder/title/multi-word text', () => {
    const offenders: string[] = []
    const attrRe = /(aria-label|placeholder|title)="[A-Za-z][^"]*"/
    // JSX 텍스트: 대문자 시작 + 소문자 포함 2단어 이상 (계기 코드는 통과)
    const proseRe = />[A-Z][a-z]+ [a-z][^<{]*/
    for (const dir of UI_DIRS) {
      for (const file of walk(dir)) {
        const text = readFileSync(file, 'utf8')
        for (const [i, line] of text.split('\n').entries()) {
          if (ALLOW.some((a) => a.re.test(line))) continue
          if (attrRe.test(line) || proseRe.test(line)) {
            offenders.push(
              `${file.split('/src/')[1]}:${i + 1}: ${line.trim().slice(0, 80)}`,
            )
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
