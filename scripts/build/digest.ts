import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Stable digest of named files. Paths are part of the digest and sorted. */
export function digestFiles(root: string, relativePaths: readonly string[]): string {
  const hash = createHash('sha256')
  for (const path of [...relativePaths].sort()) {
    const body = readFileSync(join(root, path))
    hash.update(path)
    hash.update('\0')
    hash.update(String(body.byteLength))
    hash.update('\0')
    hash.update(body)
  }
  return hash.digest('hex')
}
