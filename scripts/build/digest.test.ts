import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { digestFiles } from './digest.ts'

describe('digestFiles — portable deterministic tree digest', () => {
  it('is independent of input order and changes with path or bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'capital-atlas-digest-'))
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'a.json'), '{"value":1}')
    writeFileSync(join(root, 'nested', 'b.json'), '{"value":2}')

    const baseline = digestFiles(root, ['a.json', 'nested/b.json'])
    expect(digestFiles(root, ['nested/b.json', 'a.json'])).toBe(baseline)

    writeFileSync(join(root, 'nested', 'b.json'), '{"value":3}')
    expect(digestFiles(root, ['a.json', 'nested/b.json'])).not.toBe(baseline)

    writeFileSync(join(root, 'renamed.json'), '{"value":1}')
    expect(digestFiles(root, ['renamed.json'])).not.toBe(
      digestFiles(root, ['a.json']),
    )
  })
})
